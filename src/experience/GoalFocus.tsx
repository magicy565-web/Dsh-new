import { useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from '../icons';
import type { Bootstrap, Goal, Run, Message, ActionProposal, Activity } from '../types';
import { HarnessTag } from './FocusHome';
import './focus-v21.css';

const display = (s: string) => ({ draft: '目标已保存 · 等待启动', running: '执行中', awaiting_approval: '等待你的审批', paused: '已暂停', review_required: '成果待验收', completed: '已验收', failed: '执行失败', blocked: '执行受阻', cancelled: '已取消' } as Record<string,string>)[s] || s;
const activityLabel = (title:string) => ({ 'Goal created':'目标已创建','Goal started':'目标已开始执行','Goal paused':'执行已暂停','Goal completed':'已完成验收','Goal updated':'目标已更新','Text output ready for review':'成果等待验收'} as Record<string,string>)[title] || title;

export function GoalFocus({ goal, runtime, runs, messages, activity, working, readOnly, onBack, onStart, onPause, onReview, onApproval, onReferences, onChannels, onRuntime, onFollowup }: {
  goal: Goal; runtime?: Bootstrap['runtime']; runs: Run[]; messages: Message[]; activity: Activity[];
  working: boolean; readOnly: boolean; onBack: () => void; onStart: () => void; onPause: () => void; onReview: () => void;
  onApproval: (run: Run, proposal: ActionProposal) => void; onReferences: () => void; onChannels: () => void; onRuntime: () => void;
  onFollowup: (content: string) => Promise<boolean>;
}) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const current = runs.at(-1);
  const latestAssistant = [...messages].reverse().find(m=>m.role==='assistant'&&m.status==='complete'&&m.content);
  const separateResult = Boolean(goal.output?.trim() && goal.output.trim() !== latestAssistant?.content?.trim());
  const native = runtime?.kind==='deepseek-harness';
  const ready = native && runtime?.configured===true;
  const approvals = runs.flatMap(r=>(r.proposals || []).filter(p=>p.status==='pending'||p.status==='approved').map(p=>({run:r,proposal:p})));
  const log = activity.filter(a=>a.goalId===goal.id).slice(-8).reverse();
  const canFollowup = Boolean(goal.conversationId) && ready && !['draft','running','awaiting_approval'].includes(goal.status) && !readOnly && !working && !sending;
  const canStart = ['draft','paused','blocked','failed'].includes(goal.status);
  const action = goal.status==='running' ? '查看工作过程' : goal.status==='awaiting_approval' ? '审核操作' : goal.status==='review_required' ? '验收成果' : canStart ? ready?'启动 Harness 执行':'配置原生 Harness' : '继续会话';
  const caption = ['failed','blocked'].includes(goal.status)&&goal.lastError?.message?goal.lastError.message:!native?'当前运行时不是 Harness。请先切换部署配置。':!ready?'原生 Harness 缺少审核后的运行配置，尚不能执行。':goal.status==='draft'?'确认后，任务将交给当前配置的原生 Harness 执行。':goal.status==='running'?'真实进展来自运行事件；没有事件不会伪造进度。': '执行、审批与交付均以服务端记录为准。';
  async function submit(e: FormEvent) {
    e.preventDefault(); if(!canFollowup||!reply.trim())return;
    setSending(true);
    try { if(await onFollowup(reply.trim())) setReply(''); } finally { setSending(false); }
  }
  function mainAction() {
    if(goal.status==='awaiting_approval') { if(approvals[0]) onApproval(approvals[0].run,approvals[0].proposal); return; }
    if(goal.status==='review_required') { onReview(); return; }
    if(goal.status==='running') {document.getElementById('ys21-activity')?.scrollIntoView({behavior:'smooth'});return;}
    if(canStart) { if(ready)onStart(); else onRuntime(); return; }
    document.getElementById('ys21-conversation')?.scrollIntoView({behavior:'smooth'});
  }
  return <main className="ys21-goal" data-testid="v21-goal-session">
    <div className="ys21-detail-top"><button type="button" onClick={onBack} aria-label="返回工作"><Icon name="back" size={22}/></button><span>工作会话</span><HarnessTag runtime={runtime} onDetails={onRuntime}/></div>
    <header className="ys21-goal-header"><h1>{goal.title}</h1><span className="ys21-status"><span aria-hidden="true" className="ys21-state-dot"/>{display(goal.status)}</span></header>
    <section className="ys21-current" aria-label="当前状态"><span className="ys21-eyebrow">下一步</span><h2>{goal.status==='draft'?(ready?'可以开始了':'等待连接 Harness'):goal.status==='running'?'AI 正在工作':goal.status==='review_required'?'等待你的判断':goal.status==='awaiting_approval'?'需要你批准':display(goal.status)}</h2><p>{caption}</p><button type="button" className="ys21-primary" disabled={working||readOnly||(goal.status==='awaiting_approval'&&!approvals.length)} onClick={mainAction}>{working?'正在提交…':action}<Icon name="arrow-right" size={19}/></button>
      {goal.status==='running'&&<button type="button" className="ys21-pause" onClick={onPause} disabled={working||readOnly}><Icon name="pause" size={16}/> 暂停执行</button>}
    </section>
    <div className="ys21-scope"><button type="button" onClick={onReferences} aria-label="查看目标产品和文件版本"><Icon name="library" size={18}/><span>资料</span><Icon name="chevron" size={16}/></button><button type="button" onClick={onChannels} aria-label="查看目标渠道范围"><Icon name="channels" size={18}/><span>托管与渠道</span><Icon name="chevron" size={16}/></button></div>
    {approvals.length>0&&<section className="ys21-section ys21-urgent"><div className="ys21-section-title"><Icon name="shield" size={19}/> 待确认</div>{approvals.map(({run,proposal})=><button type="button" key={proposal.id} className="ys21-approval" onClick={()=>onApproval(run,proposal)}><strong>{proposal.action}</strong><small>{proposal.resource}</small><Icon name="arrow-right" size={18}/></button>)}</section>}
    <section className="ys21-section" id="ys21-conversation"><div className="ys21-section-title"><Icon name="chat" size={19}/> 会话与交付</div>
      {messages.length===0&&<p className="ys21-hint">目标创建后的说明和真实 AI 回复会显示在这里。</p>}
      {messages.slice(-18).map(m=><article key={m.id} className={`ys21-message ${m.role==='user'?'is-user':'is-assistant'}`}><small>{m.role==='user'?'你':m.role==='assistant'?'远山 AI':'系统'} · {m.status==='blocked'?'未连接':m.status==='pending'?'处理中':''}</small><div>{m.content || (m.status==='pending'?'等待真实模型结果…':m.status==='blocked'?'模型未连接，未执行':'')}</div>{m.error&&<p className="ys21-error">{m.error.message}</p>}</article>)}
      {separateResult&&<article className="ys21-result"><small><Icon name="file" size={15}/> 已保存交付文本</small><div>{goal.output}</div></article>}
      {canFollowup&&<form onSubmit={e=>void submit(e)} className="ys21-followup"><label htmlFor="ys21-followup-input">继续同一会话</label><div><textarea id="ys21-followup-input" value={reply} placeholder="继续追问或修改方向…" rows={2} onChange={e=>setReply(e.target.value)} maxLength={12000}/><button type="submit" disabled={!reply.trim()||sending} aria-label="发送后续消息"><Icon name="arrow" size={18}/></button></div><small>追问会开启一次新的会话运行，不会自动修改原 GOAL。</small></form>}
    </section>
    <section id="ys21-activity" className="ys21-section"><details className="ys21-details" open={goal.status==='running'}><summary><Icon name="activity" size={19}/> 工作记录 <span>{log.length} 条</span><Icon name="chevron" size={16}/></summary><div className="ys21-event-list">{log.length?log.map(a=><div key={a.id}><i/><div><strong>{activityLabel(a.title)}</strong><small>{a.detail||new Date(a.createdAt).toLocaleString('zh-CN')}</small></div></div>):<p>尚无执行记录。</p>}</div></details></section>
    {current?.plan?.length ? <section className="ys21-section"><details className="ys21-details"><summary><Icon name="list" size={19}/> 计划 <span>{current.plan.length} 步</span><Icon name="chevron" size={16}/></summary><ol className="ys21-plan">{current.plan.map(p=><li key={p.id}>{p.title}<small>{p.status}</small></li>)}</ol></details></section> : null}
    <div className="ys21-disclaimer">原生工具、MCP 和 Sub-Agent 权限由审核后的 Harness Profile 控制。</div>
  </main>;
}
