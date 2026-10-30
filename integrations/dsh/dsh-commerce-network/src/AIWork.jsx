import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowRight,ArrowUpRight,ChevronDown,ChevronRight,Layers3,LoaderCircle,Network,RefreshCw,Sparkles,TriangleAlert} from 'lucide-react';
import styles from './ai-work.css';
import grokIcon from './grok.svg';
import museIcon from './muse.svg';
import {callApi,errorText,stateFrom} from './api.mjs';

const PROVIDERS=[
  {id:'grokbot',name:'Grok Bot',icon:grokIcon},
  {id:'muse',name:'Muse Agent',icon:museIcon},
];
const STATUS={proposed:'待你审批',authorized:'已授权',queued:'等待领取',claimed:'已领取',running:'执行中',delivered:'等待验收',accepted:'已完成',rejected:'已退回',cancelled:'已取消',stop_requested:'停止待确认',failed:'需要处理'};
const ACTIVE=new Set(['proposed','claimed','running','delivered','stop_requested']);
const QUEUED=new Set(['authorized','queued']);
const TERMINAL=new Set(['accepted','rejected','cancelled','failed']);
const taskStatus=o=>o.grokHandoff?.state==='unknown'?'派送结果待核对':o.grokHandoff?.state==='preparing'?'准备派送':o.grokHandoff?.state==='not_claimed'?'未领取，待核对':o.grokHandoff?.state==='not_sent_stop_requested'?'停止待确认':STATUS[o.status]||o.status;
const time=value=>{if(!value)return '';const date=new Date(value);return Number.isNaN(date.valueOf())?'':new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);};
function lampForTask(o){
  if(o.grokHandoff?.state==='unknown'||o.status==='failed')return 'failed';
  if(['proposed','delivered','stop_requested'].includes(o.status))return 'waiting';
  if(o.status==='running')return 'working';
  if(o.status==='claimed')return 'accepted';
  if(['authorized','queued'].includes(o.status))return 'queued';
  if(o.status==='accepted')return 'done';
  return 'idle';
}
function presence(agents,orders){
  const current=orders.find(o=>['delivered','proposed','stop_requested'].includes(o.status))||orders.find(o=>o.status==='running')||orders.find(o=>o.status==='claimed')||orders.find(o=>['queued','authorized'].includes(o.status));
  if(current)return {state:lampForTask(current),label:taskStatus(current)};
  if(agents.some(a=>a.status==='connected'))return {state:'idle',label:'网关已认证'};
  if(agents.some(a=>a.status==='revoked'))return {state:'failed',label:'已撤销'};
  if(agents.length)return {state:'unconfigured',label:'记录待确认'};
  return {state:'unknown',label:'状态待同步'};
}
function StatusMark({state='unknown',large=false}){
  return <span className={`aw-mark${large?' aw-mark-large':''}`} data-state={state} aria-hidden="true"><span className="aw-ring aw-ring-outer"/><span className="aw-ring aw-ring-inner"/><span className="aw-core"/><span className="aw-scan"/><span className="aw-tick"/><span className="aw-tick aw-tick-b"/></span>;
}
function ProviderSeat({provider,agents,orders,selected,onSelect}){
  const current=presence(agents,orders);
  return <button type="button" className={`aw-provider aw-${provider.id}${selected?' aw-provider-selected':''}`} onClick={onSelect} aria-pressed={selected}>
    <img className="aw-provider-logo" src={provider.icon} alt=""/><span className="aw-provider-main"><strong>{provider.name}</strong></span><span className="aw-provider-right"><span className="aw-badge"><StatusMark state={current.state}/>{current.label}</span></span><ChevronRight className="aw-chevron" size={16}/>
  </button>;
}
function TaskRow({order,agent,current,onOpen}){
  return <button type="button" className={`aw-task${current?' aw-task-current':''}`} onClick={onOpen}><StatusMark state={lampForTask(order)}/><span className="aw-task-main"><span className="aw-task-heading"><span>{taskStatus(order)}</span><strong>{order.title}</strong></span><small>{agent?.displayName||'个人 Worker'}{order.updatedAt?` · ${time(order.updatedAt)}`:''}</small>{order.workerProgress&&<span className="aw-task-progress">{order.workerProgress}</span>}</span><ArrowUpRight size={15}/></button>;
}
function TaskGroup({title,rows,agents,onOpen}){
  if(!rows.length)return null;
  return <div className="aw-task-group"><h3>{title}<span>{rows.length}</span></h3><div className="aw-tasks">{rows.map((o,i)=><TaskRow key={o.id} order={o} agent={agents.find(a=>a.id===o.agentServiceId)} current={title==='当前任务'&&i===0} onOpen={onOpen}/>)}</div></div>;
}

export function AIWork({sessionId,active,tabSignal,watchChanges,bindRefresh,openCanvas}){
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState('grokbot');
  const project=useRef(null),sequence=useRef(0),fetching=useRef(null),mounted=useRef(false);
  const load=useCallback(async({quiet=false,projectId=project.current}={})=>{
    const serial=++sequence.current;fetching.current?.abort();const controller=new AbortController();fetching.current=controller;
    if(!quiet)setRefreshing(true);
    try{
      const query=new URLSearchParams({sessionId,...projectId?{projectId}:{}});
      const next=stateFrom(await callApi(`/workspace?${query}`,{signal:controller.signal}));
      if(!Array.isArray(next?.projects)||!Number.isSafeInteger(next.revision)||!next.workspaceId)throw new Error('工作区数据不完整，请重新读取。');
      if(!mounted.current||serial!==sequence.current)return;
      project.current=next.projectId||null;setData(next);setError('');
    }catch(e){if(mounted.current&&serial===sequence.current&&e.name!=='AbortError')setError(errorText(e));}
    finally{if(mounted.current&&serial===sequence.current){setLoading(false);setRefreshing(false);}}
  },[sessionId]);
  useEffect(()=>{
    mounted.current=true;project.current=null;setData(null);setLoading(true);setError('');setSelected('grokbot');
    const controller=new AbortController();
    const stop=()=>{controller.abort();fetching.current?.abort();};tabSignal?.addEventListener('abort',stop,{once:true});void load();
    return()=>{mounted.current=false;stop();tabSignal?.removeEventListener('abort',stop);};
  },[sessionId,tabSignal,load]);
  useEffect(()=>{if(!active)return;const id=setInterval(()=>{if(document.visibilityState==='visible')void load({quiet:true});},6000);return()=>clearInterval(id);},[active,load]);
  useEffect(()=>watchChanges?.(()=>{if(active)void load({quiet:true});}),[active,load,watchChanges]);
  useEffect(()=>bindRefresh?.(()=>void load()),[bindRefresh,load]);
  const agents=data?.commerceNetwork?.agentServices||[],orders=data?.commerceNetwork?.workOrders||[];
  const provider=PROVIDERS.find(p=>p.id===selected),providerAgents=agents.filter(a=>a.providerType===selected);
  const providerOrders=useMemo(()=>[...orders].filter(o=>providerAgents.some(a=>a.id===o.agentServiceId)).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))),[orders,selected,agents]);
  const current=providerOrders.filter(o=>ACTIVE.has(o.status)),queued=providerOrders.filter(o=>QUEUED.has(o.status)),recent=providerOrders.filter(o=>TERMINAL.has(o.status)).slice(0,6);
  const selectProject=e=>{const id=e.target.value||null;project.current=id;setData(null);setLoading(true);void load({projectId:id});};
  return <section className="cn aw-root" aria-label="AI Work 智能工作台"><style>{styles}</style>
    <header className="aw-header"><div className="aw-brand"><span className="aw-brand-icon"><Sparkles size={17}/></span><h1>AI Work</h1></div><div className="aw-header-actions"><button type="button" className="aw-icon" aria-label="刷新 AI Work" title="刷新" disabled={refreshing} onClick={()=>void load()}><RefreshCw size={16} className={refreshing?'aw-spin':''}/></button><button type="button" className="aw-icon" aria-label="打开商业协作画布" title="打开商业协作画布" onClick={openCanvas}><Network size={17}/></button></div></header>
    <div className="aw-scroll"><div className="aw-inner">
      <div className="aw-context"><div><span className="aw-overline">当前项目</span>{data?.projects?.length?<label className="aw-project"><span className="aw-sr">选择项目</span><select value={data.projectId||''} onChange={selectProject}>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name||p.title}</option>)}</select><ChevronDown size={14}/></label>:<strong>{loading?'正在读取…':'当前会话暂无项目'}</strong>}</div><div className="aw-context-side"><span>待你处理</span><strong>{loading?'—':orders.filter(o=>['proposed','delivered'].includes(o.status)).length}</strong></div></div>
      {error&&<div className="aw-feedback aw-error" role="alert"><TriangleAlert size={16}/><span>{error}</span><button type="button" onClick={()=>void load()}>重试</button></div>}
      {loading&&!data?<div className="aw-loading"><LoaderCircle className="aw-spin" size={21}/><span>正在读取工作区…</span></div>:!data?<div className="aw-unavailable"><p>暂时无法读取 AI Work。</p><button type="button" onClick={()=>void load()}>重新读取</button></div>:<>
      <div className="aw-section-heading"><h2>我的助手</h2></div>
      <div className="aw-providers">{PROVIDERS.map(p=>{const pa=agents.filter(a=>a.providerType===p.id);return <ProviderSeat key={p.id} provider={p} agents={pa} orders={orders.filter(o=>pa.some(a=>a.id===o.agentServiceId))} selected={selected===p.id} onSelect={()=>setSelected(p.id)}/>;})}</div>
      {agents.some(a=>!['grokbot','muse'].includes(a.providerType))&&<div className="aw-other"><Layers3 size={15}/><span>另有 {agents.filter(a=>!['grokbot','muse'].includes(a.providerType)).length} 个其他已登记 Worker</span><button type="button" onClick={openCanvas}>查看 <ArrowRight size={14}/></button></div>}
      <div className="aw-detail">
        <div className="aw-detail-heading"><div className="aw-detail-identity"><img className="aw-provider-logo" src={provider.icon} alt=""/><h2>{provider.name}</h2></div></div>
        <div className="aw-detail-divider"/>
        {providerOrders.length?<><TaskGroup title="当前任务" rows={current} agents={providerAgents} onOpen={openCanvas}/><TaskGroup title="排队中" rows={queued} agents={providerAgents} onOpen={openCanvas}/><TaskGroup title="最近" rows={recent} agents={providerAgents} onOpen={openCanvas}/></>:<div className="aw-empty"><span className="aw-empty-symbol"><StatusMark state="idle" large/></span><strong>暂无任务</strong></div>}
      </div>
      </>}
    </div></div>
  </section>;
}
