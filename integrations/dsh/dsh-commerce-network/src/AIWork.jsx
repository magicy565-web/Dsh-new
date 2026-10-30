import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Activity,ArrowDownRight,ArrowRight,ArrowUpRight,Bot,CheckCircle2,ChevronDown,Clock3,Layers3,LoaderCircle,Network,RefreshCw,ShieldCheck,Sparkles,TriangleAlert} from 'lucide-react';
import styles from './ai-work.css';
import {callApi,errorText,requestId,stateFrom} from './api.mjs';
import {nativeInstruction} from './native.mjs';

const PROVIDERS=[
  {id:'grokbot',name:'Grok Bot',initial:'G',kind:'WEBHOOK',description:'接收任务并回传执行结果',hint:'需要确认 webhook 与回调协议。'},
  {id:'muse',name:'Muse Agent',initial:'M',kind:'WORKER',description:'主动领取任务并提交成果',hint:'需要确认 Muse 侧的连接协议。'},
];
const STATUS={proposed:'待审批',authorized:'已授权',queued:'等待领取',claimed:'已领取',running:'执行中',delivered:'待验收',accepted:'已验收',rejected:'已退回',cancelled:'已取消',stop_requested:'停止待确认',failed:'需处理'};
const pending=new Set(['proposed','delivered']);
const running=new Set(['queued','claimed','running','stop_requested']);
const taskStatus=o=>o.grokHandoff?.state==='unknown'?'派送结果待核对':o.grokHandoff?.state==='preparing'?'准备派送':o.grokHandoff?.state==='not_claimed'?'未领取，待核对':o.grokHandoff?.state==='not_sent_stop_requested'?'停止待确认':STATUS[o.status]||o.status;
const fmt=value=>{if(!value)return '暂无活动记录';const date=new Date(value);return Number.isNaN(date.valueOf())?'暂无活动记录':`最近网关活动 ${new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date)}`;};

function ProviderCard({provider,agents,orders,onConfigure,disabled}){
  const active=agents.filter(a=>a.status==='connected');
  const issued=agents.some(a=>a.status==='credential_issued');
  const tone=active.length?'verified':agents.length?'pending':'empty';
  const label=active.length?'网关已认证':issued?'凭证待验证':agents.length?'已登记，待接入':'尚未接入';
  const latest=active.map(a=>a.lastSeenAt).filter(Boolean).sort().at(-1);
  const taskCount=orders.filter(o=>agents.some(a=>a.id===o.agentServiceId)&&running.has(o.status)).length;
  return <article className={`aw-provider aw-${provider.id}`}>
    <div className="aw-provider-top"><span className="aw-provider-mark" aria-hidden="true">{provider.initial}<span/></span><span className="aw-provider-kind">{provider.kind}</span><span className={`aw-badge aw-badge-${tone}`}><i/>{label}</span></div>
    <h3>{provider.name}</h3><p>{provider.description}</p>
    <div className="aw-provider-detail">{active.length?<><span>{fmt(latest)}</span><span>{taskCount} 项进行中</span></>:<span>{provider.hint}</span>}</div>
    <button type="button" className="aw-card-action" onClick={()=>onConfigure(provider)} disabled={disabled}>{agents.length?'查看接入方式':'开始接入'}<ArrowUpRight size={15}/></button>
  </article>;
}

export function AIWork({sessionId,active,tabSignal,submitPrompt,watchChanges,bindRefresh,openCanvas}){
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pendingPrompt,setPendingPrompt]=useState(false);
  const project=useRef(null),sequence=useRef(0),fetching=useRef(null),lifetime=useRef(null),mounted=useRef(false);
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
    mounted.current=true;project.current=null;setData(null);setLoading(true);setError('');setNotice('');
    const controller=new AbortController();lifetime.current=controller;
    const stop=()=>{controller.abort();fetching.current?.abort();};tabSignal?.addEventListener('abort',stop,{once:true});void load();
    return()=>{mounted.current=false;stop();tabSignal?.removeEventListener('abort',stop);};
  },[sessionId,tabSignal,load]);
  useEffect(()=>{if(!active)return;const id=setInterval(()=>{if(document.visibilityState==='visible')void load({quiet:true});},6000);return()=>clearInterval(id);},[active,load]);
  useEffect(()=>watchChanges?.(()=>{if(active)void load({quiet:true});}),[active,load,watchChanges]);
  useEffect(()=>bindRefresh?.(()=>void load()),[bindRefresh,load]);
  const agents=data?.commerceNetwork?.agentServices||[],orders=data?.commerceNetwork?.workOrders||[];
  const recent=useMemo(()=>[...orders].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))).slice(0,6),[orders]);
  const configure=async(provider)=>{
    if(!active||pendingPrompt)return;setPendingPrompt(true);setError('');setNotice('');
    try{
      const prompt=`我想在当前工作区接入我的 ${provider.name}。请先读取当前 Commerce Network 真实项目和 Worker 记录，说明需要核实的连接方式与安全配置。只有在我明确提供服务商身份和能力后，才以 providerType ${provider.id} 登记；使用现有 Worker 凭证和任务审批流程。${provider.id==='grokbot'?'私有主机配置完成后可使用 commerce_grok_connect 验证网关；经人工审批并在此会话 dispatch 后，只有我明确要求才使用 commerce_grok_handoff 交接。':'Muse 需要在其自身运行环境接入 DSH Worker 网关适配器，旧 Muse REST 路径并不自动兼容。'}不要把登记或凭证握手当成外部服务已在线，不要索要聊天中的密钥，不要自动派发任务。`;
      await submitPrompt(nativeInstruction(project.current,prompt,null),requestId(),lifetime.current?.signal);
      if(mounted.current)setNotice('已交给当前 Assistant，请在会话中继续。');
    }catch(e){if(mounted.current)setError(errorText(e));}finally{if(mounted.current)setPendingPrompt(false);}
  };
  const selectProject=e=>{const id=e.target.value||null;project.current=id;setData(null);setLoading(true);setNotice('');void load({projectId:id});};
  return <section className="cn aw-root" aria-label="AI Work 智能工作台"><style>{styles}</style>
    <header className="aw-header"><div className="aw-brand"><span className="aw-brand-icon"><Sparkles size={18}/></span><div><span>YOUR WORKSPACE</span><h1>AI Work</h1></div></div><div className="aw-header-actions"><button type="button" className="aw-icon" aria-label="刷新 AI Work" title="刷新" disabled={refreshing} onClick={()=>void load()}><RefreshCw size={17} className={refreshing?'aw-spin':''}/></button><button type="button" className="aw-icon" aria-label="打开商业协作画布" title="打开商业协作画布" onClick={openCanvas}><Network size={18}/></button></div></header>
    <div className="aw-scroll"><div className="aw-inner">
      <div className="aw-intro"><div className="aw-intro-copy"><div className="aw-kicker"><span/> YOUR AI WORKSPACE</div><h2>与你的 AI，<br/><em>一起把事做好。</em></h2><p>把工作交给信任的助手，进度与成果都留在同一个工作区。</p></div><div className="aw-orbit" aria-hidden="true"><span className="aw-orbit-one"/><span className="aw-orbit-two"/><span className="aw-orbit-center"><Sparkles size={26}/></span><i/><b/></div></div>
      <div className="aw-workspace-bar"><div><span className="aw-overline">当前工作区项目</span>{data?.projects?.length?<label className="aw-project"><span className="aw-sr">选择项目</span><select value={data.projectId||''} onChange={selectProject}>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name||p.title}</option>)}</select><ChevronDown size={14}/></label>:<strong>{loading?'正在读取…':'尚未创建项目'}</strong>}</div><div className="aw-count"><span>待你处理</span><strong>{loading?'—':orders.filter(o=>pending.has(o.status)).length}<small> 项</small></strong></div></div>
      {error&&<div className="aw-feedback aw-error" role="alert"><TriangleAlert size={16}/><span>{error}</span><button type="button" onClick={()=>void load()}>重试</button></div>}{notice&&<div className="aw-feedback" role="status"><CheckCircle2 size={16}/><span>{notice}</span></div>}
      {loading&&!data?<div className="aw-loading"><LoaderCircle className="aw-spin" size={23}/><span>正在读取工作区…</span></div>:!data?<div className="aw-unavailable"><p>暂时无法读取 AI Work。</p><button type="button" onClick={()=>void load()}>重新读取</button></div>:<>
      <div className="aw-section-heading"><div><span className="aw-overline">YOUR TEAM</span><h2>你的 AI 助手</h2></div><span className="aw-section-meta">{agents.filter(a=>a.status==='connected').length} 个网关已认证</span></div>
      <div className="aw-providers">{PROVIDERS.map(p=><ProviderCard key={p.id} provider={p} agents={agents.filter(a=>a.providerType===p.id)} orders={orders} onConfigure={configure} disabled={!active||pendingPrompt}/>)}</div>
      <div className="aw-trust"><ShieldCheck size={16}/><span>网关认证仅表示凭证已验证；外部助手能否执行仍需实际核验。</span></div>
      {agents.some(a=>!['grokbot','muse'].includes(a.providerType))&&<div className="aw-other"><Layers3 size={16}/><span>另有 {agents.filter(a=>!['grokbot','muse'].includes(a.providerType)).length} 个其他已登记 Worker</span><button type="button" onClick={openCanvas}>查看 <ArrowRight size={14}/></button></div>}
      <div className="aw-section-heading aw-activity-heading"><div><span className="aw-overline">YOUR WORK</span><h2>最近任务</h2></div><button type="button" className="aw-text-link" onClick={openCanvas}>打开协作画布 <ArrowUpRight size={14}/></button></div>
      {recent.length?<div className="aw-tasks">{recent.map(o=>{const agent=agents.find(a=>a.id===o.agentServiceId);return <button type="button" className="aw-task" key={o.id} onClick={openCanvas}><span className="aw-task-icon"><Activity size={16}/></span><span className="aw-task-copy"><strong>{o.title}</strong><small>{agent?.displayName||'已登记 Worker'}{o.workerProgress?` · ${o.workerProgress}`:''}</small></span><span className={`aw-task-status ${pending.has(o.status)||o.grokHandoff?.state==='unknown'?'aw-needs-review':''}`}>{taskStatus(o)}</span><ArrowUpRight size={14}/></button>;})}</div>:<div className="aw-empty"><span><Clock3 size={20}/></span><div><strong>你的工作，从这里开始</strong><p>接入助手后，可在协作画布中创建任务并由你审核。</p></div><ArrowDownRight size={18}/></div>}
      <div className="aw-footer"><span><ShieldCheck size={14}/> 授权与交付由你掌控</span><span>DSH WORKSPACE</span></div>
      </>}
    </div></div>
  </section>;
}
