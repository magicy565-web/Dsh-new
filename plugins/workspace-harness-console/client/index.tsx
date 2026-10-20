// Client plugin: harness console in the settings dialog.
// Shows only facts this page can verify: the client slot registry contents, the
// real availability of two same-origin endpoints, and the audited business events
// that endpoint actually returns. It never invents harness state.
import { useCallback, useEffect, useState } from 'react';
import type { ClientPlugin } from '../../../packages/harness-client/src/index.mjs';
import './client.css';

type Probe = { status: 'loading' | 'ok' | 'missing' | 'error'; detail?: string };
type AuditEvent = { at?: string; kind?: string; action?: string; ok?: boolean; code?: string | null; actor?: { subject?: string } | null };
type AuditView = { status: 'loading' | 'ok' | 'missing' | 'error'; detail?: string; events: AuditEvent[] };

type RegistryView = {
  list(): { id: string }[];
  slots(name: string): { pluginId: string }[];
};

function registry(): RegistryView | null {
  const candidate = (globalThis as unknown as { __DSH_SLOT_REGISTRY__?: RegistryView }).__DSH_SLOT_REGISTRY__;
  return candidate && typeof candidate.list === 'function' && typeof candidate.slots === 'function' ? candidate : null;
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

async function probe(path: string): Promise<Probe> {
  try {
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    if (response.status === 404) return { status: 'missing', detail: 'HTTP 404' };
    if (!response.ok) return { status: 'error', detail: `HTTP ${response.status}` };
    const text = await response.text();
    const body = parseJson(text);
    if (body === undefined) {
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

async function fetchAudit(): Promise<AuditView> {
  try {
    const response = await fetch('/api/inquiry-recovery/audit?limit=20', { headers: { Accept: 'application/json' } });
    if (response.status === 404) return { status: 'missing', detail: 'HTTP 404', events: [] };
    if (response.status === 403) return { status: 'error', detail: '需要 admin 权限', events: [] };
    if (!response.ok) return { status: 'error', detail: `HTTP ${response.status}`, events: [] };
    const body = parseJson(await response.text());
    if (body === undefined) return { status: 'missing', detail: '非 JSON 响应（SPA 回退）', events: [] };
    const events = (body as { events?: unknown }).events;
    if (!Array.isArray(events)) return { status: 'error', detail: '响应缺少 events', events: [] };
    return { status: 'ok', detail: `${events.length} 条`, events: events.slice(0, 20) as AuditEvent[] };
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : String(error), events: [] };
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
  const [audit, setAudit] = useState<AuditView>({ status: 'loading', events: [] });

  const refresh = useCallback(() => {
    setPlugins(read());
    setHarness({ status: 'loading' });
    setRecovery({ status: 'loading' });
    setAudit({ status: 'loading', events: [] });
    void probe('/healthz').then(setHarness, () => setHarness({ status: 'error', detail: 'probe failed' }));
    void probe('/api/inquiry-recovery/status').then(setRecovery, () => setRecovery({ status: 'error', detail: 'probe failed' }));
    void fetchAudit().then(setAudit, () => setAudit({ status: 'error', detail: 'probe failed', events: [] }));
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
  const auditLabel = () => {
    if (audit.status === 'loading') return '读取中…';
    if (audit.status === 'ok') return `可读（${audit.detail}）`;
    if (audit.status === 'missing') return `当前页面未提供审计接口（${audit.detail}）`;
    return `审计不可读（${audit.detail ?? '未知错误'}）`;
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
        <div>
          <dt>业务审计 <code>/api/inquiry-recovery/audit</code></dt>
          <dd data-probe="audit" data-state={audit.status}>{auditLabel()}</dd>
        </div>
      </dl>
      <div className="harness-console-audit" aria-label="最近审计事件">
        {audit.status === 'ok' && (audit.events.length ? (
          <ol className="harness-console-events">
            {audit.events.map((event, index) => (
              <li key={`${event.at ?? 'event'}-${index}`} data-audit-index={index} data-ok={event.ok === false ? 'false' : 'true'}>
                <span className="harness-console-event-time">{typeof event.at === 'string' ? event.at.replace('T', ' ').slice(0, 19) : '时间未知'}</span>
                <span className="harness-console-event-action">{event.kind ?? 'unknown'}/{event.action ?? 'unknown'}</span>
                <span className="harness-console-event-actor">{event.actor?.subject ?? '无 actor'}</span>
                <span className="harness-console-event-state">{event.ok === false ? `失败${event.code ? ` · ${event.code}` : ''}` : '成功'}</span>
              </li>
            ))}
          </ol>
        ) : <p className="field-help" role="status">审计接口可用，但当前没有事件。</p>)}
      </div>
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
