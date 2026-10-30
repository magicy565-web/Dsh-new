import React from 'react';
import {BadgeRow,Dot,EmptyState,EvidenceNote,NeverList,RuntimeIcon,RuntimeSeat,ScopeList,TaskGroups,TaskList,WorkerBadge,MaintainerChip} from './parts.jsx';
import {QUEUED,RUNTIMES,dotFor,formatTime,needsYou,partyOf,presence,runtimeOf,taskStatus,workerStats} from './model.mjs';

const forRuntime=(v,id)=>{const agents=v.agents.filter(a=>runtimeOf(a.providerType).id===id);return {agents,orders:v.orders.filter(o=>agents.some(a=>a.id===o.agentServiceId))};};

function AgentSeats({v}){
  return <div className="aw-list">{RUNTIMES.map(r=>{const {agents,orders}=forRuntime(v,r.id);return <RuntimeSeat key={r.id} runtime={r} agents={agents} orders={orders} onOpen={()=>v.go('runtime',r.id)}/>;})}</div>;
}

export function TodayScreen({v}){
  const attention=v.orders.filter(needsYou);
  const running=v.orders.filter(o=>!needsYou(o)&&(['claimed','running'].includes(o.status)||QUEUED.has(o.status)));
  const open=o=>v.go('task',o.id);
  return <>
    <div className="aw-pagehead"><h2>今天</h2></div>
    {v.bar}
    {v.orders.length===0&&<EmptyState title="暂无任务" hint="任务在协作画布中创建并审批后，会出现在这里。"/>}
    {attention.length>0&&<section className="aw-section"><div className="aw-section-head"><h3>需要你确认</h3><span className="aw-count aw-count-hot aw-mono">{attention.length}</span></div><TaskList orders={attention} agents={v.agents} onOpen={open}/></section>}
    {v.orders.length>0&&attention.length===0&&<p className="aw-calm">没有需要你确认的事项。</p>}
    {running.length>0&&<section className="aw-section"><div className="aw-section-head"><h3>进行中</h3><span className="aw-count aw-mono">{running.length}</span></div><TaskList orders={running} agents={v.agents} onOpen={open}/></section>}
    <section className="aw-section"><div className="aw-section-head"><h3>我的 Agent</h3></div><AgentSeats v={v}/></section>
  </>;
}

export function TasksScreen({v}){
  return <>
    <div className="aw-pagehead"><h2>任务</h2></div>
    {v.bar}
    {v.orders.length?<TaskGroups orders={v.orders} agents={v.agents} onOpen={o=>v.go('task',o.id)}/>:<EmptyState title="暂无任务" hint="任务在协作画布中创建并审批后，会出现在这里。"/>}
  </>;
}

export function WorkersScreen({v}){
  return <>
    <div className="aw-pagehead"><h2>Worker</h2></div>
    {v.bar}
    <section className="aw-section"><div className="aw-section-head"><h3>已登记的 Worker</h3>{v.agents.length>0&&<span className="aw-count aw-mono">{v.agents.length}</span>}</div>
      {v.agents.length?<div className="aw-list">{v.agents.map((a,i)=><BadgeRow key={a.id} index={i} worker={a} orders={v.orders} parties={v.parties} onOpen={()=>v.go('worker',a.id)}/>)}</div>:<EmptyState title="当前项目暂无 Worker" hint="在协作画布中登记 Worker，并由你签发专用凭证。"/>}
    </section>
    <section className="aw-section"><div className="aw-section-head"><h3>我的 Agent</h3></div><AgentSeats v={v}/></section>
  </>;
}

export function WorkerScreen({v,id}){
  const worker=v.agents.find(a=>a.id===id);
  if(!worker)return <EmptyState title="Worker 已更新" hint="这个 Worker 已不在当前项目中。"/>;
  const stats=workerStats(worker,v.orders),mine=v.orders.filter(o=>o.agentServiceId===worker.id);
  return <>
    <WorkerBadge worker={worker} orders={v.orders} parties={v.parties}/>
    <section className="aw-section"><div className="aw-section-head"><h3>真实记录</h3></div><EvidenceNote stats={stats}/></section>
    <section className="aw-section"><div className="aw-section-head"><h3>授予能力</h3></div>{worker.skills?.length?<ScopeList skills={worker.skills}/>:<p className="aw-calm">登记时未声明能力。</p>}</section>
    <section className="aw-section"><div className="aw-section-head"><h3>不会做</h3></div><NeverList/></section>
    <section className="aw-section"><div className="aw-section-head"><h3>任务</h3>{mine.length>0&&<span className="aw-count aw-mono">{mine.length}</span>}</div>{mine.length?<TaskList orders={mine} agents={v.agents} onOpen={o=>v.go('task',o.id)}/>:<EmptyState title="暂无任务"/>}</section>
  </>;
}

export function RuntimeScreen({v,id}){
  const runtime=RUNTIMES.find(r=>r.id===id);
  if(!runtime)return <EmptyState title="Agent 已更新"/>;
  const {agents,orders}=forRuntime(v,id),state=presence(agents,orders);
  return <>
    <div className="aw-profile"><RuntimeIcon id={runtime.id} size={64}/><h2>{runtime.name}</h2><span className="aw-profile-status"><Dot tone={state.dot}/>{state.label}</span><p className="aw-footnote">“网关已认证”只表示 Worker 凭证访问过 DSH，不代表远端在线或能力合格。</p></div>
    <section className="aw-section"><div className="aw-section-head"><h3>Worker</h3>{agents.length>0&&<span className="aw-count aw-mono">{agents.length}</span>}</div>
      {agents.length?<div className="aw-list">{agents.map((a,i)=><BadgeRow key={a.id} index={i} worker={a} orders={v.orders} parties={v.parties} onOpen={()=>v.go('worker',a.id)}/>)}</div>:<EmptyState title="暂无 Worker" hint={`当前项目没有登记到 ${runtime.name} 的 Worker。`}/>}
    </section>
    <section className="aw-section"><div className="aw-section-head"><h3>任务</h3></div>{orders.length?<TaskGroups orders={orders} agents={agents} onOpen={o=>v.go('task',o.id)}/>:<EmptyState title="暂无任务"/>}</section>
  </>;
}

export function TaskScreen({v,id}){
  const task=v.orders.find(o=>o.id===id);
  if(!task)return <EmptyState title="任务已更新" hint="这个任务已不在当前项目中。"/>;
  const worker=v.agents.find(a=>a.id===task.agentServiceId),party=partyOf(v.parties,task.providerPartyId||worker?.providerPartyId);
  return <div className="aw-task-detail">
    <span className="aw-detail-status"><Dot tone={dotFor(task)}/>{taskStatus(task)}</span>
    <h2>{task.title}</h2>
    <div className="aw-detail-meta">{worker?.displayName||'个人 Worker'}{task.updatedAt&&<span className="aw-mono"> · {formatTime(task.updatedAt)}</span>}</div>
    {worker&&<button type="button" className="aw-worker-link" onClick={()=>v.go('worker',worker.id)}><RuntimeIcon id={runtimeOf(worker.providerType).id} size={28}/><span><strong>{worker.displayName}</strong><small>运行于 {runtimeOf(worker.providerType).name}</small></span><MaintainerChip party={party}/></button>}
    {task.brief&&<section className="aw-section"><div className="aw-section-head"><h3>任务说明</h3></div><p className="aw-prose">{task.brief}</p></section>}
    {task.workerProgress&&<section className="aw-section"><div className="aw-section-head"><h3>最新进度</h3></div><p className="aw-prose">{task.workerProgress}</p></section>}
    <p className="aw-footnote">Worker 只能读取审批时授权的资料。</p>
  </div>;
}
