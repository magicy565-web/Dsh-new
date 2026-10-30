import React from 'react';
import {BriefcaseBusiness,Bot,ChevronRight,Lock} from 'lucide-react';
import grokIcon from '../grok.svg';
import museIcon from '../muse.svg';
import {NEVER_DOES,SAMPLE_FLOOR,dotFor,formatTime,groupTasks,initialOf,partyOf,presence,runtimeOf,skillLabel,taskStatus,verificationLabel,workerNo,workerStats,lastActivity} from './model.mjs';

const OFFICIAL_ICONS={grokbot:grokIcon,muse:museIcon};

/** Official marks only: never recoloured, never placed on a custom tile. Unmarked providers get a neutral glyph. */
export function RuntimeIcon({id,size=28}){
  const style={width:size,height:size,borderRadius:Math.round(size*.24)};
  const src=OFFICIAL_ICONS[id];
  return src?<img className="aw-rt" src={src} alt="" style={style}/>:<span className="aw-rt aw-rt-other" style={style}><Bot size={Math.round(size*.55)} strokeWidth={1.75}/></span>;
}

export function Dot({tone}){return <span className="aw-dot" data-tone={tone} aria-hidden="true"/>;}

export function MaintainerChip({party,note}){
  const name=party?.displayName||'维护者未登记';
  return <span className="aw-maintainer"><span className="aw-avatar" aria-hidden="true">{initialOf(party?.displayName)}</span><span className="aw-maintainer-text"><strong>{name}</strong><small>{note||(party?verificationLabel(party):'—')}</small></span></span>;
}

export function RuntimeSeat({runtime,agents,orders,onOpen}){
  const state=presence(agents,orders),seen=lastActivity(agents);
  return <button type="button" className={`aw-seat aw-runtime-${runtime.id}`} onClick={onOpen}>
    <RuntimeIcon id={runtime.id} size={44}/>
    <span className="aw-seat-main"><strong>{runtime.name}</strong><small><Dot tone={state.dot}/>{state.label}{seen&&<span className="aw-mono"> · 最近活动 {formatTime(seen)}</span>}</small></span>
    <ChevronRight className="aw-chevron" size={18} aria-hidden="true"/>
  </button>;
}

export function TaskRow({order,agent,onOpen,index=0}){
  return <button type="button" className="aw-task" style={{'--i':index}} onClick={onOpen}>
    <Dot tone={dotFor(order)}/>
    <span className="aw-task-main"><strong>{order.title}</strong><small>{agent?.displayName||'个人 Worker'}{order.updatedAt&&<span className="aw-mono"> · {formatTime(order.updatedAt)}</span>}</small>{order.workerProgress&&<span className="aw-task-progress">{order.workerProgress}</span>}</span>
    <span className="aw-task-status">{taskStatus(order)}</span>
    <ChevronRight className="aw-chevron" size={16} aria-hidden="true"/>
  </button>;
}

export function TaskList({orders,agents,onOpen}){
  return <div className="aw-list">{orders.map((o,i)=><TaskRow key={o.id} order={o} index={i} agent={agents.find(a=>a.id===o.agentServiceId)} onOpen={()=>onOpen(o)}/>)}</div>;
}

export function TaskGroups({orders,agents,onOpen}){
  return <>{groupTasks(orders).map(([title,rows])=><section className="aw-group" key={title}><h3 className="aw-label">{title}<span className="aw-mono">{rows.length}</span></h3><TaskList orders={rows} agents={agents} onOpen={onOpen}/></section>)}</>;
}

export function EmptyState({title,hint}){
  return <div className="aw-empty" role="status"><strong>{title}</strong>{hint&&<small>{hint}</small>}</div>;
}

/** List form of the badge: a lanyard-coloured spine, the Worker, its maintainer and where it runs. */
export function BadgeRow({worker,orders,parties,onOpen,index=0}){
  const stats=workerStats(worker,orders),runtime=runtimeOf(worker.providerType),party=partyOf(parties,worker.providerPartyId);
  return <button type="button" className="aw-badge-row" style={{'--i':index}} onClick={onOpen}>
    <span className="aw-glyph" aria-hidden="true"><BriefcaseBusiness size={20} strokeWidth={1.75}/></span>
    <span className="aw-badge-row-main">
      <strong>{worker.displayName}</strong>
      {worker.skillLabel&&<small className="aw-clamp">{worker.skillLabel}</small>}
      <small className="aw-by">维护者 {party?.displayName||'未登记'} · <span className="aw-mono">已验收 {stats.accepted}</span>{worker.workerTemplate&&<span className="aw-mono"> · {worker.workerTemplate.version==null?'试运行':`v${worker.workerTemplate.version}`}</span>}</small>
    </span>
    <RuntimeIcon id={runtime.id} size={24}/>
    <ChevronRight className="aw-chevron" size={16} aria-hidden="true"/>
  </button>;
}

/** The product's signature element: a vertical ID badge with a lanyard band. */
export function WorkerBadge({worker,orders,parties}){
  const stats=workerStats(worker,orders),runtime=runtimeOf(worker.providerType),party=partyOf(parties,worker.providerPartyId),seen=worker.lastSeenAt;
  return <article className="aw-badge" aria-label={`${worker.displayName} 工牌`}>
    <span className="aw-hole" aria-hidden="true"/>
    <div className="aw-band"><span className="aw-mono">AI WORKER</span><span className="aw-mono">No.{workerNo(worker.id)}</span></div>
    <span className="aw-badge-glyph" aria-hidden="true"><BriefcaseBusiness size={26} strokeWidth={1.6}/></span>
    <div className="aw-badge-body"><h2>{worker.displayName}</h2>{worker.skillLabel&&<p>{worker.skillLabel}</p>}</div>
    <div className="aw-sign">
      <div><span className="aw-label">维护者</span><MaintainerChip party={party}/></div>
      <div><span className="aw-label">运行于</span><span className="aw-runs"><RuntimeIcon id={runtime.id} size={28}/><strong>{runtime.name}</strong></span></div>
    </div>
    <dl className="aw-stats"><div><dt>已验收</dt><dd>{stats.accepted}</dd></div><div><dt>已退回</dt><dd>{stats.rejected}</dd></div><div><dt>进行中</dt><dd>{stats.active}</dd></div></dl>
    <p className="aw-badge-foot aw-mono">{seen?`最近活动 ${formatTime(seen)}`:'暂无活动记录'}</p>
  </article>;
}

export function EvidenceNote({stats}){
  return <p className="aw-evidence">{stats.rate===null?<>样本不足：已验收与已退回合计 <span className="aw-mono">{stats.sample}</span> 条，不足 <span className="aw-mono">{SAMPLE_FLOOR}</span> 条时不显示验收率。</>:<>验收率 <span className="aw-mono">{stats.rate}%</span>，基于 <span className="aw-mono">{stats.sample}</span> 条已验收或已退回的任务。</>}<small>来自 DSH 记录，不含维护者自述。</small></p>;
}

export function ScopeList({skills}){
  return <ul className="aw-scope">{(skills||[]).map(s=><li key={s}>{skillLabel(s)}</li>)}</ul>;
}

export function NeverList(){
  return <ul className="aw-never">{NEVER_DOES.map(item=><li key={item}><Lock size={14} aria-hidden="true"/>{item}</li>)}</ul>;
}
