import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,CalendarCheck,ChevronDown,IdCard,ListChecks,LoaderCircle,RefreshCw,TriangleAlert} from 'lucide-react';
import styles from './ai-work.css';
import {callApi,errorText,stateFrom} from './api.mjs';
import {resolveHostTheme,watchHostTheme} from './canvas/theme.mjs';
import {RUNTIMES,needsYou,sortByRecent} from './work/model.mjs';
import {RuntimeScreen,TasksScreen,TaskScreen,TodayScreen,WorkerScreen,WorkersScreen} from './work/screens.jsx';

const TABS=[['today','今天',CalendarCheck],['tasks','任务',ListChecks],['workers','Worker',IdCard]];
const ROOT_STACK=[{name:'today'}];

function useHostTheme(){
  const [theme,setTheme]=useState(()=>resolveHostTheme());
  useEffect(()=>watchHostTheme(setTheme),[]);
  return theme;
}

function ProjectBar({projects,projectId,pending,onSelect}){
  return <div className="aw-context">
    <div><span className="aw-label">当前项目</span>{projects.length?<label className="aw-project"><span className="aw-sr">选择项目</span><select value={projectId||''} onChange={onSelect}>{projects.map(p=><option key={p.id} value={p.id}>{p.name||p.title}</option>)}</select><ChevronDown size={15} aria-hidden="true"/></label>:<strong>当前会话暂无项目</strong>}</div>
    <span className="aw-pending"><span className="aw-mono" data-active={pending>0||undefined}>{pending}</span><small>待你确认</small></span>
  </div>;
}

/** Embedded mobile app in the native right sidebar; it owns no Agent runtime. */
export function AIWork({sessionId,active,tabSignal,watchChanges,bindRefresh,openCanvas}){
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[error,setError]=useState('');
  const [stack,setStack]=useState(ROOT_STACK);
  const project=useRef(null),sequence=useRef(0),fetching=useRef(null),mounted=useRef(false),scroll=useRef(null);
  const theme=useHostTheme();
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
    mounted.current=true;project.current=null;setData(null);setLoading(true);setError('');setStack(ROOT_STACK);
    const stop=()=>fetching.current?.abort();tabSignal?.addEventListener('abort',stop,{once:true});void load();
    return()=>{mounted.current=false;stop();tabSignal?.removeEventListener('abort',stop);};
  },[sessionId,tabSignal,load]);
  useEffect(()=>{if(!active)return;const id=setInterval(()=>{if(document.visibilityState==='visible')void load({quiet:true});},6000);return()=>clearInterval(id);},[active,load]);
  useEffect(()=>watchChanges?.(()=>{if(active)void load({quiet:true});}),[active,load,watchChanges]);
  useEffect(()=>bindRefresh?.(()=>void load()),[bindRefresh,load]);

  const top=stack[stack.length-1],root=stack[0].name,nested=stack.length>1;
  useEffect(()=>{if(scroll.current)scroll.current.scrollTop=0;},[top.name,top.id]);

  const agents=data?.commerceNetwork?.agentServices||[],parties=data?.commerceNetwork?.parties||[],rawOrders=data?.commerceNetwork?.workOrders||[];
  const orders=useMemo(()=>sortByRecent(rawOrders),[rawOrders]);
  const pending=orders.filter(needsYou).length;

  const go=(name,id)=>setStack(s=>[...s,{name,id}]);
  const switchTab=name=>setStack([{name}]);
  const back=()=>setStack(s=>s.length>1?s.slice(0,-1):s);
  const selectProject=e=>{const id=e.target.value||null;project.current=id;setData(null);setLoading(true);setStack(ROOT_STACK);void load({projectId:id});};
  const bar=data?<ProjectBar projects={data.projects} projectId={data.projectId} pending={pending} onSelect={selectProject}/>:null;
  const view={agents,parties,orders,go,bar};

  const worker=top.name==='worker'?agents.find(a=>a.id===top.id):null;
  const heading=top.name==='worker'?(worker?.displayName||'Worker'):top.name==='runtime'?(RUNTIMES.find(r=>r.id===top.id)?.name||'Agent'):top.name==='task'?'任务详情':'AI Work';
  const dock=top.name==='today'&&pending>0?'在协作画布中处理':top.name==='worker'||top.name==='task'?'打开协作画布':top.name==='workers'&&data&&agents.length===0?'打开协作画布':null;

  return <section className="cn aw-root" data-theme={theme} aria-label="AI Work 嵌入式应用"><style>{styles}</style>
    <div className="aw-app">
      <header className="aw-header"><div className="aw-heading">{nested&&<button type="button" className="aw-icon" onClick={back} aria-label="返回"><ArrowLeft size={19}/></button>}<h1 className={nested?undefined:'aw-wordmark aw-mono'}>{heading}</h1></div><button type="button" className="aw-icon" aria-label="刷新 AI Work" title="刷新" disabled={refreshing} onClick={()=>void load()}><RefreshCw size={17} className={refreshing?'aw-spin':''}/></button></header>
      <main className="aw-scroll" ref={scroll}><div className="aw-inner" key={`${top.name}:${top.id||''}`}>
        {error&&<div className="aw-feedback" role="alert"><TriangleAlert size={16}/><span>{error}</span><button type="button" onClick={()=>void load()}>重试</button></div>}
        {loading&&!data?<div className="aw-loading"><LoaderCircle className="aw-spin" size={21}/><span>正在读取…</span></div>:!data?<div className="aw-unavailable"><p>暂时无法读取工作区</p><button type="button" onClick={()=>void load()}>重新读取</button></div>:<>
          {top.name==='today'&&<TodayScreen v={view}/>}
          {top.name==='tasks'&&<TasksScreen v={view}/>}
          {top.name==='workers'&&<WorkersScreen v={view}/>}
          {top.name==='worker'&&<WorkerScreen v={view} id={top.id}/>}
          {top.name==='runtime'&&<RuntimeScreen v={view} id={top.id}/>}
          {top.name==='task'&&<TaskScreen v={view} id={top.id}/>}
        </>}
      </div></main>
      {dock&&<div className="aw-dock"><button type="button" className="aw-primary" onClick={openCanvas}>{dock}<ArrowUpRight size={16} aria-hidden="true"/></button></div>}
      <nav className="aw-tabbar" aria-label="应用导航">{TABS.map(([id,label,Icon])=><button type="button" key={id} aria-current={root===id?'page':undefined} onClick={()=>switchTab(id)}><Icon size={20} aria-hidden="true"/><span>{label}</span></button>)}</nav>
    </div>
  </section>;
}
