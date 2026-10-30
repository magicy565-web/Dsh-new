import React from 'react';
import { Check, LoaderCircle, AlertCircle, CloudOff, Lock, GitPullRequestArrow, Clock3 } from 'lucide-react';
import { SYNC_LABELS } from './layout-saver.mjs';

const ICONS = { idle: Check, saved: Check, pending: Clock3, saving: LoaderCircle, conflict: GitPullRequestArrow, offline: CloudOff, error: AlertCircle, readonly: Lock };
const TONES = { idle: 'ok', saved: 'ok', pending: 'busy', saving: 'busy', conflict: 'warn', offline: 'warn', error: 'bad', readonly: 'muted' };

/** The five layout states the plan calls for, plus loading and disconnected. */
export function SyncIndicator({ sync, loading, connected, onRetry }) {
  const status = loading ? 'saving' : !connected ? 'offline' : sync.status;
  const label = loading ? '读取中' : !connected ? '未连接' : SYNC_LABELS[status] || '已同步';
  const Icon = ICONS[status] || Check;
  const retryable = connected && !loading && (status === 'error' || status === 'offline');
  const detail = loading ? '正在读取工作区' : !connected ? '当前会话没有连接到工作区' : sync.message || label;
  return (
    <span className={`cv-sync cv-sync-${TONES[status]}`} role="status" aria-live="polite" title={detail}>
      <Icon size={13} className={status === 'saving' ? 'cn-spin' : ''} aria-hidden="true" />
      <span>{label}{connected && !loading && sync.pendingCount > 0 && status !== 'saved' ? ` · ${sync.pendingCount}` : ''}</span>
      {retryable && <button type="button" className="cn-text-button" onClick={onRetry}>重试</button>}
    </span>
  );
}
