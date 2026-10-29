import {BusinessWorkbench} from './BusinessWorkbench.jsx';
import {Mandates} from './Mandates.jsx';
import {TradeInspector,ImportRfq} from './TradeInspector.jsx';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ReactFlow,ReactFlowProvider,Background,BackgroundVariant,MiniMap,applyNodeChanges,useReactFlow,MarkerType} from '@xyflow/react';
import {Network,Plus,Search,ChevronDown,ChevronRight,RefreshCw,Check,AlertCircle,Clock3,Users,SlidersHorizontal,LayoutGrid,ZoomIn,ZoomOut,Maximize2,Map as MapIcon,PanelRightClose,ArrowUpRight,ArrowRight,X,Activity,ShieldCheck,Wallet,LoaderCircle,Bot,Factory,UserRound,Copy} from 'lucide-react';
import flowCss from '@xyflow/react/dist/style.css';
import appCss from './styles.css';
import {callApi,stateFrom,unwrap,requestId,errorText} from './api.mjs';
import {projectGraph,KINDS,STATUSES,EDGE_LABELS,autoLayout,initialViewport,money,timestamp,selectedRecord,eventLabel} from './model.mjs';
import {NodeCard,KindIcon,Status} from './NodeCard.jsx';
import {Inspector,RelationshipInspector,Dialog,ReviewDialog,CredentialDialog,ArtifactDialog} from './Inspector.jsx';
import {nativeInstruction} from './native.mjs';

const nodeTypes={commerce:NodeCard};
const EMPTY={projects:[],revision:0,projectId:null,events:[]};
const publicState=value=>{const {credential,...rest}=value;return rest;};
const nodeColor={factory:'#d5a45d',distributor:'#79a39d',personal_agent:'#9c91d6',service_order:'#7b9cce',product:'#8c9eab',market:'#91a98d',channel:'#ca997e',worker:'#a498c5',buyer:'#78aaa7',quote:'#b296bc',order:'#87a477',approval:'#c9a166',evidence:'#8b9faf'};
const edgeStyle=(edge)=>{
  const active=['running','claimed'].includes(edge.status),pending=/proposed/.test(edge.kind),revoked=edge.kind==='sales_revoked';
  return {id:edge.id,source:edge.source,target:edge.target,type:'smoothstep',animated:active,label:EDGE_LABELS[edge.kind]||edge.kind,
    style:{stroke:revoked?'#bd9696':pending?'#c2b69d':active?'#8b80bd':'#a3aba6',strokeWidth:1.5,strokeDasharray:pending||revoked?'5 5':undefined},
    labelStyle:{fill:'#727a74',fontSize:10,fontWeight:500},labelBgStyle:{fill:'#f7f8f5',fillOpacity:.96},labelBgPadding:[6,4],labelBgBorderRadius:5,
    markerEnd:{type:MarkerType.ArrowClosed,color:active?'#8b80bd':'#a3aba6',width:13,height:13}};
};
function flowNode(item,onAsk){return {id:item.id,type:'commerce',position:item.position,data:{item,onAsk},width:270,style:{width:270},draggable:true,selectable:true};}
function Message({type='info',children,onDismiss}){return <div className={`cn-message cn-message-${type}`} role={type==='error'?'alert':'status'}>{type==='error'?<AlertCircle size={16}/>:<Check size={16}/>}<span>{children}</span>{onDismiss&&<button className="cn-icon-button" aria-label="关闭提示" onClick={onDismiss}><X size={14}/></button>}</div>;}

function CanvasSurface({graph,query,view,onSelect,onSelectEdge,selectedId,onAsk,onSaveLayout,onLayoutStatus,onError,focusId,actionRef,showMap,showEdgeLabels}) {
  const {fitView,zoomIn,zoomOut,getViewport,getNodes}=useReactFlow();
  const [nodes,setNodes]=useState(()=>graph.nodes.map(n=>flowNode(n,onAsk)));
  const [startingViewport]=useState(()=>initialViewport(graph));
  const nodesRef=useRef(nodes),graphRef=useRef(graph),lastProject=useRef(graph.projectId),layoutRevision=useRef(graph.layoutRevision),writeQueue=useRef(Promise.resolve()),alive=useRef(true),latestSave=useRef(0),dirty=useRef(false);
  graphRef.current=graph;nodesRef.current=nodes;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const changedProject=lastProject.current!==graph.projectId,newSaved=graph.layoutRevision>layoutRevision.current;
    if(changedProject||newSaved){layoutRevision.current=graph.layoutRevision;lastProject.current=graph.projectId;dirty.current=false;}
    setNodes(current=>{
      const positions=new Map(current.map(n=>[n.id,n.position]));
      return graph.nodes.map(item=>flowNode({...item,position:!changedProject&&!newSaved&&positions.has(item.id)?positions.get(item.id):item.position},onAsk));
    });
  },[graph,onAsk]);
  const commit=useCallback((nextNodes,viewport=getViewport())=>{
    const graphNow=graphRef.current,projectId=graphNow.projectId;
    if(!graphNow.commerceNetwork?.layoutWriteSupported){onError('当前服务未开放布局保存。');return;}
    const serial=++latestSave.current;
    onLayoutStatus('saving');dirty.current=true;
    const positions=nextNodes.map(n=>({id:n.id,position:{x:n.position.x,y:n.position.y}}));
    const task=writeQueue.current.then(async()=>{
      if(!alive.current||lastProject.current!==projectId)return;
      const expectedLayoutRevision=layoutRevision.current;
      const receipt=await onSaveLayout({projectId,expectedLayoutRevision,nodes:positions,viewport});
      if(!Number.isSafeInteger(receipt?.layoutRevision)||receipt.layoutRevision<=expectedLayoutRevision)throw new Error('尚未收到布局保存回执，请刷新核对。');
      layoutRevision.current=Math.max(layoutRevision.current,receipt.layoutRevision);
      if(serial===latestSave.current){dirty.current=false;onLayoutStatus('saved');}
    });
    writeQueue.current=task.catch(()=>{});
    void task.catch(error=>{if(alive.current){onLayoutStatus('error');onError(errorText(error));}});
  },[getViewport,onSaveLayout,onError,onLayoutStatus]);
  const arrange=useCallback(()=>{
    const positions=new Map(autoLayout(graphRef.current.nodes).map(n=>[n.id,n.position]));
    const arranged=nodesRef.current.map(n=>({...n,position:positions.get(n.id)||n.position}));
    nodesRef.current=arranged;setNodes(arranged);onLayoutStatus('saving');
    requestAnimationFrame(()=>{void fitView({duration:260,padding:.22,maxZoom:1}).then(()=>commit(arranged,getViewport()));});
  },[commit,fitView,getViewport,onLayoutStatus]);
  useEffect(()=>{actionRef.current={fit:async()=>{await fitView({duration:250,padding:.2,maxZoom:1.05});commit(nodesRef.current,getViewport());},zoomIn:async()=>{await zoomIn();commit(nodesRef.current,getViewport());},zoomOut:async()=>{await zoomOut();commit(nodesRef.current,getViewport());},arrange};return()=>{actionRef.current=null;};},[actionRef,arrange,commit,fitView,getViewport,zoomIn,zoomOut]);
  useEffect(()=>{
    if(!focusId)return;
    const ids=new Set([focusId]);for(const e of graphRef.current.edges){if(e.source===focusId)ids.add(e.target);if(e.target===focusId)ids.add(e.source);}
    void fitView({nodes:[...ids].map(id=>({id})),duration:280,padding:.3,maxZoom:1});
  },[focusId,fitView]);
  const allowedKinds=view==='network'?new Set(['factory','distributor','personal_agent','service_order','business_mandate','product','market','channel']):view==='execution'?new Set(['personal_agent','service_order','worker','buyer','rfq','quote','order','erp_order','sample','approval','evidence']):null;
  const visible=nodes.filter(n=>!allowedKinds||allowedKinds.has(n.data.item.kind));
  const visibleIds=new Set(visible.map(n=>n.id));
  const needle=query.trim().toLowerCase();
  const displayed=visible.map(n=>({...n,selected:n.id===selectedId,className:needle&&!`${n.data.item.title} ${KINDS[n.data.item.kind]}`.toLowerCase().includes(needle)?'cn-search-muted':undefined}));
  const edges=graph.edges.filter(e=>visibleIds.has(e.source)&&visibleIds.has(e.target)).map(e=>({...edgeStyle(e),...showEdgeLabels?{}:{label:undefined}}));
  return <ReactFlow nodes={displayed} edges={edges} nodeTypes={nodeTypes} onNodesChange={changes=>setNodes(current=>applyNodeChanges(changes.filter(c=>c.type!=='remove'),current))}
    onNodeClick={(_,n)=>onSelect(n.id)} onEdgeClick={(_,e)=>onSelectEdge?.(e.id)} onPaneClick={()=>onSelect(null)} onNodeDoubleClick={(_,n)=>void fitView({nodes:[{id:n.id}],duration:220,padding:1,maxZoom:1.1})}
    onNodeDragStop={(_,node)=>{const next=nodesRef.current.map(n=>n.id===node.id?{...n,position:node.position}:n);nodesRef.current=next;commit(next);}}
    onMoveEnd={(event,viewport)=>{if(event)commit(nodesRef.current,viewport);}}
    defaultViewport={startingViewport}
    minZoom={.12} maxZoom={2.2} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} panOnDrag={[0,1,2]} zoomOnScroll selectionOnDrag={false} proOptions={{hideAttribution:true}}
    className="cn-flow" aria-label="海外销售协作网络无限画布">
    <Background variant={BackgroundVariant.Dots} color="#d5dad2" size={1.1} gap={22}/>
    {showMap&&<MiniMap position="bottom-right" nodeColor={n=>nodeColor[n.data?.item?.kind]||'#b9bdb5'} pannable zoomable maskColor="rgba(242,244,239,.75)" ariaLabel="网络导航缩略图"/>}
  </ReactFlow>;
}

function EmptyCanvas({onAsk,pending,hasProject}){
  return <div className="cn-empty"><div className="cn-empty-network" aria-hidden="true"><span><Factory size={26}/></span><i/><span className="cn-empty-bot"><Bot size={29}/></span><i/><span><UserRound size={26}/></span></div><span className="cn-eyebrow">YOUR COMMERCE NETWORK</span><h2>{hasProject?'让这个项目开始协作':'把海外销售，连接成一张网络'}</h2><p>在左侧说出目标。Assistant 会把产品、工厂、代理商与 Personal AI Worker 整理成可持续协作的业务网络。</p><button className="cn-button cn-primary cn-large" disabled={pending} onClick={()=>onAsk(null,'请基于当前工作区已有的产品资料，为我建立一个海外销售协作网络。先读取真实资料；缺少目标市场或参与方信息时，在当前对话中询问我，再保存业务计划。')}><Plus size={17}/>从产品资料开始 <ArrowRight size={16}/></button><div className="cn-empty-shortcuts"><button disabled={pending} onClick={()=>onAsk(null,'我想把自己的 Personal AI Worker 注册到当前协作网络。请先读取已登记成员和项目，并引导我提供服务商名称、Agent 名称和服务能力。')}>接入我的 AI Worker <ArrowUpRight size={13}/></button><button disabled={pending} onClick={()=>onAsk(null,'我想建立工厂与海外代理商的协作关系。请读取当前资料，并在对话中确认双方名称、销售区域与合作范围。')}>邀请海外销售代理 <ArrowUpRight size={13}/></button></div><small>业务资料由你提供 · 所有执行保留授权与交付记录</small></div>;
}

function ActivityPanel({state,onClose,onSelect}) {
  const events=[...(state.events||[])].reverse().slice(0,100);
  return <aside className="cn-activity-panel" aria-label="协作动态"><header><Activity size={17}/><strong>协作动态</strong><span>{events.length}</span><button className="cn-icon-button" onClick={onClose} aria-label="关闭协作动态"><X size={17}/></button></header><div>{events.length?events.map((event,i)=><button className="cn-event" key={event.id||i} onClick={()=>onSelect(event.entityId||event.orderId||event.agentServiceId)}><span className="cn-event-dot"><Check size={12}/></span><span><b>{eventLabel(event)}</b><small>{timestamp(event.at||event.createdAt)}{event.actorType?` · ${event.actorType==='worker'?'Personal Agent':'工作区'}`:''}</small></span><ChevronRight size={14}/></button>):<div className="cn-panel-empty"><Clock3 size={27}/><p>第一条协作记录，将从这里开始。</p></div>}</div></aside>;
}
function MembersPanel({state,onClose,onAsk,onSelect}) {
  const network=state.commerceNetwork||{},parties=(network.parties||[]).filter(p=>p.type!=='provider'&&p.type!=='agent_provider'),agents=network.agentServices||[];
  return <aside className="cn-members-panel" aria-label="协作成员"><header><Users size={17}/><strong>协作成员</strong><button className="cn-icon-button" onClick={onClose} aria-label="关闭协作成员"><X size={17}/></button></header><p className="cn-panel-intro">连接提供产品、市场关系和专业服务的每一方。</p><div className="cn-member-list">{parties.map(p=><button key={p.id} onClick={()=>onSelect(`${p.type}:${p.id}`)}><span className={`cn-member-avatar cn-kind-${p.type}`}><KindIcon kind={p.type}/></span><span><b>{p.displayName}</b><small>{KINDS[p.type]}{p.marketCode?` · ${p.marketCode}`:''}</small></span><ChevronRight size={15}/></button>)}{agents.map(a=><button key={a.id} onClick={()=>onSelect(`personal_agent:${a.id}`)}><span className="cn-member-avatar cn-kind-personal_agent"><Bot size={18}/></span><span><b>{a.displayName}</b><small>{a.status==='connected'?'已连接':a.status==='revoked'?'访问已撤销':'等待连接'} · Personal Agent</small></span><ChevronRight size={15}/></button>)}</div><button className="cn-button cn-primary" onClick={()=>onAsk(null,'为当前项目添加一位协作成员。请在当前对话中确认这是工厂、海外代理商还是 Personal AI Worker 服务商，并收集必要资料后登记。')}><Plus size={15}/>通过对话添加成员</button></aside>;
}

function BudgetDialog({project,onClose,onSave,busy,error}){
  const budget=project?.budget||{};
  const current=budget.maximumMinor??project?.maximumMinor??0,currency=budget.currency||project?.currency||'USD';
  const [value,setValue]=useState((current/100).toFixed(2));
  const minor=Math.round(Number(value)*100),valid=value.trim()!==''&&Number.isFinite(Number(value))&&Number.isSafeInteger(minor)&&minor>=0&&/^\d+(\.\d{0,2})?$/.test(value);
  return <Dialog title="项目服务预算" onClose={onClose} footer={<><button className="cn-button" onClick={onClose}>返回</button><button className="cn-button cn-primary" disabled={!valid||busy} onClick={()=>onSave({maximumMinor:minor,currency})}>{busy?'保存中…':'确认预算上限'}</button></>}><p>设置这个项目允许授权的服务费用上限。每项委托仍需单独批准；设置预算不会扣款。</p>{error&&<p className="cn-danger-text" role="alert">{error}</p>}<div className="cn-budget-breakdown"><span>服务预留 <b>{money(budget.reservedMinor??0,currency)}</b></span><span>已验收服务 <b>{money(budget.accruedMinor??0,currency)}</b></span>{budget.riskHeldMinor>0&&<span className="cn-danger-text">待核对的预留 <b>{money(budget.riskHeldMinor,currency)}</b></span>}</div><label className="cn-field"><span>预算上限 · {currency}</span><input type="text" inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)} aria-label="项目服务预算上限"/></label><p className="cn-field-note">设为 0 时，仅允许免费委托。已有服务预留会由服务端检查。</p></Dialog>;
}

export function CommerceApp({sessionId,active=true,submitPrompt,watchChanges,tabSignal,bindRefresh}) {
  const [selectedEdgeId,setSelectedEdgeId]=useState(null);
  const [importOpen,setImportOpen]=useState(false);
  const [mandatesOpen,setMandatesOpen]=useState(false);
  const [workbenchOpen,setWorkbenchOpen]=useState(false);
  const [state,setState]=useState(EMPTY),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(null),[toast,setToast]=useState(null),[selectedId,setSelectedId]=useState(null),[focusId,setFocusId]=useState(null),[query,setQuery]=useState(''),[view,setView]=useState('all'),[panel,setPanel]=useState(null),[review,setReview]=useState(null),[credential,setCredential]=useState(null),[artifact,setArtifact]=useState(null),[budgetOpen,setBudgetOpen]=useState(false),[busy,setBusy]=useState(false),[promptPending,setPromptPending]=useState(false),[showMap,setShowMap]=useState(false),[showLabels,setShowLabels]=useState(true),[layoutStatus,setLayoutStatus]=useState('saved');
  const stateRef=useRef(state),projectRef=useRef(null),loadRef=useRef(null),alive=useRef(true),commandLock=useRef(false),actions=useRef(null),rootRef=useRef(null),loadSequence=useRef(0),abortLifetime=useRef(new AbortController());
  stateRef.current=state;
  const graph=useMemo(()=>projectGraph(state),[state]);
  const project=state.projects?.find(p=>p.id===state.projectId),selection=graph?.nodes.find(n=>n.id===selectedId)||null;
  const selectedEdge=graph?.edges.find(e=>e.id===selectedEdgeId)||null;
  const workOrders=state.commerceNetwork?.workOrders||[],decisions=workOrders.filter(o=>['proposed','delivered'].includes(o.status)),running=workOrders.filter(o=>['queued','claimed','running'].includes(o.status)).length;
  const load=useCallback(async({quiet=false,projectId=projectRef.current}={})=>{
    const sequence=++loadSequence.current;
    loadRef.current?.abort();const controller=new AbortController();loadRef.current=controller;
    if(!quiet)setRefreshing(true);
    try{
      const params=new URLSearchParams({sessionId,...projectId?{projectId}:{}});
      const next=stateFrom(await callApi(`/workspace?${params}`,{signal:controller.signal}));
      if(!alive.current||sequence!==loadSequence.current)return;
      if(!Array.isArray(next.projects)||!Number.isSafeInteger(next.revision))throw new Error('业务数据不完整，请检查插件服务。');
      if(next.projectId){try{next.trade=unwrap(await callApi(`/trade?${new URLSearchParams({sessionId,projectId:next.projectId})}`,{signal:controller.signal}));}catch(e){if(e.name==='AbortError')throw e;next.tradeUnavailable=e.message;}}
      if(!alive.current||sequence!==loadSequence.current)return;
      projectRef.current=next.projectId||null;setState(publicState(next));if(!quiet)setError(null);
      return next;
    }catch(err){if(alive.current&&sequence===loadSequence.current&&err.name!=='AbortError')setError(errorText(err));}
    finally{if(alive.current&&sequence===loadSequence.current){setLoading(false);setRefreshing(false);}}
  },[sessionId]);
  useEffect(()=>{
    alive.current=true;projectRef.current=null;setState(EMPTY);setLoading(true);setMandatesOpen(false);setWorkbenchOpen(false);setImportOpen(false);setSelectedId(null);setCredential(null);setReview(null);setArtifact(null);
    const controller=new AbortController();abortLifetime.current=controller;
    const stop=()=>{controller.abort();loadRef.current?.abort();};tabSignal?.addEventListener('abort',stop,{once:true});
    void load();
    return ()=>{alive.current=false;stop();tabSignal?.removeEventListener('abort',stop);};
  },[load,sessionId,tabSignal]);
  useEffect(()=>{if(!active||review||credential)return;const interval=setInterval(()=>{if(document.visibilityState==='visible'&&!commandLock.current)void load({quiet:true});},6000);return()=>clearInterval(interval);},[active,load,review,credential]);
  useEffect(()=>watchChanges?.(()=>{if(active)void load({quiet:true});}),[active,load,watchChanges]);
  useEffect(()=>bindRefresh?.(()=>void load()),[bindRefresh,load]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),6000);return()=>clearTimeout(timer);},[toast]);
  const onError=useCallback(message=>setError(message),[]);
  const onAsk=useCallback(async(node,text)=>{
    if(promptPending||!active)return;
    setPromptPending(true);setError(null);
    try{
      const instruction=nativeInstruction(projectRef.current,text||'请核对当前选中业务节点的最新状态、来源和下一步建议。先读取真实数据，不更改授权。',node);
      await submitPrompt(instruction,requestId(),abortLifetime.current.signal);
      if(alive.current)setToast('已交给当前 Assistant，请查看左侧会话。');
    }catch(err){if(alive.current)setError(errorText(err));}
    finally{if(alive.current)setPromptPending(false);}
  },[active,promptPending,submitPrompt]);
  const mutate=useCallback(async(command,payload,expectedRevision)=>{
    if(commandLock.current)throw new Error('上一项操作仍在提交，请稍候。');
    commandLock.current=true;setBusy(true);setError(null);
    const projectId=projectRef.current;
    try{
      const response=await callApi('/command',{body:{sessionId,projectId,expectedRevision:expectedRevision??stateRef.current.revision,requestId:requestId(),command,payload},signal:abortLifetime.current.signal});
      const data=unwrap(response),next=stateFrom(response);
      if(alive.current&&projectId===projectRef.current){if(Array.isArray(next.projects))setState(publicState(next));else await load({quiet:true});}
      return data;
    }catch(err){if(alive.current)setError(errorText(err));throw err;}
    finally{commandLock.current=false;if(alive.current)setBusy(false);}
  },[sessionId,load]);
  const confirm=useCallback(async(command,record,reason)=>{
    const payload=['approve_mandate','revoke_mandate'].includes(command)?{mandateId:record.id}:['issue_agent_credential','revoke_agent'].includes(command)?{agentServiceId:record.id}:{orderId:record.id,...['reject_delivery','resolve_failed_order'].includes(command)?{reason}: {},...command==='approve_order'?{reviewDigest:record.reviewDigest}:{}};
    try{const result=await mutate(command,payload,record.networkRevision);setReview(null);if(result.credential?.token)setCredential(result.credential);else setToast('操作已保存，画布已读取最新状态。');}catch(err){setReview(current=>current?{...current,error:errorText(err)}:current);}
  },[mutate]);
  const openReview=useCallback(async(command,record,revision)=>{
    const currentRecord={...record,networkRevision:revision??stateRef.current.revision};
    setReview({command,record:currentRecord,loading:command==='approve_order'});
    if(command!=='approve_order')return;
    try{
      const params=new URLSearchParams({sessionId,projectId:projectRef.current,orderId:record.id});
      const snapshot=unwrap(await callApi(`/review?${params}`,{signal:abortLifetime.current.signal}));
      if(!snapshot.reviewDigest||snapshot.orderId!==record.id)throw new Error('未收到可核对的授权快照，请刷新后重试。');
      setReview(current=>current?.command===command&&current.record.id===record.id?{command,record:{...record,...snapshot,id:record.id},loading:false}:current);
    }catch(err){setError(errorText(err));setReview(current=>current?.command===command&&current.record.id===record.id?{...current,loading:false,loadFailed:true,error:errorText(err)}:current);}
  },[sessionId]);
  const reloadReview=useCallback(async()=>{
    if(!review||busy)return;
    const current=review;setReview({...current,loading:true,error:null});
    const next=await load();
    if(!next){setReview(value=>value?{...value,loading:false,error:'读取失败，请稍后重新核对。'}:value);return;}
    const network=next.commerceNetwork||{};
    const updated=[...(network.workOrders||[]),...(network.agentServices||[]),...(network.salesAuthorizations||[])].find(r=>r.id===current.record.id);
    if(!updated){setReview(null);setError('这项业务记录已经变化，请重新选择。');return;}
    await openReview(current.command,updated,next.revision);
  },[review,busy,load,openReview]);
  const saveLayout=useCallback(async patch=>{
    const response=await callApi('/layout',{body:{...patch,sessionId,requestId:requestId()},signal:abortLifetime.current.signal});
    const value=unwrap(response),next=stateFrom(response);
    const revision=value.layoutRevision??value.receipt?.layoutRevision??next.canvasLayouts?.find(l=>l.projectId===patch.projectId)?.revision;
    return {layoutRevision:revision};
  },[sessionId]);
  const select=useCallback(id=>{if(id?.startsWith('business_mandate:'))setMandatesOpen(id.slice(17));setSelectedId(id);setSelectedEdgeId(null);setFocusId(null);if(id)setPanel(null);},[]);
  const selectEdge=useCallback(id=>{setSelectedEdgeId(id);setSelectedId(null);setPanel(null);setFocusId(null);},[]);
  const selectEvent=useCallback(ref=>{const node=graph?.nodes.find(n=>n.id===ref||n.refId===ref);if(node){setView('all');select(node.id);setFocusId(node.id);}},[graph,select]);
  const chooseProject=event=>{projectRef.current=event.target.value||null;setSelectedId(null);setPanel(null);setArtifact(null);setImportOpen(false);setLayoutStatus('saved');void load({projectId:projectRef.current});};
  const showDecisions=()=>{const first=decisions[0];if(first){setView('all');selectEvent(`service_order:${first.id}`);}};
  const budget=project?.budget||{};
  return <section className="cn" ref={rootRef} aria-label="Commerce Network 商业协作画布"><style>{flowCss}{appCss}</style>
    {importOpen&&project&&<ImportRfq sessionId={sessionId} projectId={state.projectId} onClose={()=>setImportOpen(false)} onRefresh={()=>void load()}/>}
    {state.tradeUnavailable&&<Message type="error">交易投影读取失败：{state.tradeUnavailable}</Message>}
    {state.trade?.truncated&&<Message>当前画布只显示部分交易记录，请通过原生会话分页读取完整记录。</Message>}
    {state.trade&&Object.values(state.trade.dependencies||{}).some(v=>v!=='available')&&<Message>部分交易插件尚未加载，相关记录暂不可读取。</Message>}
    <header className="cn-header"><div className="cn-heading"><span className="cn-brand"><Network size={21} strokeWidth={1.7}/></span><div><span className="cn-eyebrow">CHANNEL ATLAS</span>{state.projects?.length?<label className="cn-project-select"><span className="cn-sr-only">当前协作项目</span><select value={state.projectId||''} onChange={chooseProject}>{state.projects.map(p=><option key={p.id} value={p.id}>{p.name||p.title}</option>)}</select><ChevronDown size={13}/></label>:<h1>商业协作网络</h1>}</div></div><div className="cn-header-actions"><button className={`cn-icon-button${panel==='members'?' cn-active':''}`} onClick={()=>{setPanel(panel==='members'?null:'members');setSelectedId(null);}} title="协作成员" aria-label="协作成员"><Users size={18}/></button><button className="cn-icon-button" onClick={()=>void load()} disabled={refreshing} title="刷新真实状态" aria-label="刷新真实状态"><RefreshCw size={17} className={refreshing?'cn-spin':''}/></button><button className="cn-button cn-primary cn-add" disabled={promptPending||!active} onClick={()=>onAsk(null,'我想扩展当前海外销售协作网络。请读取项目后，在当前对话中询问我要添加的工厂、产品、市场、代理商或 Personal AI Worker，再保存业务计划。')}><Plus size={15}/><span>扩展网络</span></button></div></header>
    <div className="cn-toolbar"><div className="cn-view-switch" role="group" aria-label="画布视图">{[['all','全局'],['network','商业网络'],['execution','执行流程']].map(([id,label])=><button key={id} className={view===id?'cn-selected':''} aria-pressed={view===id} onClick={()=>{setView(id);setSelectedId(null);}}>{label}</button>)}</div><div className="cn-toolbar-right"><button className="cn-button" disabled={loading||!state.projectId} onClick={()=>setWorkbenchOpen(true)}>业务推进</button><button className="cn-button" disabled={loading||!state.workspaceId} onClick={()=>setMandatesOpen(true)}>业务委托</button>{project&&<button className="cn-button" onClick={()=>setImportOpen(true)}>导入询盘</button>}{decisions.length>0&&<button className="cn-review-pill" onClick={showDecisions}><span/>{decisions.length} 项待决策<ChevronRight size={12}/></button>}{project&&<button className="cn-budget-button" onClick={()=>{setError(null);setBudgetOpen(true);}} title="项目服务预算"><Wallet size={14}/><span>{money(budget.maximumMinor??project.maximumMinor??0,budget.currency||project.currency||'USD')}</span></button>}</div></div>
    <div className="cn-content">
      {loading?<div className="cn-loading"><LoaderCircle className="cn-spin" size={27}/><p>正在读取工作区…</p></div>:graph?.nodes.length?<ReactFlowProvider><CanvasSurface key={`${sessionId}:${graph.projectId}`} graph={graph} query={query} view={view} selectedId={selectedId} onSelect={select} onSelectEdge={selectEdge} onAsk={onAsk} onSaveLayout={saveLayout} onLayoutStatus={setLayoutStatus} onError={onError} focusId={focusId} actionRef={actions} showMap={showMap} showEdgeLabels={showLabels}/></ReactFlowProvider>:!error?<EmptyCanvas onAsk={onAsk} pending={promptPending} hasProject={Boolean(project)}/>:<div className="cn-loading cn-error-empty"><AlertCircle size={28}/><h2>暂时无法打开工作区</h2><p>{error}</p><button className="cn-button" onClick={()=>void load()}><RefreshCw size={15}/>重新读取</button></div>}
      {graph?.nodes.length>0&&<><div className="cn-canvas-search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="查找节点…" aria-label="查找节点"/>{query&&<button aria-label="清除查找" onClick={()=>setQuery('')}><X size={13}/></button>}</div><div className="cn-canvas-tools" role="toolbar" aria-label="无限画布工具"><button title="放大" aria-label="放大" onClick={()=>actions.current?.zoomIn()}><ZoomIn size={18}/></button><button title="缩小" aria-label="缩小" onClick={()=>actions.current?.zoomOut()}><ZoomOut size={18}/></button><i/><button title="适应画布" aria-label="适应画布" onClick={()=>actions.current?.fit()}><Maximize2 size={17}/></button><button title="自动整理并保存布局" aria-label="自动整理并保存布局" onClick={()=>actions.current?.arrange()}><LayoutGrid size={17}/></button><i/><button title="导航缩略图" aria-label="导航缩略图" aria-pressed={showMap} className={showMap?'cn-active':''} onClick={()=>setShowMap(v=>!v)}><MapIcon size={17}/></button><button title="关系名称" aria-label="显示关系名称" aria-pressed={showLabels} className={showLabels?'cn-active':''} onClick={()=>setShowLabels(v=>!v)}><SlidersHorizontal size={17}/></button></div></>}
      {selection?.tradeRecord?<TradeInspector key={`${sessionId}:${selection.id}`} node={selection} sessionId={sessionId} workspaceId={state.workspaceId} onClose={()=>setSelectedId(null)} onAsk={onAsk} onRefresh={()=>void load()}/>:selection&&<Inspector node={selection} state={state} busy={busy} onClose={()=>setSelectedId(null)} onAsk={onAsk} onAction={openReview} onFocus={()=>{setView('all');setFocusId(null);requestAnimationFrame(()=>setFocusId(selection.id));}} onArtifact={setArtifact}/>}
      {selectedEdge&&!panel&&<RelationshipInspector edge={selectedEdge} graph={graph} state={state} busy={busy} onClose={()=>setSelectedEdgeId(null)} onAsk={onAsk} onAction={openReview}/>}
      {panel==='members'&&<MembersPanel state={state} onClose={()=>setPanel(null)} onAsk={onAsk} onSelect={select}/>}
      {panel==='activity'&&<ActivityPanel state={state} onClose={()=>setPanel(null)} onSelect={selectEvent}/>}
      <div className="cn-notices">{error&&!loading&&<Message type="error" onDismiss={()=>setError(null)}>{error}</Message>}{toast&&<Message onDismiss={()=>setToast(null)}>{toast}</Message>}</div>
    </div>
    <footer className="cn-footer"><button onClick={()=>{setPanel(panel==='activity'?null:'activity');setSelectedId(null);}} className={panel==='activity'?'cn-active':''}><Activity size={14}/><span>协作动态</span>{running>0&&<b>{running} 项进行中</b>}</button><span className={`cn-layout-state${layoutStatus==='error'?' cn-danger-text':''}`}>{layoutStatus==='saving'?<LoaderCircle size={12} className="cn-spin"/>:layoutStatus==='error'?<AlertCircle size={12}/>:<Check size={12}/>}<span>{loading?'读取中':!state.workspaceId?'未连接':layoutStatus==='saving'?'布局保存中':layoutStatus==='error'?'布局未保存':'已同步'}</span>{graph?.nodes.length>0&&<small>{graph.nodes.length} 个节点 · {graph.edges.length} 条关系</small>}</span></footer>
    {workbenchOpen&&<BusinessWorkbench key={`${sessionId}:${state.workspaceId}:${state.projectId}`} state={state} sessionId={sessionId} onClose={()=>setWorkbenchOpen(false)} onChanged={projectId=>load({projectId})} onMandate={id=>{setWorkbenchOpen(false);setMandatesOpen(id);}} onWork={id=>{setWorkbenchOpen(false);select(`service_order:${id}`);setView('all');}} onArtifact={d=>{setWorkbenchOpen(false);setArtifact(d);}} onAsk={onAsk} promptPending={promptPending} active={active}/>}
    {mandatesOpen&&<Mandates key={`${sessionId}:${state.workspaceId}`} state={state} sessionId={sessionId} initialId={typeof mandatesOpen==='string'?mandatesOpen:null} onClose={()=>setMandatesOpen(false)} onChanged={projectId=>load({projectId})}/>}
    {review&&<ReviewDialog review={review} onClose={()=>{if(!busy)setReview(null);}} onConfirm={confirm} onReload={reloadReview} busy={busy}/>}
    {credential&&<CredentialDialog credential={credential} onClose={()=>setCredential(null)} onError={onError}/>}
    {artifact&&<ArtifactDialog key={`${sessionId}:${state.projectId}:${artifact.id}`} artifact={artifact} sessionId={sessionId} projectId={state.projectId} onClose={()=>setArtifact(null)}/>}
    {budgetOpen&&<BudgetDialog project={project} busy={busy} error={error} onClose={()=>setBudgetOpen(false)} onSave={async payload=>{try{await mutate('set_budget',payload);setBudgetOpen(false);setToast('项目预算已更新。');}catch{}}}/>}
  </section>;
}
