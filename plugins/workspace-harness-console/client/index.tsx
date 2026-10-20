// Client plugin: harness console in the settings dialog.
// Shows only facts this page can verify: the client slot registry contents and the
// real availability of two same-origin endpoints. It never invents harness state.
import { useCallback, useEffect, useState } from 'react';
import type { ClientPlugin } from '../../../packages/harness-client/src/index.mjs';
import './client.css';

type Probe = { status: 'loading' | 'ok' | 'missing' | 'error'; detail?: string };

type RegistryView = {
  list(): { id: string }[];
  slots(name: string): { pluginId: string }[];
};

function registry(): RegistryView | null {
  const candidate = (globalThis as unknown as { __DSH_SLOT_REGISTRY__?: RegistryView }).__DSH_SLOT_REGISTRY__;
  return candidate && typeof candidate.list === 'function' && typeof candidate.slots === 'function' ? candidate : null;
}

async function probe(path: string): Promise<Probe> {
  try {
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    if (response.status === 404) return { status: 'missing', detail: 'HTTP 404' };
    if (!response.ok) return { status: 'error', detail: `HTTP ${response.status}` };
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch {
      // The enterprise shell answers unknown paths with the SPA HTML at 200; that
      // is "not mounted", never "available".
      return { status: 'missing', detail: '非 JSON 响应（SPA 回退）' };
    }
    if (path === '/healthz') {
      const payload = body as { status?: unknown; plugins?: unknown };
      if (payload?.status !== 'ok' || !Array.isArray(payload.plugins)) return { status: 'error', detail: '响应缺少 status/plugins' };
    }
    return { status: 'ok', detail: `HTTP ${response.status}` };
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
}

export function HarnessConsole(_props: Record<string, unknown>) {
  const read = useCallback(() => {
    const view = registry();
    if (!view) return [];
    return view.list().map(plugin => ({
      id: plugin.id,
      slots: (['home.cards', 'page.body', 'session.header', 'settings.section'] as const)
        .filter(slot => view.slots(slot).some(occupant => occupant.pluginId === plugin.id)),
    }));
  }, []);
  const [plugins, setPlugins] = useState(read);
  const [harness, setHarness] = useState<Probe>({ status: 'loading' });
  const [recovery, setRecovery] = useState<Probe>({ status: 'loading' });

  const refresh = useCallback(() => {
    setPlugins(read());
    setHarness({ status: 'loading' });
    setRecovery({ status: 'loading' });
    void probe('/healthz').then(setHarness, () => setHarness({ status: 'error', detail: 'probe failed' }));
    void probe('/api/inquiry-recovery/status').then(setRecovery, () => setRecovery({ status: 'error', detail: 'probe failed' }));
  }, [read]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = (value: Probe, ok: string, missing: string) => {
    if (value.status === 'loading') return '检测中…';
    if (value.status === 'ok') return `${ok}（${value.detail}）`;
    if (value.status === 'missing') return `${missing}（${value.detail}）`;
    return `检测失败（${value.detail ?? '未知错误'}）`;
  };

  return (
    <section className="settings-section harness-console" aria-label="Harness 平台">
      <h3>Harness 平台</h3>
      <p className="field-help">客户端插件由构建期发现并注册到 slot；服务端插件由 composition 装配。以下为当前页面可验证的事实。</p>
      <div className="harness-console-plugins" role="list">
        {plugins.length ? plugins.map(plugin => (
          <div className="harness-console-plugin" role="listitem" key={plugin.id} data-client-plugin={plugin.id}>
            <strong>{plugin.id}</strong>
            <span>{plugin.slots.length ? `slot：${plugin.slots.join('、')}` : '未占用 slot'}</span>
          </div>
        )) : <p className="field-help" role="status">当前页面没有已注册的客户端插件。</p>}
      </div>
      <dl className="harness-console-probes">
        <div>
          <dt>独立 Harness <code>/healthz</code></dt>
          <dd data-probe="healthz" data-state={harness.status}>{label(harness, '已挂载', '当前页面未挂载独立 Harness')}</dd>
        </div>
        <div>
          <dt>询盘捞回服务 <code>/api/inquiry-recovery/status</code></dt>
          <dd data-probe="recovery" data-state={recovery.status}>{label(recovery, '可用', '未挂载该服务')}</dd>
        </div>
      </dl>
      <p className="harness-console-hint">独立 Harness 启动：<code>node harness.mjs --preset inquiry-analyst</code></p>
      <button type="button" className="harness-console-refresh" onClick={refresh}>重新检测</button>
    </section>
  );
}

const plugin: ClientPlugin = Object.freeze({
  id: 'workspace-harness-console',
  slots: { 'settings.section': HarnessConsole },
});

export default plugin;
