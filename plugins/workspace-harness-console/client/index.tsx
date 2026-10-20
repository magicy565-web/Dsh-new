// Client plugin: harness console in the settings dialog.
// Shows only facts this page can verify: the client slot registry contents, the
// real availability of two same-origin endpoints, and the audited business events
// that endpoint actually returns. It never invents harness state.
import { useCallback, useEffect, useState } from 'react';
import type { ClientPlugin } from '../../../packages/harness-client/src/index.mjs';
import { REVIEW_BLOCKER } from '../../../packages/harness-contracts/src/index.mjs';
import './client.css';

const BLOCKER_LABELS: Record<string, string> = {
  [REVIEW_BLOCKER.unresolvedRow]: '未解析的插件行',
  [REVIEW_BLOCKER.unmetRequires]: '缺少服务依赖',
  [REVIEW_BLOCKER.serviceConflict]: '服务提供冲突',
  [REVIEW_BLOCKER.installDrift]: '安装内容被改动',
  [REVIEW_BLOCKER.installMissing]: '已安装包丢失',
};

type Probe = { status: 'loading' | 'ok' | 'missing' | 'error'; detail?: string };
type AuditEvent = { at?: string; kind?: string; action?: string; ok?: boolean; code?: string | null; actor?: { subject?: string } | null };
type AuditView = { status: 'loading' | 'ok' | 'missing' | 'error'; detail?: string; events: AuditEvent[] };
type ReviewView = {
  status: 'loading' | 'ok' | 'missing' | 'error';
  detail?: string;
  verdict?: string;
  digest?: string;
  blockers?: string[];
};

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

async function fetchReview(): Promise<ReviewView> {
  try {
    const response = await fetch('/api/harness/review', { headers: { Accept: 'application/json' } });
    if (response.status === 404) return { status: 'missing', detail: 'HTTP 404' };
    if (response.status === 403) return { status: 'error', detail: '需要 admin 权限' };
    const text = await response.text();
    const body = parseJson(text);
    if (body === undefined) return { status: 'missing', detail: '非 JSON 响应（SPA 回退）' };
    if (response.status === 503) {
      const payload = body as { state?: unknown; error?: { message?: unknown } };
      const state = typeof payload?.state === 'string' ? payload.state : 'unavailable';
      const reason = typeof payload?.error?.message === 'string' ? payload.error.message : '评审快照不可用';
      return { status: 'error', detail: `${state}：${reason}` };
    }
    if (!response.ok) return { status: 'error', detail: `HTTP ${response.status}` };
    const review = (body as { review?: unknown }).review;
    if (!review || typeof review !== 'object') return { status: 'error', detail: '响应缺少 review' };
    const document = review as { verdict?: unknown; composition?: { digest?: unknown }; blockers?: unknown };
    if (typeof document.verdict !== 'string') return { status: 'error', detail: 'review.verdict 缺失' };
    const digest = typeof document.composition?.digest === 'string' ? document.composition.digest : undefined;
    const blockers = Array.isArray(document.blockers)
      ? document.blockers.map(item => (item && typeof item === 'object' && typeof (item as { kind?: unknown }).kind === 'string' ? String((item as { kind: string }).kind) : 'blocker'))
      : [];
    return { status: 'ok', detail: document.verdict, verdict: document.verdict, digest, blockers };
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
  const [review, setReview] = useState<ReviewView>({ status: 'loading' });

  const refresh = useCallback(() => {
    setPlugins(read());
    setHarness({ status: 'loading' });
    setRecovery({ status: 'loading' });
    setAudit({ status: 'loading', events: [] });
    setReview({ status: 'loading' });
    void probe('/healthz').then(setHarness, () => setHarness({ status: 'error', detail: 'probe failed' }));
    void probe('/api/inquiry-recovery/status').then(setRecovery, () => setRecovery({ status: 'error', detail: 'probe failed' }));
    void fetchAudit().then(setAudit, () => setAudit({ status: 'error', detail: 'probe failed', events: [] }));
    void fetchReview().then(setReview, () => setReview({ status: 'error', detail: 'probe failed' }));
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
  const reviewLabel = () => {
    if (review.status === 'loading') return '读取中…';
    if (review.status === 'ok') return `判定：${review.verdict}`;
    if (review.status === 'missing') return `当前页面未提供评审接口（${review.detail}）`;
    return `评审不可读（${review.detail ?? '未知错误'}）`;
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
        <div>
          <dt>部署评审 <code>/api/harness/review</code></dt>
          <dd data-probe="review" data-state={review.status} data-verdict={review.verdict ?? ''}>{reviewLabel()}</dd>
        </div>
      </dl>
      {review.status === 'ok' && (
        <div className="harness-console-review" data-verdict={review.verdict ?? ''}>
          <p className="field-help">
            评审判定 <strong>{review.verdict}</strong>
            {review.digest ? <> · 组合摘要 <code>{review.digest.slice(0, 12)}</code></> : null}
            {review.blockers?.length ? <> · {review.blockers.length} 个阻断项：{review.blockers.map(kind => `${BLOCKER_LABELS[kind] ?? '未知阻断'}（${kind}）`).join('、')}</> : <> · 无阻断项</>}
          </p>
        </div>
      )}
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
