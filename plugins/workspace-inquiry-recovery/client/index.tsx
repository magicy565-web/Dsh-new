// Client plugin: contributes the historical inquiry recovery entry card to `home.cards`.
// It only reads the real `GET /api/inquiry-recovery/status` payload; when the harness
// is not mounted (404) it says so instead of inventing zero counts.
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../src/api';
import { Icon } from '../../../src/icons';
import type { ClientPlugin } from '../../../packages/harness-client/src/index.mjs';
import './client.css';

type RecoveryCounts = {
  leads: number;
  selections: number;
  imports: number;
  conflicts: number;
  follow_up: number;
  need_evidence: number;
  nurture: number;
  hold: number;
};

type RecoveryStatus = {
  engineVersion: number;
  staleDays: number;
  asOf: string;
  counts: RecoveryCounts;
};

type CardState =
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'ready'; status: RecoveryStatus };

const DECISIONS = [
  { key: 'follow_up', label: '待跟进' },
  { key: 'need_evidence', label: '待补证' },
  { key: 'nurture', label: '培育中' },
  { key: 'hold', label: '暂停' },
] as const;

export type RecoveryHomeCardProps = { onOpenRecovery?: () => void };

function formatDay(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function reasonText(error: unknown) {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '询盘状态暂时不可用';
}

/**
 * The home entry card. It is a function component, so the plugin host renders it
 * inside the per-plugin error boundary like any other occupant.
 */
export function RecoveryHomeCard({ onOpenRecovery }: RecoveryHomeCardProps) {
  const [state, setState] = useState<CardState>({ kind: 'loading' });
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const status = await api<RecoveryStatus>('/inquiry-recovery/status');
        if (cancelled) return;
        if (!status || typeof status.counts?.leads !== 'number') {
          setState({ kind: 'error', message: '询盘状态返回格式无法识别' });
          return;
        }
        setState(status.counts.leads === 0 ? { kind: 'empty' } : { kind: 'ready', status });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setState({
            kind: 'unavailable',
            message: '询盘捞回服务尚未挂载：当前 Harness 未提供 /api/inquiry-recovery/status，因此这里不展示任何推测数字。',
          });
        } else {
          setState({ kind: 'error', message: reasonText(error) });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadNonce]);

  const status = state.kind === 'ready' ? state.status : null;

  return (
    <article
      className="slot-recovery-card"
      data-testid="slot-recovery-card"
      data-state={state.kind}
      aria-labelledby="slot-recovery-title"
      aria-busy={state.kind === 'loading'}
    >
      <div className="slot-recovery-main">
        <span className="slot-recovery-eyebrow">INQUIRY RECOVERY</span>
        <h2 id="slot-recovery-title">询盘捞回</h2>
        <p className="slot-recovery-desc">用已导入的历史询盘和逐字证据，找出该跟进、该补证和该暂停的线索。</p>
        <div className="slot-recovery-status" role="status" aria-live="polite">
          {state.kind === 'loading' && <p className="slot-recovery-note">正在读取真实询盘状态…</p>}
          {state.kind === 'unavailable' && <p className="slot-recovery-note slot-recovery-note-warn">{state.message}</p>}
          {state.kind === 'error' && (
            <div className="slot-recovery-error">
              <p className="slot-recovery-note slot-recovery-note-warn">询盘状态暂时无法读取：{state.message}</p>
              <button type="button" className="slot-recovery-retry" onClick={() => setReloadNonce(value => value + 1)}>重试</button>
            </div>
          )}
          {state.kind === 'empty' && (
            <p className="slot-recovery-note">还没有导入任何历史询盘；导入后会显示真实判定数量，不会生成示例数据。</p>
          )}
          {status && (
            <>
              <ul className="slot-recovery-chips" aria-label="询盘判定数量">
                {DECISIONS.map(item => (
                  <li className={`slot-recovery-chip slot-recovery-chip-${item.key}`} data-decision={item.key} key={item.key}>
                    <span>{item.label}</span>
                    <strong>{status.counts[item.key]}</strong>
                  </li>
                ))}
              </ul>
              <p className="slot-recovery-meta">共 {status.counts.leads} 条线索 · 跟进阈值 {status.staleDays} 天 · 评估基准日 {formatDay(status.asOf)}</p>
            </>
          )}
        </div>
      </div>
      <button type="button" className="slot-recovery-open" onClick={() => onOpenRecovery?.()} disabled={!onOpenRecovery}>
        询盘捞回
        <Icon name="chevron" size={14} />
      </button>
    </article>
  );
}

const plugin: ClientPlugin = {
  id: 'workspace-inquiry-recovery',
  slots: { 'home.cards': RecoveryHomeCard },
};

export default plugin;
