import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,BriefcaseBusiness,ChevronDown,ChevronRight,Layers3,LayoutGrid,LoaderCircle,RefreshCw,Sparkles,TriangleAlert,UsersRound} from 'lucide-react';
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
const taskStatus=o=>o.grokHandoff?.state==='unknown'?'派送结果待核对':o.grokHandoff?.state==='preparing'?'准备派送':o.grokHandoff?.state==='not_claimed'?'未领取，待核对':o.grokHandoff?.state==='not_sent_stop_requested'?'停止待确认':STATUS[o.status]||o.status;
const formatTime=value=>{if(!value)return '';const date=new Date(value);return Number.isNaN(date.valueOf())?'':new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);};
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
function StatusMark({state='unknown'}){
  return <span className="aw-mark" data-state={state} aria-hidden="true"><span className="aw-ring aw-ring-outer"/><span className="aw-ring aw-ring-inner"/><span className="aw-core"/><span className="aw-scan"/><span className="aw-tick"/><span className="aw-tick aw-tick-b"/></span>;
}
function ProviderSeat({provider,agents,orders,onSelect}){
  const current=presence(agents,orders);
  return <button type="button" className={`aw-provider aw-${provider.id}`} onClick={onSelect}>
    <img className="aw-provider-logo" src={provider.icon} alt=""/><span className="aw-provider-main"><strong>{provider.name}</strong><small><StatusMark state={current.state}/>{current.label}</small></span><ChevronRight className="aw-chevron" size={18}/>
  </button>;
}
function TaskRow({order,agent,onOpen}){
  return <button type="button" className="aw-task" onClick={onOpen}><span className="aw-task-icon"><BriefcaseBusiness size={17}/></span><span className="aw-task-main"><strong>{order.title}</strong><small>{agent?.displayName||'个人 Worker'}{order.updatedAt?` · ${formatTime(order.updatedAt)}`:''}</small>{order.workerProgress&&<span className="aw-task-progress">{order.workerProgress}</span>}</span><span className="aw-task-status">{taskStatus(order)}</span><ChevronRight className="aw-chevron" size={16}/></button>;
}
function TaskGroups({orders,agents,onOpen}){
  const groups=[['当前任务',orders.filter(o=>ACTIVE.has(o.status))],['排队中',orders.filter(o=>QUEUED.has(o.status))],['最近',orders.filter(o=>!ACTIVE.has(o.status)&&!QUEUED.has(o.status)).slice(0,12)]];
  return <>{groups.map(([title,rows])=>rows.length>0&&<section className="aw-task-group" key={title}><h3>{title}<span>{rows.length}</span></h3><div className="aw-tasks">{rows.map(o=><TaskRow key={o.id} order={o} agent={agents.find(a=>a.id===o.agentServiceId)} onOpen={()=>onOpen(o)}/>)}</div></section>)}</>;
}
function EmptyTasks(){return <div className="aw-empty"><span><BriefcaseBusiness size={21}/></span><strong>暂无任务</strong></div>;}

/** Mobile app embedded in the native right sidebar; it owns no Agent runtime. */
export function AIWork({sessionId,active,tabSignal,watchChanges,bindRefresh,openCanvas}){
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[error,setError]=useState('');
  const [screen,setScreen]=useState('work'),[selected,setSelected]=useState('grokbot'),[selectedOrder,setSelectedOrder]=useState(null),[taskBack,setTaskBack]=useState('work'),[providerBack,setProviderBack]=useState('work');
  const project=useRef(null),sequence=useRef(0),fetching=useRef(null),mounted=useRef(false),scroll=useRef(null);
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
    mounted.current=true;project.current=null;setData(null);setLoading(true);setError('');setSelected('grokbot');setScreen('work');setSelectedOrder(null);
    const stop=()=>fetching.current?.abort();tabSignal?.addEventListener('abort',stop,{once:true});void load();
    return()=>{mounted.current=false;stop();tabSignal?.removeEventListener('abort',stop);};
  },[sessionId,tabSignal,load]);
  useEffect(()=>{if(!active)return;const id=setInterval(()=>{if(document.visibilityState==='visible')void load({quiet:true});},6000);return()=>clearInterval(id);},[active,load]);
  useEffect(()=>watchChanges?.(()=>{if(active)void load({quiet:true});}),[active,load,watchChanges]);
  useEffect(()=>bindRefresh?.(()=>void load()),[bindRefresh,load]);
  useEffect(()=>{if(scroll.current)scroll.current.scrollTop=0;},[screen,selected,selectedOrder]);
  const agents=data?.commerceNetwork?.agentServices||[],orders=data?.commerceNetwork?.workOrders||[];
  const sorted=useMemo(()=>[...orders].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))),[orders]);
  const provider=PROVIDERS.find(p=>p.id===selected),providerAgents=agents.filter(a=>a.providerType===selected);
  const providerOrders=sorted.filter(o=>providerAgents.some(a=>a.id===o.agentServiceId));
  const task=sorted.find(o=>o.id===selectedOrder),taskAgent=task&&agents.find(a=>a.id===task.agentServiceId);
  const pending=orders.filter(o=>['proposed','delivered'].includes(o.status)).length;
  const showProvider=(id,from)=>{setSelected(id);setProviderBack(from);setScreen('provider');};
  const showTask=(o,from)=>{setSelectedOrder(o.id);setTaskBack(from);setScreen('task');};
  const navigate=destination=>{setScreen(destination);setSelectedOrder(null);};
  const selectProject=e=>{const id=e.target.value||null;project.current=id;setData(null);setLoading(true);setSelectedOrder(null);setScreen('work');void load({projectId:id});};
  const back=()=>{if(screen==='task'){setScreen(taskBack);setSelectedOrder(null);}else setScreen(providerBack);};
  const heading=screen==='provider'?provider.name:screen==='task'?'任务详情':screen==='assistants'?'助手':'工作';
  const nav=screen==='provider'||(screen==='task'&&taskBack==='provider')?'assistants':screen==='task'?taskBack:screen;
  return <section className="cn aw-root" aria-label="AI Work 嵌入式应用"><style>{styles}</style>
    <div className="aw-app">
      <header className="aw-header"><div className="aw-heading">{['provider','task'].includes(screen)?<button type="button" className="aw-icon" onClick={back} aria-label="返回"><ArrowLeft size={19}/></button>:<span className="aw-brand-icon"><Sparkles size={17}/></span>}<h1>{screen==='work'?'AI Work':heading}</h1></div><button type="button" className="aw-icon" aria-label="刷新 AI Work" title="刷新" disabled={refreshing} onClick={()=>void load()}><RefreshCw size={17} className={refreshing?'aw-spin':''}/></button></header>
      <main className="aw-scroll" ref={scroll}><div className="aw-inner">
        {error&&<div className="aw-feedback aw-error" role="alert"><TriangleAlert size={16}/><span>{error}</span><button type="button" onClick={()=>void load()}>重试</button></div>}
        {loading&&!data?<div className="aw-loading"><LoaderCircle className="aw-spin" size={21}/><span>正在读取…</span></div>:!data?<div className="aw-unavailable"><p>暂时无法读取工作区</p><button type="button" onClick={()=>void load()}>重新读取</button></div>:<>
          {screen==='work'&&<>
            <div className="aw-page-title"><h2>工作</h2><span className="aw-page-symbol"><LayoutGrid size={19}/></span></div>
            <div className="aw-context"><div><span className="aw-context-label">当前项目</span>{data.projects.length?<label className="aw-project"><span className="aw-sr">选择项目</span><select value={data.projectId||''} onChange={selectProject}>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name||p.title}</option>)}</select><ChevronDown size={15}/></label>:<strong>当前会话暂无项目</strong>}</div><span className="aw-context-count">{pending}<small> 待处理</small></span></div>
            <section className="aw-section"><div className="aw-section-heading"><h2>我的助手</h2><button type="button" className="aw-text-button" onClick={()=>navigate('assistants')}>查看全部 <ChevronRight size={15}/></button></div><div className="aw-providers">{PROVIDERS.map(p=>{const pa=agents.filter(a=>a.providerType===p.id);return <ProviderSeat key={p.id} provider={p} agents={pa} orders={sorted.filter(o=>pa.some(a=>a.id===o.agentServiceId))} onSelect={()=>showProvider(p.id,'work')}/>;})}</div></section>
            <section className="aw-section"><div className="aw-section-heading"><h2>任务</h2><button type="button" className="aw-text-button" onClick={openCanvas}>协作画布 <ArrowUpRight size={14}/></button></div>{sorted.length?<TaskGroups orders={sorted} agents={agents} onOpen={o=>showTask(o,'work')}/>:<EmptyTasks/>}</section>
          </>}
          {screen==='assistants'&&<><div className="aw-page-title"><div><h2>我的助手</h2></div><span className="aw-page-symbol"><UsersRound size={19}/></span></div><div className="aw-providers">{PROVIDERS.map(p=>{const pa=agents.filter(a=>a.providerType===p.id);return <ProviderSeat key={p.id} provider={p} agents={pa} orders={sorted.filter(o=>pa.some(a=>a.id===o.agentServiceId))} onSelect={()=>showProvider(p.id,'assistants')}/>;})}</div>{agents.some(a=>!['grokbot','muse'].includes(a.providerType))&&<button type="button" className="aw-other" onClick={openCanvas}><Layers3 size={16}/><span>其他 Worker</span><ChevronRight size={16}/></button>}</>}
          {screen==='provider'&&<><div className="aw-profile"><img className="aw-profile-logo" src={provider.icon} alt=""/><h2>{provider.name}</h2><span className="aw-profile-status"><StatusMark state={presence(providerAgents,providerOrders).state}/>{presence(providerAgents,providerOrders).label}</span></div><div className="aw-section-heading aw-provider-heading"><h2>任务</h2><button type="button" className="aw-text-button" onClick={openCanvas}>协作画布 <ArrowUpRight size={14}/></button></div>{providerOrders.length?<TaskGroups orders={providerOrders} agents={providerAgents} onOpen={o=>showTask(o,'provider')}/>:<EmptyTasks/>}</>}
          {screen==='task'&&(task?<div className="aw-task-detail"><span className="aw-detail-status"><StatusMark state={lampForTask(task)}/>{taskStatus(task)}</span><h2>{task.title}</h2><div className="aw-detail-meta">{taskAgent?.displayName||'个人 Worker'}{task.updatedAt?` · ${formatTime(task.updatedAt)}`:''}</div>{task.brief&&<section><h3>任务说明</h3><p>{task.brief}</p></section>}{task.workerProgress&&<section><h3>最新进度</h3><p>{task.workerProgress}</p></section>}<button type="button" className="aw-detail-button" onClick={openCanvas}>打开协作画布 <ArrowUpRight size={16}/></button></div>:<div className="aw-empty"><span><BriefcaseBusiness size={21}/></span><strong>任务已更新</strong><button type="button" className="aw-text-button" onClick={back}>返回</button></div>)}
        </>}
      </div></main>
      <nav className="aw-nav" aria-label="应用导航"><button type="button" aria-current={nav==='work'?'page':undefined} onClick={()=>navigate('work')}><LayoutGrid size={20}/><span>工作</span></button><button type="button" aria-current={nav==='assistants'?'page':undefined} onClick={()=>navigate('assistants')}><UsersRound size={20}/><span>助手</span></button></nav>
    </div>
  </section>;
}
