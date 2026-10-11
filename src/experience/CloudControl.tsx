import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Modal } from '../Modal';
import { Icon } from '../icons';
import { useDirty, useWrite } from '../library/common';
import { ControlSpirit } from './ControlSpirit';
import type { SpiritState } from './ControlSpirit';
import type { Bootstrap } from '../types';

type FileRef = { id: string; version: number; sha256: string; filename?: string };
type Job = { id: string; prompt: string; state: string; conversationId?: string; transport?: string; claimedAt?: number; completedAt?: number; resultSummary?: string; files?: FileRef[]; completionHash?: string; businessAcceptance?: string; reconciliationRequired?: boolean; blocker?: { message?: string }; toolEvidence?: unknown };
type WorkerView = { enabled: boolean; canDelegate: boolean; worker: null | { id: string; connection: null | { id: string; provider: string; authenticatedRecently: boolean; pausedAt?: number | null; drainingAt?: number | null } }; delegations: Job[]; dotEvents?: { deliveries: { taskRef: string; status: string; httpReceivedAt?: number; dotReceivedAt?: number }[] } };
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'expired']);
const stateLabels: Record<string, string> = { queued: '等待领取', leased: '已领取', running: '执行中', return_pending: '回传中', succeeded: '成果已回传', blocked: '执行受阻', uncertain: '等待核实', cancel_requested: '等待停止确认', cancelled: '已停止', failed: '执行失败', expired: '已过期' };

/** Same-origin adapter for the deployed personal Worker API. Never infers execution from login. */
export function CloudControl({ data, readOnly, onDirty, onSettings, onConversation }: { data: Bootstrap; readOnly: boolean; onDirty: (dirty: boolean) => void; onSettings: () => void; onConversation: (id?: string) => void }) {
  const [view, setView] = useState<WorkerView | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sheet, setSheet] = useState<'tasks' | 'detail' | 'send' | 'connection' | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [conversationId, setConversationId] = useState(data.conversations[0]?.id || '');
  const [confirmed, setConfirmed] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [readAt, setReadAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const alive = useRef(true), reading = useRef(false);
  const writer = useWrite();
  const screen = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const compact = !!viewport && window.innerWidth <= 760 && viewport.height < window.innerHeight - 80;
      if (screen.current) { screen.current.dataset.keyboard = String(compact); screen.current.style.setProperty('--control-height', compact ? viewport!.height + 'px' : '100%'); }
    };
    update(); viewport?.addEventListener('resize', update);
    return () => viewport?.removeEventListener('resize', update);
  }, []);
  const pending = useRef<{ action: string; body: Record<string, unknown> } | null>(null);
  const frozen = writer.busy || writer.uncertain;
  useDirty(frozen, onDirty);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const result = await api<WorkerView>('/personal-worker');
      if (!Array.isArray(result.delegations) || typeof result.enabled !== 'boolean') throw Error('线上任务接口不兼容');
      if (alive.current) { setView(result); setError(''); setReadAt(Date.now()); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '无法读取云端任务'); }
    finally { reading.current = false; }
  }, []);
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = window.setInterval(() => { setClock(Date.now()); if (!document.hidden) void refresh(); }, 3000);
    const visibility = () => { setClock(Date.now()); if (!document.hidden) void refresh(); };
    const events = new EventSource('/api/events');
    events.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => { alive.current = false; clearInterval(timer); events.close(); document.removeEventListener('visibilitychange', visibility); };
  }, [refresh]);
  const stale = !!error || !!readAt && clock - readAt > 12000;
  const jobs = [...(view?.delegations || [])].reverse();
  const current = jobs.find(job => !terminal.has(job.state)) || jobs.find(job => job.state === 'succeeded' && job.businessAcceptance === 'not_reviewed') || jobs[0];
  const selected = jobs.find(job => job.id === selectedId) || current;
  const connection = view?.worker?.connection;
  const running = !!current && ['leased', 'running', 'return_pending'].includes(current.state);
  const needsAttention = !!current && ['blocked', 'uncertain', 'failed', 'cancel_requested'].includes(current.state) || !!current && current.state === 'succeeded' && current.businessAcceptance === 'not_reviewed';
  const state: SpiritState = stale ? 'offline' : !view ? 'loading' : needsAttention ? 'attention' : running ? 'working' : !connection?.authenticatedRecently ? 'setup' : 'idle';
  const headline = stale ? '连接中断' : !view ? '正在连接云端' : current && !terminal.has(current.state) ? stateLabels[current.state] || '等待核实' : needsAttention ? '成果待你验收' : '我在这里';
  const delivery = view?.dotEvents?.deliveries.filter(item => item.taskRef === current?.id).at(-1);
  const mayWrite = !readOnly && !stale && !!view && !frozen;
  const canSend = mayWrite && view?.canDelegate && !connection?.pausedAt && !connection?.drainingAt && !jobs.some(job => !terminal.has(job.state));
  const stage = !current ? -1 : current.state === 'succeeded' ? 3 : current.state === 'return_pending' ? 2 : current.claimedAt ? 1 : 0;
  function close() { if (!frozen) { setSheet(null); setCancelConfirm(false); writer.clear(); } }
  async function write(action: string, body: Record<string, unknown>) {
    if (readOnly || stale || writer.busy) return;
    pending.current ||= { action, body };
    const saved = pending.current;
    const result = await writer.write<WorkerView>('/personal-worker/' + saved.action, 'POST', saved.body);
    if (result) { pending.current = null; setView(result); setReadAt(Date.now()); if (saved.action === 'delegate') { setDraft(''); setConfirmed(false); setSheet(null); } setCancelConfirm(false); void refresh(); }
  }
  function startAction(action: string, body: Record<string, unknown>) { if (!writer.uncertain) pending.current = null; void write(action, body); }
  return <section ref={screen} className="master-control cloud-control" data-testid="v22-cloud-control">
    <header className="control-header"><span className="control-wordmark">Workspace<span>主控</span></span><button className="control-cloud-status" onClick={() => setSheet('connection')} disabled={frozen}><span className={'control-dot ' + (connection?.authenticatedRecently && !stale ? 'state-completed' : '')}/>{stale ? '连接中断' : '云端 xy'}</button></header>
    <div className="control-center">
      <ControlSpirit state={state} onOpen={() => { if (!frozen) setSheet('tasks'); }}/>
      <div className="control-presence" aria-live="polite"><h1>{headline}</h1><p>{current ? current.prompt.slice(0, 34) + (current.prompt.length > 34 ? '…' : '') : '把下一件事交给我'}</p></div>
      {current && <button className="cloud-progress" aria-label="查看云端任务进度" disabled={frozen} onClick={() => { setSelectedId(current.id); setSheet('detail'); }}>
        {['已提交', '已领取', '回传中', '已回传'].map((label, index) => <span key={label} data-reached={index <= stage} data-active={!stale && running && index === stage}><i/><small>{label}</small></span>)}
      </button>}
      {stale && <button className="control-task-peek" onClick={() => void refresh()}>重新连接</button>}
    </div>
    <div className="control-dock"><div className="control-dock-top"><button onClick={() => setSheet('tasks')} disabled={frozen}><Icon name="list" size={15}/>任务 · {jobs.length}</button><span>{connection?.pausedAt ? '连接已暂停' : !view?.canDelegate ? '等待执行通道就绪' : jobs.some(job => !terminal.has(job.state)) ? '当前任务结束后可继续委托' : '公开任务 · 额外付费 0'}</span></div>
      <form className="control-command" onSubmit={event => { event.preventDefault(); if (draft.trim() && canSend) { setConfirmed(false); setSheet('send'); } }}><textarea aria-label="云端任务指令" placeholder="接下来，做点什么？" value={draft} onChange={event => setDraft(event.target.value)} disabled={readOnly || frozen} maxLength={6000}/><button aria-label="准备云端委托" disabled={!canSend || !draft.trim()}><Icon name="arrow" size={19}/></button></form>
    </div>
    {sheet && <Modal className="control-sheet" title={sheet === 'tasks' ? '云端任务' : sheet === 'send' ? '确认云端委托' : sheet === 'connection' ? '云端连接' : '任务进度'} onClose={close}>
      <h2>{sheet === 'tasks' ? '云端任务' : sheet === 'send' ? '确认云端委托' : sheet === 'connection' ? '云端连接' : '任务进度'}</h2>
      {sheet === 'tasks' && <div className="control-task-list">{jobs.length ? jobs.map(job => <button key={job.id} onClick={() => { setSelectedId(job.id); setSheet('detail'); }}><span><strong>{job.prompt.slice(0, 60)}</strong><small>{job.businessAcceptance === 'accepted' ? '已验收' : stateLabels[job.state] || job.state} · {job.files?.length || 0} 个文件</small></span><Icon name="chevron" size={16}/></button>) : <p className="control-empty">云端还没有任务</p>}</div>}
      {sheet === 'detail' && selected && <>
        <p className="cloud-prompt">{selected.prompt}</p><p className="control-detail-state">{stateLabels[selected.state] || selected.state}</p>
        {selected.id === current?.id && delivery && <p className="control-input-note">{delivery.dotReceivedAt ? 'xy 已确认收到事件' : delivery.httpReceivedAt ? '事件已送达，等待 xy 确认' : '等待事件送达'}</p>}
        <p className="cloud-result">{selected.resultSummary || selected.blocker?.message || (selected.state === 'queued' ? '尚未领取，不代表已经执行。' : '等待执行端回传记录。')}</p>
        {(selected.files || []).map(file => <a className="cloud-file" key={file.id} href={'/api/artifacts/' + encodeURIComponent(file.id) + '/download?version=' + file.version} download><Icon name="file" size={18}/>{file.filename || '任务文件'}<span>下载</span></a>)}
        {selected.conversationId && <button className="control-secondary" disabled={frozen} onClick={() => onConversation(selected.conversationId)}>打开原任务会话</button>}
        {selected.state === 'succeeded' && selected.businessAcceptance === 'not_reviewed' && selected.completionHash && <div className="control-actions"><button className="control-primary" disabled={!mayWrite} onClick={() => startAction('review', { jobId: selected.id, completionHash: selected.completionHash, decision: 'accepted' })}>确认验收这份成果</button><button className="control-secondary" disabled={!mayWrite} onClick={() => startAction('review', { jobId: selected.id, completionHash: selected.completionHash, decision: 'rejected' })}>拒绝这份成果</button></div>}
        {!terminal.has(selected.state) && selected.transport !== 'muse-native' && selected.state !== 'cancel_requested' && <div className="control-cancel">{cancelConfirm ? <><p>请求停止当前任务，执行端确认后才显示已停止。</p><button disabled={!mayWrite || selected.reconciliationRequired} onClick={() => startAction('cancel', { jobId: selected.id })}>确认请求停止</button></> : <button disabled={!mayWrite || selected.reconciliationRequired} onClick={() => setCancelConfirm(true)}>停止任务</button>}</div>}
      </>}
      {sheet === 'send' && <><p className="cloud-prompt">{draft}</p><label className="cloud-confirm">任务归属会话<select aria-label="任务归属会话" value={conversationId} onChange={event => setConversationId(event.target.value)} disabled={frozen}><option value="">选择原会话</option>{data.conversations.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{!data.conversations.length && <button className="control-secondary" onClick={() => onConversation()}>先创建任务会话</button>}<label className="cloud-confirm"><input type="checkbox" checked={confirmed} disabled={frozen} onChange={event => setConfirmed(event.target.checked)}/>我确认仅包含公开资料，委托 xy 执行并回传文件；额外付费为 0。</label><button className="control-primary" disabled={!canSend || !confirmed || !conversationId} onClick={() => startAction('delegate', { prompt: draft.trim(), confirmed: true, dataScope: 'public-only', conversationId })}>确认委托 xy</button></>}
      {sheet === 'connection' && <><p className="cloud-result">{stale ? error || '任务状态已过期' : connection?.authenticatedRecently ? '已收到原 Worker 的近期认证请求。' : '等待原 Worker 的近期认证请求。'}</p><p className="control-input-note">连接成功、事件送达、任务领取和成果验收分别显示，不互相替代。</p><button className="control-secondary" onClick={() => void refresh()}>刷新连接状态</button><button className="control-secondary" disabled={frozen} onClick={onSettings}>项目连接设置</button></>}
      {writer.error && <div className="control-error" role="alert">{writer.error}{writer.uncertain && <button disabled={writer.busy || stale} onClick={() => { if (pending.current) void write(pending.current.action, pending.current.body); }}>重试原请求</button>}</div>}
    </Modal>}
  </section>;
}
