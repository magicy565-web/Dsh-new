import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Modal } from '../Modal';
import { Icon } from '../icons';
import { useDirty, useWrite } from '../library/common';
import { ControlSpirit } from './ControlSpirit';
import type { SpiritState } from './ControlSpirit';
import type { Bootstrap } from '../types';
import { museState, museFileUrl, museOrderLabel, museExecutionLabel } from './museControl';
import type { MuseTask } from './museControl';

type FileRef = { id: string; version: number; sha256: string; filename?: string };
type Job = { muse?: MuseTask; id: string; prompt: string; state: string; conversationId?: string; transport?: string; claimedAt?: number; completedAt?: number; resultSummary?: string; files?: FileRef[]; completionHash?: string; businessAcceptance?: string; reconciliationRequired?: boolean; blocker?: { message?: string }; toolEvidence?: unknown; nativeRequestId?: string; receiptHash?: string | null; returnedHash?: string | null; closedHash?: string; dispatched?: boolean };
type WorkerView = { enabled: boolean; canDelegate: boolean; worker: null | { id: string; connection: null | { id: string; provider: string; authenticatedRecently: boolean; pausedAt?: number | null; drainingAt?: number | null } }; delegations: Job[]; dotTasks?: { requestId: string; nativeAgentId: string; jobId: string | null; prompt: string; state: string; receiptHash: string | null; returnedHash: string | null; acceptedHash?: string; closedHash?: string; receipt: null | { summary: string; files: FileRef[]; completionHash: string | null } }[]; museTasks?: MuseTask[]; dotEvents?: { deliveries: { taskRef: string; status: string; httpReceivedAt?: number; dotReceivedAt?: number }[] } };
const jobKey = (job: Job) => (job.muse ? 'muse:' : 'dot:') + job.id;
const jobLabel = (job: Job, now: number) => job.muse ? museState(job.muse, now).label : job.businessAcceptance === 'accepted' ? '已验收' : stateLabels[job.state] || job.state;
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'expired']);
const stateLabels: Record<string, string> = { preparing: '准备中', queued: '等待领取', leased: '已领取', running: '执行中', return_pending: '回传中', succeeded: '成果已回传', blocked: '执行受阻', uncertain: '等待核实', cancel_requested: '等待停止确认', cancelled: '已停止', failed: '执行失败', expired: '已过期' };

/** Same-origin adapter for the deployed personal Worker API. Never infers execution from login. */
export function CloudControl({ data, routeConversationId, ownerKey, readOnly, onDirty, onSettings, onCreateConversation }: { data: Bootstrap; routeConversationId?: string; ownerKey: string; readOnly: boolean; onDirty: (dirty: boolean) => void; onSettings: () => void; onCreateConversation: () => Promise<{ id: string } | undefined> }) {
  const native = data.runtime.cloudDot === true;
  const [view, setView] = useState<WorkerView | null>(null);
  const [error, setError] = useState('');
  const storageKey = 'workspace.control.' + ownerKey;
  const [restoredDraft] = useState(() => { try { return JSON.parse(sessionStorage.getItem(storageKey + '.draft') || 'null') as { text?: string; conversationId?: string } | null; } catch { return null; } });
  const [draft, setDraft] = useState(typeof restoredDraft?.text === 'string' ? restoredDraft.text : '');
  const [sheet, setSheet] = useState<'tasks' | 'detail' | 'send' | 'connection' | 'conversation' | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [conversationId, setConversationId] = useState(routeConversationId || (data.conversations.some(item => item.id === restoredDraft?.conversationId) ? restoredDraft!.conversationId : '') || data.conversations[0]?.id || '');
  useEffect(() => { if (routeConversationId) setConversationId(routeConversationId); }, [routeConversationId]);
  const [confirmed, setConfirmed] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [readAt, setReadAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const alive = useRef(true), reading = useRef(false);
  const writer = useWrite(storageKey + '.pending');
  useEffect(() => { try { sessionStorage.setItem(storageKey + '.draft', JSON.stringify({ text: draft, conversationId })); } catch { /* Draft still remains in memory. */ } }, [draft, conversationId, storageKey]);
  useEffect(() => { if (writer.uncertain) setSheet(previous => previous || 'connection'); }, [writer.uncertain]);
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
      if (!Array.isArray(result.delegations) || typeof result.enabled !== 'boolean' || (native && !Array.isArray(result.dotTasks)) || (result.museTasks !== undefined && !Array.isArray(result.museTasks))) throw Error('线上任务接口不兼容');
      if (native) result.delegations = result.dotTasks!.map(task => {
        const original = result.delegations.find(job => job.id === task.jobId);
        return { ...original, id: task.jobId || task.requestId, nativeRequestId: task.requestId, dispatched: !!task.jobId, conversationId: task.nativeAgentId, prompt: task.prompt, state: task.state, files: task.receipt?.files || [], resultSummary: task.receipt?.summary, completionHash: task.receipt?.completionHash || undefined, receiptHash: task.receiptHash, returnedHash: task.returnedHash, closedHash: task.closedHash, businessAcceptance: task.acceptedHash ? 'accepted' : 'not_reviewed' };
      });
      if (alive.current) { setView(result); setError(''); setReadAt(Date.now()); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '无法读取云端任务'); }
    finally { reading.current = false; }
  }, [native]);
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = window.setInterval(() => { setClock(Date.now()); if (!document.hidden) void refresh(); }, 3000);
    const visibility = () => { setClock(Date.now()); if (!document.hidden) void refresh(); };
    const events = native ? null : new EventSource('/api/events');
    events?.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => { alive.current = false; clearInterval(timer); events?.close(); document.removeEventListener('visibilitychange', visibility); };
  }, [refresh, native]);
  const stale = !!error || !!readAt && clock - readAt > 12000;
  const museJobs: Job[] = (view?.museTasks || []).map(task => { const progress = museState(task, clock); return { muse: task, id: task.orderId, prompt: task.objective || task.product || 'Muse 任务', state: progress.state, conversationId: task.nativeAgentId, resultSummary: task.receipt?.summary || task.summary, files: task.receipt?.files || [], businessAcceptance: progress.accepted ? 'accepted' : 'not_reviewed' }; });
  const jobs = [...museJobs.reverse(), ...[...(view?.delegations || [])].reverse()];
  const scopedJobs = routeConversationId ? jobs.filter(job => job.conversationId === routeConversationId) : jobs;
  const current = scopedJobs.find(job => !terminal.has(job.state)) || scopedJobs.find(job => job.state === 'succeeded' && job.businessAcceptance === 'not_reviewed') || scopedJobs[0];
  const selected = jobs.find(job => jobKey(job) === selectedId) || current;
  const connection = view?.worker?.connection;
  const running = !!current && (current.muse ? museState(current.muse, clock).active : ['leased', 'running', 'return_pending'].includes(current.state));
  const needsAttention = !!current && ['blocked', 'uncertain', 'failed', 'cancel_requested'].includes(current.state) || !!current && current.state === 'succeeded' && current.businessAcceptance === 'not_reviewed';
  const state: SpiritState = stale ? 'offline' : !view ? 'loading' : needsAttention ? 'attention' : running ? 'working' : !connection?.authenticatedRecently ? 'setup' : 'idle';
  const headline = stale ? '连接中断' : !view ? '正在连接云端' : current?.muse ? jobLabel(current, clock) : current && !terminal.has(current.state) ? stateLabels[current.state] || '等待核实' : needsAttention ? '成果待你验收' : '我在这里';
  const delivery = view?.dotEvents?.deliveries.filter(item => !current?.muse && item.taskRef === current?.id).at(-1);
  const mayWrite = !readOnly && !stale && !!view && !frozen;
  const canSend = mayWrite && view?.canDelegate && (!native || data.runtime.cloudWorkerReady === true) && !connection?.pausedAt && !connection?.drainingAt && !jobs.some(job => !job.muse && (!terminal.has(job.state) || native && !job.closedHash && job.businessAcceptance !== 'accepted'));
  const stage = !current ? -1 : current.muse ? museState(current.muse, clock).stage : current.state === 'succeeded' ? 3 : current.state === 'return_pending' ? 2 : current.claimedAt || ['leased', 'running'].includes(current.state) ? 1 : 0;
  function close() { if (!frozen) { setSheet(null); setCancelConfirm(false); writer.clear(); } }
  async function write(action: string, body: Record<string, unknown>) {
    if (readOnly || stale || writer.busy) return;
    pending.current ||= { action, body };
    const saved = pending.current;
    let endpoint = '/personal-worker/' + saved.action, payload = saved.body, originalRequestId: string | undefined;
    if (native) {
      if (saved.action === 'delegate') { endpoint = '/conversations/' + encodeURIComponent(String(saved.body.conversationId)) + '/messages'; payload = { content: saved.body.prompt, confirmed: true, dataScope: 'public-only' }; }
      else { endpoint = '/cloud-worker/' + (saved.action === 'review' ? 'accept' : saved.action); originalRequestId = String(saved.body.nativeRequestId); payload = { confirmed: true, ...(saved.action !== 'cancel' ? { receiptHash: saved.body.receiptHash } : {}) }; }
    }
    const result = await writer.write<WorkerView>(endpoint, 'POST', payload, originalRequestId);
    if (result) { pending.current = null; if (!native) { setView(result); setReadAt(Date.now()); } if (saved.action === 'delegate') { setDraft(''); setConfirmed(false); setSheet(null); } setCancelConfirm(false); void refresh(); }
  }
  async function retryOriginal() {
    if (readOnly || stale || !view || writer.busy) return;
    const original = writer.pendingRequest;
    const result = await writer.retry<WorkerView>();
    if (result) { pending.current = null; if (original?.path.endsWith('/messages') || original?.path.endsWith('/delegate')) { setDraft(''); setConfirmed(false); } setCancelConfirm(false); setSheet(null); void refresh(); }
  }
  function startAction(action: string, body: Record<string, unknown>) { if (!writer.uncertain) pending.current = null; void write(action, body); }
  return <section ref={screen} className="master-control cloud-control" data-testid="v22-cloud-control">
    <header className="control-header"><span className="control-wordmark">Workspace<span>主控</span></span><button className="control-cloud-status" onClick={() => setSheet('connection')} disabled={frozen}><span className={'control-dot ' + (connection?.authenticatedRecently && !stale ? 'state-completed' : '')}/>{stale ? '连接中断' : museJobs.length ? '云端 xy · Muse' : '云端 xy'}</button></header>
    <div className="control-center">
      <ControlSpirit state={state} onOpen={() => { if (!frozen) setSheet('tasks'); }}/>
      <div className="control-presence" aria-live="polite"><h1>{headline}</h1><p>{current ? current.prompt.slice(0, 34) + (current.prompt.length > 34 ? '…' : '') : '把下一件事交给我'}</p></div>
      {current && <button className="cloud-progress" aria-label="查看云端任务进度" disabled={frozen} onClick={() => { setSelectedId(jobKey(current)); setSheet('detail'); }}>
        {(current.muse ? ['已派发', '已领取', '成果已提交', '已送达'] : ['已提交', '已领取', '回传中', '已回传']).map((label, index) => <span key={label} data-reached={index <= stage} data-active={!stale && running && index === stage}><i/><small>{label}</small></span>)}
      </button>}
      {stale && <button className="control-task-peek" onClick={() => void refresh()}>重新连接</button>}
    </div>
    <div className="control-dock"><div className="control-dock-top"><button onClick={() => setSheet('tasks')} disabled={frozen}><Icon name="list" size={15}/>任务 · {jobs.length}</button><span>{connection?.pausedAt ? (museJobs.length ? 'Dot 连接已暂停' : '连接已暂停') : !view?.canDelegate || native && !data.runtime.cloudWorkerReady ? '等待执行通道就绪' : jobs.some(job => !job.muse && !terminal.has(job.state)) ? '当前任务结束后可继续委托' : '公开任务 · 额外付费 0'}</span></div>
      <form className="control-command" onSubmit={event => { event.preventDefault(); if (draft.trim() && canSend) { setConfirmed(false); setSheet('send'); } }}><textarea aria-label="云端任务指令" placeholder="接下来，做点什么？" value={draft} onChange={event => setDraft(event.target.value)} disabled={readOnly || frozen} maxLength={6000}/><button aria-label="准备云端委托" disabled={!canSend || !draft.trim()}><Icon name="arrow" size={19}/></button></form>
    </div>
    {sheet && <Modal className="control-sheet" title={sheet === 'tasks' ? '云端任务' : sheet === 'send' ? '确认云端委托' : sheet === 'connection' ? '云端连接' : sheet === 'conversation' ? '原会话记录' : '任务进度'} onClose={close}>
      <h2>{sheet === 'tasks' ? '云端任务' : sheet === 'send' ? '确认云端委托' : sheet === 'connection' ? '云端连接' : sheet === 'conversation' ? '原会话记录' : '任务进度'}</h2>
      {sheet === 'tasks' && <div className="control-task-list">{jobs.length ? jobs.map(job => <button key={jobKey(job)} onClick={() => { setSelectedId(jobKey(job)); setCancelConfirm(false); setSheet('detail'); }}><span><strong>{job.prompt.slice(0, 60)}</strong><small>{job.muse ? 'Muse' : native ? 'Dot' : 'xy'} · {jobLabel(job, clock)} · {job.files?.length || 0} 个文件</small></span><Icon name="chevron" size={16}/></button>) : <p className="control-empty">云端还没有任务</p>}</div>}
      {sheet === 'detail' && selected && <>
        <p className="cloud-prompt">{selected.prompt}</p><p className="control-detail-state">{jobLabel(selected, clock)}</p>
        {!selected.muse && selected.id === current?.id && delivery && <p className="control-input-note">{delivery.dotReceivedAt ? 'xy 已确认收到事件' : delivery.httpReceivedAt ? '事件已送达，等待 xy 确认' : '等待事件送达'}</p>}
        <p className="cloud-result">{selected.resultSummary || selected.blocker?.message || (selected.state === 'queued' ? '尚未领取，不代表已经执行。' : '等待执行端回传记录。')}</p>
        {selected.muse && <div className="cloud-muse-meta"><p>Muse · {museOrderLabel(selected.muse)} · {museExecutionLabel(selected.muse)}</p><p>{museState(selected.muse, clock).delivered ? '成果已送达原会话。' : '成果尚未确认送达原会话。'}外部成果未经独立核验。</p><dl><dt>原订单</dt><dd>{selected.muse.orderId}</dd><dt>执行任务</dt><dd>{selected.muse.taskRef || '尚未派发'}</dd><dt>额度上限</dt><dd>{selected.muse.budgetCredits} credits</dd></dl><a className="control-secondary" href={'/services/' + encodeURIComponent(selected.muse.orderId)}>查看原订单与验收</a></div>}
        {(selected.files || []).map(file => { const href = selected.muse ? museFileUrl(file) : native ? '/api/cloud-worker/files/' + encodeURIComponent(file.id) + '?version=' + file.version + '&sha256=' + encodeURIComponent(file.sha256) : '/api/artifacts/' + encodeURIComponent(file.id) + '/download?version=' + file.version; return href ? <a className="cloud-file" key={file.id + ':' + file.version} href={href} download><Icon name="file" size={18}/>{file.filename || data.artifacts?.find(item => item.id === file.id)?.filename || '任务文件'}<span>下载</span></a> : <p className="control-input-note" key={file.id}>文件引用不完整，等待原订单核对。</p>; })}
        {selected.conversationId && <button className="control-secondary" disabled={frozen} onClick={() => setSheet('conversation')}>查看原会话记录</button>}
        {!selected.muse && selected.state === 'succeeded' && selected.businessAcceptance === 'not_reviewed' && selected.completionHash && (!native || !!selected.returnedHash) && <div className="control-actions"><button className="control-primary" disabled={!mayWrite} onClick={() => startAction('review', { jobId: selected.id, completionHash: selected.completionHash, decision: 'accepted', ...(native ? { nativeRequestId: selected.nativeRequestId, receiptHash: selected.receiptHash } : {}) })}>确认验收这份成果</button>{!native && <button className="control-secondary" disabled={!mayWrite} onClick={() => startAction('review', { jobId: selected.id, completionHash: selected.completionHash, decision: 'rejected' })}>拒绝这份成果</button>}</div>}
        {!selected.muse && !terminal.has(selected.state) && (!native || selected.dispatched) && selected.transport !== 'muse-native' && selected.state !== 'cancel_requested' && <div className="control-cancel">{cancelConfirm ? <><p>请求停止当前任务，执行端确认后才显示已停止。</p><button disabled={!mayWrite || selected.reconciliationRequired} onClick={() => startAction('cancel', { jobId: selected.id, ...(native ? { nativeRequestId: selected.nativeRequestId } : {}) })}>确认请求停止</button></> : <button disabled={!mayWrite || selected.reconciliationRequired} onClick={() => setCancelConfirm(true)}>停止任务</button>}</div>}
        {!selected.muse && native && ['failed', 'cancelled', 'expired'].includes(selected.state) && selected.returnedHash && !selected.closedHash && <button className="control-secondary" disabled={!mayWrite} onClick={() => startAction('close', { nativeRequestId: selected.nativeRequestId, receiptHash: selected.receiptHash })}>确认结束此任务</button>}
      </>}
      {sheet === 'send' && <><p className="cloud-prompt">{draft}</p><label className="cloud-confirm">任务归属会话<select aria-label="任务归属会话" value={conversationId} onChange={event => setConversationId(event.target.value)} disabled={frozen}><option value="">选择原会话</option>{data.conversations.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{!data.conversations.length && <button className="control-secondary" disabled={!mayWrite} onClick={async () => { const created = await onCreateConversation(); if (created) setConversationId(created.id); }}>创建任务会话</button>}<label className="cloud-confirm"><input type="checkbox" checked={confirmed} disabled={frozen} onChange={event => setConfirmed(event.target.checked)}/>我确认仅包含公开资料，委托 xy 执行并回传文件；额外付费为 0。</label><button className="control-primary" disabled={!canSend || !confirmed || !conversationId} onClick={() => startAction('delegate', { prompt: draft.trim(), confirmed: true, dataScope: 'public-only', conversationId })}>确认委托 xy</button></>}
      {sheet === 'connection' && <><p className="cloud-result">{stale ? error || '任务状态已过期' : connection?.authenticatedRecently ? '已收到原 Worker 的近期认证请求。' : '等待原 Worker 的近期认证请求。'}</p><p className="control-input-note">连接成功、事件送达、任务领取和成果验收分别显示，不互相替代。</p><button className="control-secondary" onClick={() => void refresh()}>刷新连接状态</button><button className="control-secondary" disabled={frozen} onClick={onSettings}>项目连接设置</button></>}
      {sheet === 'conversation' && <><button className="control-back" disabled={frozen} onClick={() => setSheet('detail')}>返回任务</button><div className="cloud-conversation">{data.messages.filter(message => message.conversationId === (selected?.conversationId || conversationId)).map(message => <article key={message.id}><small>{message.role === 'user' ? '你' : message.role === 'assistant' ? '助手' : '系统'}</small><p>{message.content || (message.status === 'pending' ? '等待回复' : '暂无文本')}</p></article>)}</div></>}
      {writer.error && <div className="control-error" role="alert">{writer.error}{writer.uncertain && <button disabled={readOnly || !view || writer.busy || stale} onClick={() => void retryOriginal()}>重试原请求</button>}</div>}
    </Modal>}
  </section>;
}
