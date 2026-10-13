import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Icon } from '../icons';
import type { Artifact, Bootstrap, Goal, Run, Message, ActionProposal, Activity } from '../types';
import { ConversationFiles } from './ConversationFiles';
import { GoalCommerceContext } from '../commerce/GoalCommerceContext';
import './focus-v21.css';

const display = (s: string) => ({ draft: '目标已保存 · 等待启动', running: '执行中', awaiting_approval: '等待你的审批', paused: '已暂停', review_required: '成果待验收', completed: '已验收', failed: '执行失败', blocked: '执行受阻', cancelled: '已取消' } as Record<string,string>)[s] || s;
const activityLabel = (title:string) => ({ 'Goal created':'目标已创建','Goal started':'目标已开始执行','Goal paused':'执行已暂停','Goal completed':'已完成验收','Goal updated':'目标已更新','Text output ready for review':'成果等待验收'} as Record<string,string>)[title] || title;

export function GoalFocus({ goal, runtime, runs, artifacts, messages, activity, working, readOnly, revision, inputLabel, runCards, onBack, onStart, onPause, onReview, onApproval, onReferences, onInputs, onRetry, onChannels, onCommerceProject, onResearchOrder, onRuntime, onFollowup }: {
  goal: Goal; runtime?: Bootstrap['runtime']; runs: Run[]; artifacts: Artifact[]; messages: Message[]; activity: Activity[];
  working: boolean; readOnly: boolean; onBack: () => void; onStart: () => void; onPause: () => void; onReview: () => void;
  onApproval: (run: Run, proposal: ActionProposal) => void; onReferences: () => void; onInputs: () => void; onRetry: (run: Run) => void; onChannels: () => void; onRuntime: () => void;
  inputLabel: string; runCards: ReactNode;
  revision: number; onCommerceProject: (id: string) => void; onResearchOrder: (id: string) => void;
  onFollowup: (content: string) => Promise<boolean>;
}) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const current = runs.filter(run => run.goalId === goal.id).at(-1);
  const latestAssistant = [...messages].reverse().find(m=>m.role==='assistant'&&m.status==='complete'&&m.content);
  const separateResult = Boolean(goal.output?.trim() && goal.output.trim() !== latestAssistant?.content?.trim());
  const pi = runtime?.kind === 'pi-durable';
  const supported = pi || runtime?.kind === 'deepseek-harness';
  const ready = supported && runtime?.configured === true;
  const interrupted = current?.status === 'interrupted';
  const approvals = runs.flatMap(r=>(r.proposals || []).filter(p=>p.status==='pending'||p.status==='approved').map(p=>({run:r,proposal:p})));
  const log = activity.filter(a=>a.goalId===goal.id).slice(-8).reverse();
  const canFollowup = Boolean(goal.conversationId) && ready && !interrupted && !['draft','running','awaiting_approval'].includes(goal.status) && !readOnly && !working && !sending;
  const canStart = ['draft','paused','blocked','failed'].includes(goal.status);
  const action = interrupted ? '恢复原任务' : goal.status==='running' ? '查看工作过程' : goal.status==='awaiting_approval' ? '审核操作' : goal.status==='review_required' ? '验收成果' : canStart ? ready ? goal.status === 'draft' ? '开始推进' : '继续任务' : '查看运行配置' : '继续会话';
  const caption = interrupted ? '原运行已中断。核对已有输入与权限后显式恢复；重新打开页面不会自动执行。' : ['failed','blocked'].includes(goal.status)&&goal.lastError?.message?goal.lastError.message:!supported?'当前运行方式无法推进目标，请查看部署配置。':!ready?'Pi 模型尚未由部署方配置。目标已保存，配置完成后才能推进。':goal.status==='draft'?'开始后使用已审阅的目标输入。文件成果由原运行保存，外部动作需要具体审批后继续。':goal.status==='running'?'真实进展来自运行事件；没有事件不会伪造进度。': '执行、审批与交付均以服务端记录为准。';
  async function submit(e: FormEvent) {
    e.preventDefault(); if(!canFollowup||!reply.trim())return;
    setSending(true);
    try { if(await onFollowup(reply.trim())) setReply(''); } finally { setSending(false); }
  }
  function mainAction() {
    if (interrupted && current) { onRetry(current); return; }
    if(goal.status==='awaiting_approval') { if(approvals[0]) onApproval(approvals[0].run,approvals[0].proposal); return; }
    if(goal.status==='review_required') { onReview(); return; }
    if(goal.status==='running') {document.getElementById('ys21-activity')?.scrollIntoView({behavior:'smooth'});return;}
    if(canStart) { if(ready)onStart(); else onRuntime(); return; }
    document.getElementById('ys21-conversation')?.scrollIntoView({behavior:'smooth'});
  }
  return <main className="ys21-goal" data-testid="v21-goal-session">
    <div className="ys21-detail-top"><button type="button" onClick={onBack} aria-label="返回工作"><Icon name="back" size={22}/></button><span>目标工作会话</span><button type="button" className="workspace-runtime-tag" onClick={onRuntime}>{pi ? 'Pi' : '运行配置'} · {ready ? '已配置' : '待配置'}</button></div>
    <header className="ys21-goal-header"><h1>{goal.title}</h1><span className="ys21-status"><span aria-hidden="true" className="ys21-state-dot"/>{display(goal.status)}</span></header>
    <section className="ys21-current" aria-label="当前状态"><span className="ys21-eyebrow">下一步</span><h2>{interrupted ? '核对并恢复原运行' : goal.status==='draft'?(ready?'可以开始了':'等待模型配置'):goal.status==='running'?(pi ? 'Pi 正在工作' : '助手正在工作'):goal.status==='review_required'?'等待你的判断':goal.status==='awaiting_approval'?'需要你批准':display(goal.status)}</h2><p>{caption}</p><button type="button" className="ys21-primary" disabled={working||readOnly||(goal.status==='awaiting_approval'&&!approvals.length)} onClick={mainAction}>{working?'正在提交…':action}<Icon name="arrow-right" size={19}/></button>
      {goal.status==='running'&&<button type="button" className="ys21-pause" onClick={onPause} disabled={working||readOnly}><Icon name="pause" size={16}/> 暂停执行</button>}
    </section>
    <div className="workspace-goal-inputs"><button type="button" className="secondary-button" aria-label="审阅目标输入" onClick={onInputs} disabled={working || goal.status === 'running'}>审阅目标输入 · {inputLabel}</button><p>资料库关联保留在本地。Pi 仅使用你另外明确选择的公开输入；内部文档与成本不会自动发送。</p></div>
    <div className="ys21-scope"><button type="button" onClick={onReferences} aria-label="查看目标产品和文件版本"><Icon name="library" size={18}/><span>资料</span><Icon name="chevron" size={16}/></button><button type="button" onClick={() => { const detail = document.getElementById('ys22-commerce-details') as HTMLDetailsElement | null; if (detail) detail.open = true; document.getElementById('ys22-commerce-context')?.scrollIntoView({ behavior: 'auto', block: 'start' }); }} aria-label="查看目标渠道范围"><Icon name="channels" size={18}/><span>托管与渠道</span><Icon name="chevron" size={16}/></button></div>
    <GoalCommerceContext key={goal.id} goalId={goal.id} revision={revision} onProject={onCommerceProject} onOrder={onResearchOrder} onBrowse={onChannels}/>
    {approvals.length>0&&<section className="ys21-section ys21-urgent"><div className="ys21-section-title"><Icon name="shield" size={19}/> 待确认</div>{approvals.map(({run,proposal})=><button type="button" key={proposal.id} className="ys21-approval" onClick={()=>onApproval(run,proposal)}><strong>{proposal.action}</strong><small>{proposal.resource}</small><Icon name="arrow-right" size={18}/></button>)}</section>}
    <section className="ys21-section" id="ys21-conversation"><div className="ys21-section-title"><Icon name="chat" size={19}/> 会话与交付</div>
      {messages.length===0&&<p className="ys21-hint">目标创建后的说明和真实 AI 回复会显示在这里。</p>}
      {messages.slice(-18).map(m=><article key={m.id} className={`ys21-message ${m.role==='user'?'is-user':'is-assistant'}`}><small>{m.role==='user'?'你':m.role==='assistant'?(pi ? 'Pi 工作结果' : '助手工作结果'):'系统'} · {m.status==='blocked'?'未连接':m.status==='pending'?'处理中':''}</small><div>{m.content || (m.status==='pending'?'等待真实模型结果…':m.status==='blocked'?'模型未连接，未执行':'')}</div>{m.error&&<p className="ys21-error">{m.error.message}</p>}{m.role === 'assistant' && <ConversationFiles message={m} artifacts={artifacts} runs={runs} readOnly={readOnly}/>}</article>)}
      {separateResult&&<article className="ys21-result"><small><Icon name="file" size={15}/> 已保存交付文本</small><div>{goal.output}</div></article>}
      {canFollowup&&<form onSubmit={e=>void submit(e)} className="ys21-followup"><label htmlFor="ys21-followup-input">补充后续任务</label><div><textarea id="ys21-followup-input" value={reply} placeholder="提出后续成果、范围与限制…" rows={2} onChange={e=>setReply(e.target.value)} maxLength={12000}/><button type="submit" disabled={!reply.trim()||sending} aria-label="提交后续任务"><Icon name="arrow" size={18}/></button></div><small>补充会开启同一会话中的新任务运行，沿用已选择输入；不会自动修改原目标。</small></form>}
    </section>
    <section id="ys21-activity" className="ys21-section"><details className="ys21-details" open={goal.status==='running'}><summary><Icon name="activity" size={19}/> 工作记录 <span>{log.length} 条</span><Icon name="chevron" size={16}/></summary><div className="ys21-event-list">{log.length?log.map(a=><div key={a.id}><i/><div><strong>{activityLabel(a.title)}</strong><small>{a.detail||new Date(a.createdAt).toLocaleString('zh-CN')}</small></div></div>):<p>尚无执行记录。</p>}</div></details></section>
    {runCards && <section className="ys21-section" aria-label="目标任务运行">{runCards}</section>}
    <div className="ys21-disclaimer">工具状态、输入版本与成果来自原运行记录。外部动作由确切授权控制，模型文字不会替代执行回执。</div>
  </main>;
}
