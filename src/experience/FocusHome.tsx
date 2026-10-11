import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from '../icons';
import { Modal } from '../Modal';
import { useDirty, useWrite } from '../library/common';
import type { Bootstrap, Goal } from '../types';
import type { DiagnosticsView } from '../Diagnostics';
import { ControlSpirit } from './ControlSpirit';
import type { SpiritState } from './ControlSpirit';
import './focus-v21.css';
import './master-control.css';

const labels: Record<string, string> = { draft: '等待启动', running: '正在推进', awaiting_approval: '等待批准', review_required: '等待验收', paused: '已暂停', blocked: '遇到阻碍', failed: '执行失败', completed: '已验收', cancelled: '已取消' };
const attentionStates = ['awaiting_approval', 'review_required', 'blocked', 'failed'];
const finishedStates = ['completed', 'cancelled'];
const priority = (goal: Goal) => attentionStates.includes(goal.status) ? 0 : goal.status === 'running' ? 1 : finishedStates.includes(goal.status) ? 3 : 2;
export type ControlDestination = 'commerce' | 'library' | 'workers' | 'services' | 'activity';
type Attempt = { path: string; method: string; body: Record<string, unknown>; kind: 'action' | 'message'; goalId: string };

// Configuration is never described as a verified live connection.
export function HarnessTag({ runtime, onDetails }: { runtime?: Bootstrap['runtime']; onDetails: () => void }) {
  const native = runtime?.kind === 'deepseek-harness';
  const ready = native && runtime?.configured === true;
  return <button type="button" className={`ys21-runtime ${ready ? 'is-native' : ''}`} onClick={onDetails} aria-label={ready ? '查看原生 Harness 配置信息' : '查看 Harness 连接要求'}>
    <span className="ys21-live-dot" aria-hidden="true" /><span>{ready ? 'Harness 已配置' : native ? 'Harness 未配置' : 'Harness 未启用'}</span><Icon name="chevron" size={15} />
  </button>;
}

export function FocusHome({ data, loading, connection, draft, onDraft, onNew, onOpen, onRuntime, onNavigate, onRefresh, onDirty, readOnly, focusedGoalId }: {
  data: Bootstrap | null; loading: boolean; connection: DiagnosticsView['state']; draft: string; onDraft: (value: string) => void;
  onNew: (description: string) => void; onOpen: (goal: Goal, intent?: 'review' | 'approval') => void; onRuntime: () => void;
  onNavigate: (destination: ControlDestination) => void; onRefresh: () => Promise<void>; onDirty: (dirty: boolean) => void;
  readOnly: boolean; focusedGoalId?: string;
}) {
  const [sheet, setSheet] = useState<'tasks' | 'detail' | 'menu' | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [targetId, setTargetId] = useState<string>();
  const [filter, setFilter] = useState<'active' | 'attention' | 'history'>('active');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [notice, setNotice] = useState('');
  const writer = useWrite();
  const attempt = useRef<Attempt | null>(null);
  const submitLock = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const screen = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const compact = !!viewport && window.innerWidth <= 760 && viewport.height < window.innerHeight - 80;
      if (screen.current) { screen.current.dataset.keyboard = String(compact); screen.current.style.setProperty('--control-height', compact ? `${viewport!.height}px` : '100%'); }
    };
    update(); viewport?.addEventListener('resize', update);
    return () => viewport?.removeEventListener('resize', update);
  }, []);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timer); } }, [notice]);
  const frozen = writer.busy || writer.uncertain;
  useDirty(frozen, onDirty);
  useEffect(() => { if (focusedGoalId) { setSelectedId(focusedGoalId); setSheet('detail'); } }, [focusedGoalId]);
  const statusOf = (goal: Goal) => {
    const conversation = data?.conversations.find(item => item.id === goal.conversationId);
    return conversation && ['running', 'awaiting_approval', 'failed', 'blocked'].includes(conversation.status || '') ? conversation.status! : goal.status;
  };
  const goals = [...(data?.goals || [])].sort((a, b) => priority({ ...a, status: statusOf(a) }) - priority({ ...b, status: statusOf(b) }) || b.updatedAt.localeCompare(a.updatedAt));
  const active = goals.filter(goal => !finishedStates.includes(statusOf(goal)));
  const attention = goals.filter(goal => attentionStates.includes(statusOf(goal))); 
  const running = goals.filter(goal => statusOf(goal) === 'running');
  const selected = goals.find(goal => goal.id === selectedId) || (!selectedId ? active[0] || goals[0] : undefined);
  const selectedStatus = selected ? statusOf(selected) : '';
  const target = goals.find(goal => goal.id === targetId);
  const offline = ['disconnected', 'stale'].includes(connection);
  const ready = data?.runtime.kind === 'deepseek-harness' && data.runtime.configured;
  const locked = readOnly || offline || loading || !data;
  const state: SpiritState = offline ? 'offline' : loading || !data ? 'loading' : attention.length ? 'attention' : running.length ? 'working' : !ready ? 'setup' : 'idle';
  const headline = { offline: '连接中断', loading: '正在同步', attention: '需要你看一下', working: '正在推进', setup: '等待连接', idle: active.length ? '随时可以开始' : '我在这里' }[state];
  const subtitle = offline ? '当前显示上次记录' : loading ? '正在读取任务' : attention.length ? `${attention.length} 项待处理` : running.length ? `${running.length} 项任务进行中` : active.length ? `${active.length} 项任务已保存` : '把下一件事交给我';
  const currentRun = [...(data?.runs || [])].reverse().find(run => run.goalId === selected?.id || (!!selected?.conversationId && run.conversationId === selected.conversationId));
  const step = selectedStatus === 'running' ? currentRun?.plan?.find(item => ['running', 'in_progress'].includes(item.status))?.title : undefined;
  const canFollowup = !!target?.conversationId && ready && !['draft', 'running', 'awaiting_approval', 'cancelled'].includes(statusOf(target));
  const shown = goals.filter(goal => filter === 'attention' ? attentionStates.includes(statusOf(goal)) : filter === 'history' ? finishedStates.includes(statusOf(goal)) : !finishedStates.includes(statusOf(goal)));
  const activities = (data?.activity || []).filter(item => item.goalId === selected?.id).slice(-4).reverse();
  function closeSheet() { if (!frozen) { setSheet(null); setConfirmCancel(false); writer.clear(); } }
  function selectGoal(goal: Goal) { setSelectedId(goal.id); setConfirmCancel(false); writer.clear(); setSheet('detail'); }
  async function sendAttempt(next: Attempt) {
    if (locked || submitLock.current) return;
    submitLock.current = true;
    attempt.current = attempt.current || next;
    const savedAttempt = attempt.current;
    try {
      const result = await writer.write(savedAttempt.path, savedAttempt.method, savedAttempt.body);
      if (result) {
        attempt.current = null;
        if (savedAttempt.kind === 'message') onDraft('');
        setConfirmCancel(false);
        setNotice(savedAttempt.kind === 'message' ? '指令已提交' : '操作已提交');
        await onRefresh();
      }
    } finally { submitLock.current = false; }
  }
  useEffect(() => { if (!writer.busy && !writer.uncertain) attempt.current = null; }, [writer.busy, writer.uncertain]);
  function act(action: string) {
    if (!selected || frozen || locked) return;
    if (action === 'pause' && selected.status !== 'running' && selectedStatus === 'running' && selected.conversationId) {
      void sendAttempt({ path: `/conversations/${encodeURIComponent(selected.conversationId)}/cancel`, method: 'POST', body: {}, goalId: selected.id, kind: 'action' }); return;
    }
    void sendAttempt({ path: `/goals/${encodeURIComponent(selected.id)}`, method: 'PATCH', body: { action }, goalId: selected.id, kind: 'action' });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || frozen || !draft.trim()) return;
    if (!targetId) { onNew(draft.trim()); return; }
    if (target && canFollowup) void sendAttempt({ path: `/conversations/${encodeURIComponent(target.conversationId!)}/messages`, method: 'POST', body: { content: draft.trim(), workspaceExecution: true }, goalId: target.id, kind: 'message' });
  }
  const feedback = <>{writer.error && <div className="control-error" role="alert"><span>{writer.uncertain ? '提交结果待确认，请重试原请求。' : writer.error}</span>{writer.uncertain && <button type="button" disabled={locked || writer.busy} onClick={() => attempt.current && void sendAttempt(attempt.current)}>重试原请求</button>}</div>}{notice && !writer.error && <p className="control-feedback" role="status">{notice}</p>}</>;

  return <section ref={screen} className="master-control" data-testid="v22-master-control" data-state={state} aria-label="主控工作台">
    <header className="control-header"><span className="control-wordmark">{data?.settings.name || 'Workspace'}<span>主控</span></span><button className="control-icon" type="button" aria-label="打开工作空间菜单" aria-haspopup="dialog" disabled={frozen} onClick={() => setSheet('menu')}><Icon name="menu" size={21} /></button></header>
    <div className="control-center">
      <ControlSpirit state={state} onOpen={() => { if (!frozen) setSheet('tasks'); }} />
      <div className="control-presence" aria-live="polite"><h1>{headline}</h1><p>{subtitle}</p></div>
      {offline ? <button type="button" className="control-task-peek" onClick={() => void onRefresh()}><Icon name="refresh" size={15} />重新连接</button> : selected ? <button type="button" className="control-task-peek" disabled={frozen} onClick={() => selectGoal(selected)}><i className={`control-dot state-${selectedStatus}`} /><span>{selected.title}</span><Icon name="chevron" size={16} /></button> : !loading && !ready ? <button type="button" className="control-task-peek" disabled={frozen} onClick={onRuntime}>连接执行环境<Icon name="chevron" size={16} /></button> : null}
    </div>
    <footer className="control-dock">
      {!sheet && feedback}
      <div className="control-dock-top"><button type="button" disabled={frozen} onClick={() => setSheet('tasks')}><Icon name="list" size={16} />任务{goals.length ? ` · ${goals.length}` : ''}</button>{targetId ? <button type="button" className="control-target" disabled={frozen} onClick={() => setTargetId(undefined)} aria-label="切换为新目标">{target?.title || '原任务已移除'}<Icon name="close" size={13} /></button> : <span>{readOnly ? '仅可查看' : '新目标'}</span>}</div>
      <form className="control-command" onSubmit={submit}><textarea ref={input} aria-label="主控指令" value={draft} onChange={event => { onDraft(event.target.value); setNotice(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={1} maxLength={targetId ? 12000 : 15000} placeholder={targetId ? '补充这项任务…' : '接下来，做点什么？'} disabled={locked || frozen} /><button type="submit" aria-label={targetId ? '发送任务指令' : '创建新目标'} disabled={locked || frozen || !draft.trim() || (!!targetId && !canFollowup)}><Icon name="arrow" size={21} /></button></form>
      {targetId && !canFollowup && <p className="control-input-note">{target ? '当前任务暂不能接收指令，请先查看任务状态。' : '原任务已移除，请切换为新目标。'}</p>}
    </footer>
    {sheet && <Modal title={sheet === 'tasks' ? '主控任务' : sheet === 'menu' ? '工作空间' : '任务控制'} onClose={closeSheet} className="control-sheet">
      {sheet === 'menu' ? <><h2>工作空间</h2><div className="control-menu">{([{ destination: 'library', label: '企业与产品', icon: 'library' }, { destination: 'commerce', label: '产品托管', icon: 'box' }, { destination: 'services', label: '委托任务', icon: 'work' }, { destination: 'workers', label: '云端专家', icon: 'people' }, { destination: 'activity', label: '工作记录', icon: 'activity' }] as const).map(item => <button type="button" key={item.destination} onClick={() => { closeSheet(); onNavigate(item.destination); }}><Icon name={item.icon} size={20} />{item.label}<Icon name="chevron" size={17} /></button>)}<button type="button" onClick={() => { closeSheet(); onRuntime(); }}><Icon name="settings" size={20} />连接与设置<Icon name="chevron" size={17} /></button></div></> : sheet === 'tasks' ? <>
        <h2>任务</h2><div className="control-filters" aria-label="任务筛选">{([{ value: 'active', label: '进行中' }, { value: 'attention', label: '待处理' }, { value: 'history', label: '已结束' }] as const).map(item => <button type="button" aria-pressed={filter === item.value} key={item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
        {offline && <p className="control-input-note">上次同步的任务 · 连接恢复后可操作</p>}
        <div className="control-task-list">{shown.length ? shown.map(goal => <button type="button" key={goal.id} onClick={() => selectGoal(goal)}><i className={`control-dot state-${statusOf(goal)}`} /><span><strong>{goal.title}</strong><small>{labels[statusOf(goal)] || statusOf(goal)}</small></span><Icon name="chevron" size={17} /></button>) : <p className="control-empty">{loading ? '正在读取…' : filter === 'attention' ? '没有待处理事项' : filter === 'history' ? '还没有已结束的任务' : '从一个新目标开始'}</p>}</div>
        <button type="button" className="control-primary" disabled={locked} onClick={() => { closeSheet(); setTargetId(undefined); onNew(''); }}><Icon name="plus" size={17} />新目标</button>
      </> : selected ? <>
        <button type="button" className="control-back" disabled={frozen} onClick={() => { setSheet('tasks'); setConfirmCancel(false); writer.clear(); }}><Icon name="back" size={16} />所有任务</button>
        <h2>{selected.title}</h2><p className="control-detail-state"><i className={`control-dot state-${selectedStatus}`} />{labels[selectedStatus] || selectedStatus}</p>
        {step && <p className="control-current-step">{step}</p>}
        {(currentRun?.error?.message || selected.lastError?.message) && <p className="control-error">{currentRun?.error?.message || selected.lastError?.message}</p>}
        {offline && <p className="control-input-note">连接中断，暂不能操作</p>}
        {feedback}
        <div className="control-actions">
          {selectedStatus === 'running' && <button className="control-primary" type="button" disabled={locked || frozen} onClick={() => act('pause')}><Icon name="pause" size={16} />{selected.status === 'running' ? '暂停任务' : '停止本次运行'}</button>}
          {['draft', 'paused', 'blocked', 'failed'].includes(selected.status) && !['running', 'awaiting_approval'].includes(selectedStatus) && <button className="control-primary" type="button" disabled={locked || frozen} onClick={() => ready ? act(selected.status === 'draft' ? 'start' : 'resume') : (closeSheet(), onRuntime())}><Icon name="play" size={16} />{ready ? selected.status === 'draft' ? '启动任务' : '继续任务' : '连接执行环境'}</button>}
          {['awaiting_approval', 'review_required'].includes(selectedStatus) && <button className="control-primary" type="button" disabled={frozen} onClick={() => { closeSheet(); onOpen(selected, selectedStatus === 'awaiting_approval' ? 'approval' : 'review'); }}><Icon name="shield" size={16} />{selectedStatus === 'awaiting_approval' ? '查看并审批' : '查看并验收'}</button>}
          <button className="control-secondary" type="button" disabled={frozen} onClick={() => { closeSheet(); onOpen(selected); }}>打开工作会话<Icon name="arrow-right" size={16} /></button>
          {selected.conversationId && !['draft', 'running', 'awaiting_approval', 'cancelled'].includes(selectedStatus) && <button className="control-secondary" type="button" disabled={locked || frozen || !ready} onClick={() => { setTargetId(selected.id); closeSheet(); setTimeout(() => input.current?.focus(), 0); }}>补充指令<Icon name="chat" size={16} /></button>}
        </div>
        <details className="control-records"><summary>任务资料与记录<Icon name="chevron" size={15} /></summary><p>{selected.description || '暂无补充说明'}</p>{activities.map(item => <div key={item.id}><span>{item.title}</span><time>{new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>)}</details>
        {!finishedStates.includes(selected.status) && selectedStatus === selected.status && selected.status !== 'review_required' && <div className="control-cancel">{confirmCancel ? <><p>停止「{selected.title}」？记录会保留。</p><button type="button" disabled={locked || frozen} onClick={() => act('cancel')}>确认停止</button><button type="button" disabled={frozen} onClick={() => setConfirmCancel(false)}>保留任务</button></> : <button type="button" disabled={locked || frozen} onClick={() => setConfirmCancel(true)}>停止任务</button>}</div>}
      </> : <p className="control-empty">任务已移除</p>}
    </Modal>}
  </section>;
}
