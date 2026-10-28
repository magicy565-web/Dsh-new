import React,{useEffect,useRef,useState} from 'react';
import {X,ArrowUpRight,FileText,ShieldCheck,Clock3,Copy,Check,Download,KeyRound,ChevronRight,AlertCircle,Link2} from 'lucide-react';
import {KindIcon,Status} from './NodeCard.jsx';
import {KINDS,ACTION_LABELS,EDGE_LABELS,money,timestamp,selectedRecord,eventLabel} from './model.mjs';
import {safeUrl,callApi,unwrap,errorText} from './api.mjs';

export function Dialog({title,children,onClose,footer,wide=false}) {
  const ref=useRef(null),closeRef=useRef(onClose);
  closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement;
    const focusable=()=>[...ref.current?.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')||[]].filter(el=>!el.disabled);
    focusable()[0]?.focus();
    const key=event=>{
      if(event.key==='Escape'){event.preventDefault();closeRef.current();}
      if(event.key==='Tab'){
        const items=focusable(),first=items[0],last=items[items.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    ref.current?.addEventListener('keydown',key);
    return ()=>{ref.current?.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className="cn-modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={ref} className={`cn-modal${wide?' cn-modal-wide':''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="cn-icon-button" aria-label="关闭" onClick={onClose}><X size={18}/></button></header><div className="cn-modal-body">{children}</div>{footer&&<footer>{footer}</footer>}</section></div>;
}

function Detail({label,value,mono=false}) {return <div className="cn-detail"><span>{label}</span><strong className={mono?'cn-mono':''}>{value===null||value===undefined||value===''?'待确认':String(value)}</strong></div>;}
function TagList({items,labels={}}) {return <div className="cn-tags">{items?.length?items.map((v,i)=><span key={`${v}:${i}`} title={String(v)}>{labels[v]||String(v)}</span>):<span>公开信息研究</span>}</div>;}
function downloadJson(value,name) {const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name.replace(/[^A-Za-z0-9._-]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function CredentialDialog({credential,onClose,onError}) {
  const [copied,setCopied]=useState(false);
  const [copyError,setCopyError]=useState(null);
  const gateway=new URL(credential.gatewayPath||'/commerce-worker-api',window.location.origin).href;
  const local=window.location.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
  const config={baseUrl:window.location.origin,token:credential.token,...local?{allowLocalHttp:true}:{},protocol:'pull_gateway',agentServiceId:credential.agentServiceId};
  const copy=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(config,null,2));setCopied(true);setCopyError(null);}catch{setCopyError('浏览器未允许复制，请手动复制下面的一次性凭据。');}};
  return <Dialog title="连接 Personal AI Worker" onClose={onClose} footer={<><button className="cn-button" onClick={onClose}>我已保存，关闭</button><button className="cn-button cn-primary" onClick={copy}>{copied?<Check size={15}/>:<Copy size={15}/>}复制连接配置</button></>}>
    <div className="cn-modal-symbol"><KeyRound size={28}/></div><h3>凭据只显示这一次</h3><p>将连接配置交给这位服务商的 Personal Agent。连接成功后，画布会更新为「已连接」。</p>
    <div className="cn-detail-box"><Detail label="Agent" value={credential.agentServiceId} mono/><Detail label="服务地址" value={gateway} mono/><Detail label="有效期" value={credential.expiresAt?timestamp(credential.expiresAt):null}/></div>
    <label className="cn-field"><span>受限访问凭据</span><input readOnly value={credential.token} onFocus={e=>e.target.select()} spellCheck={false} autoComplete="off" className="cn-mono" aria-label="一次性 Agent 访问凭据"/></label>
    {copyError&&<p role="alert" className="cn-danger-text">{copyError}</p>}
    <p className="cn-field-note">关闭后不会保存在浏览器。此凭据仅允许该 Agent 连接并领取已授权给自己的任务。</p>
    {local&&<p className="cn-field-note">当前服务地址仅供本机使用。跨设备接入时，请为服务商提供可访问的 HTTPS 地址。</p>}
  </Dialog>;
}

export function Inspector({node,state,onClose,onAsk,onAction,busy,onFocus,onArtifact}) {
  const record=selectedRecord(state,node)||{},info=node.info||{};
  const events=(state.events||[]).filter(e=>e.entityId===node.refId||e.orderId===node.refId||e.agentServiceId===node.refId).slice(-5).reverse();
  const artifacts=(state.deliverables||[]).filter(d=>d.orderId===node.refId||d.workOrderId===node.refId);
  const dependencies=(record.dependsOn||[]).map(id=>state.commerceNetwork?.workOrders?.find(o=>o.id===id)).filter(Boolean);
  const waitingOnDependencies=dependencies.some(o=>o.status!=='accepted');
  const title=KINDS[node.kind]||node.kind;
  return <aside className="cn-inspector" aria-label={`${title}详情`}>
    <header><span className={`cn-inspector-icon cn-kind-${node.kind}`}><KindIcon kind={node.kind}/></span><span>{title}</span><button className="cn-icon-button" onClick={onClose} aria-label="关闭节点详情"><X size={17}/></button></header>
    <div className="cn-inspector-scroll"><h2>{node.title}</h2><Status value={node.status}/>
      <div className="cn-inspector-actions"><button className="cn-button cn-soft" onClick={()=>onAsk(node)}><ArrowUpRight size={14}/>在对话中处理</button><button className="cn-icon-button cn-bordered" onClick={onFocus} title="查看相关节点" aria-label="查看相关节点"><Link2 size={15}/></button></div>
      {node.kind==='service_order'?<>
        <section><h3>服务范围</h3><p>{record.brief||info.brief||'任务说明尚未补全。请在对话中明确预期交付。'}</p><Detail label="本次费用上限" value={money(record.maximumMinor,record.currency)}/><Detail label="原生任务" value={record.dshTaskRef} mono/><Detail label="最后更新" value={record.updatedAt?timestamp(record.updatedAt):null}/></section>
        <section><h3>允许的服务</h3><TagList items={record.allowedActions} labels={ACTION_LABELS}/><h3>可访问的资料</h3><TagList items={record.allowedResourceRefs}/></section>
        {dependencies.length>0&&<section><h3>等待前序交付验收</h3>{dependencies.map(order=><div className="cn-dependency-row" key={order.id}><span>{order.title}</span><Status value={order.status}/></div>)}</section>}
        {node.status==='proposed'&&<div className="cn-decision-card"><ShieldCheck size={20}/><h3>等待你授权</h3><p>核对任务范围、服务商和费用上限后，这项委托才可进入原生调度。</p><button className="cn-button cn-primary" disabled={busy} onClick={()=>onAction('approve_order',record)}>审核并授权</button></div>}
        {node.status==='authorized'&&<div className="cn-decision-card"><Clock3 size={20}/><h3>{waitingOnDependencies?'已授权，等待前序验收':'已授权，等待调度'}</h3><p>{waitingOnDependencies?'所有前序委托完成验收后，才能启动这一步。':'由当前会话创建原生执行任务。'}</p><button className="cn-button cn-primary" disabled={waitingOnDependencies} onClick={()=>onAsk(node,'请核验这项委托的批准记录和 Agent 连接，然后通过原生 DSH 工具调度执行。')}>交给当前 Assistant 调度</button></div>}
        {artifacts.length>0&&<section><h3>交付物 · {artifacts.length}</h3>{artifacts.map((a,i)=><button className="cn-artifact" key={a.id||i} onClick={()=>onArtifact(a)}><FileText size={19}/><span><b>{a.title||a.name||a.id||'任务交付'}</b><small>{a.createdAt?timestamp(a.createdAt):a.sha256?`SHA-256 ${a.sha256.slice(0,12)}…`:'查看交付内容与凭据'}</small></span><ChevronRight size={15}/></button>)}</section>}
        {node.status==='delivered'&&<div className="cn-decision-card"><ClipboardCheckIcon/><h3>交付已到，等待验收</h3><p>请核对实际交付内容和来源，再决定接收或退回。</p><div className="cn-two-buttons"><button className="cn-button" disabled={busy} onClick={()=>onAction('reject_delivery',record)}>拒收交付</button><button className="cn-button cn-primary" disabled={busy} onClick={()=>onAction('accept_delivery',record)}>验收交付</button></div></div>}
        {['proposed','authorized','queued','claimed','running'].includes(node.status)&&<button className="cn-text-button cn-danger-text" disabled={busy} onClick={()=>onAction('cancel_order',record)}>取消这项委托</button>}
        {node.status==='failed'&&record.stopUnconfirmed&&<div className="cn-decision-card"><AlertCircle size={20}/><h3>外部执行需要核对</h3><p>{record.stopAcknowledgedAt?'已收到外部停止回执。核对后可释放本项委托的费用预留。':'执行租约已到期，尚未收到停止回执。费用预留保持冻结，避免重复委托。'}</p>{record.stopAcknowledgedAt&&<button className="cn-button" disabled={busy} onClick={()=>onAction('resolve_failed_order',record)}>核对并释放预留</button>}</div>}
      </>:node.kind==='personal_agent'?<>
        <section><h3>独立服务商</h3><Detail label="提供者" value={info.providerName}/><Detail label="接入方式" value="Pull Gateway"/><Detail label="首次连接" value={record.endpointVerifiedAt?timestamp(record.endpointVerifiedAt):null}/><Detail label="最近心跳" value={record.lastSeenAt?timestamp(record.lastSeenAt):record.lastHeartbeatAt?timestamp(record.lastHeartbeatAt):null}/></section>
        <section><h3>登记能力</h3><TagList items={record.skills||info.skills} labels={ACTION_LABELS}/><p className="cn-field-note">登记能力由服务商提供；实际交付需逐项验收。</p></section>
        {node.status!=='revoked'&&<section><h3>连接与访问</h3><p>{['unverified','credential_issued'].includes(node.status)?'为这位 Agent 创建受限连接凭据，完成握手后即可承接已授权的任务。':'此 Agent 只能领取分配给自己的委托。更新凭据将撤销此前的凭据。'}</p><button className="cn-button cn-primary" disabled={busy} onClick={()=>onAction('issue_agent_credential',record)}><KeyRound size={15}/>{node.status==='endpoint_verified'?'更新连接凭据':'创建连接凭据'}</button><button className="cn-text-button cn-danger-text" disabled={busy} onClick={()=>onAction('revoke_agent',record)}>撤销 Agent 访问</button></section>}
      </>:<>
        <section><h3>业务资料</h3><p>{node.raw?.description||node.subtitle||'在当前会话中补全业务资料。'}</p>{Object.entries(info).filter(([k,v])=>['marketCode','stage','channel','source','verifiedAt','externalOrderId','assetCount'].includes(k)&&v!==undefined&&v!==null).map(([k,v])=><Detail key={k} label={({marketCode:'市场',stage:'业务阶段',channel:'渠道',source:'来源',verifiedAt:'核验时间',externalOrderId:'订单号',assetCount:'附件数量'})[k]} value={v}/>)}</section>
        {['factory','distributor'].includes(node.kind)&&<button className="cn-button cn-primary" onClick={()=>onAsk(node,'为这个商业主体规划一项第三方 Personal AI Worker 服务委托。先核对已有产品和可用服务商，生成待我审批的草案。')}>规划服务委托 <ArrowUpRight size={15}/></button>}
      </>}
      <section><h3>证据与记录</h3>{node.evidenceIds?.length?<div className="cn-receipts">{node.evidenceIds.map(id=><div key={id}><ShieldCheck size={13}/><code title={id}>{id}</code></div>)}</div>:<p className="cn-field-note">尚无核验凭据。</p>}{events.length>0&&<div className="cn-mini-timeline">{events.map((e,i)=><div key={e.id||i}><i/><span>{eventLabel(e)}<small>{timestamp(e.at||e.createdAt)}</small></span></div>)}</div>}</section>
      <div className="cn-record-id"><span>业务引用</span><code>{node.refId}</code></div>
    </div>
  </aside>;
}
function ClipboardCheckIcon(){return <Check size={21}/>;}

export function RelationshipInspector({edge,graph,state,onClose,onAsk,onAction,busy}) {
  const source=graph.nodes.find(n=>n.id===edge.source),target=graph.nodes.find(n=>n.id===edge.target);
  const mandate=edge.id.startsWith('mandate:')?state.commerceNetwork?.salesAuthorizations?.find(m=>`mandate:${m.id}`===edge.id):null;
  const labels=mandate?.productIds?.map(id=>state.products?.find(p=>p.id===id)?.name||id)||[];
  return <aside className="cn-inspector" aria-label="业务关系详情"><header><Link2 size={17}/><span>业务关系</span><button className="cn-icon-button" aria-label="关闭关系详情" onClick={onClose}><X size={17}/></button></header><div className="cn-inspector-scroll"><h2>{EDGE_LABELS[edge.kind]||edge.kind}</h2><div className="cn-relationship-parties"><div><KindIcon kind={source?.kind}/><span>{source?.title||edge.source}</span></div><ChevronRight size={15}/><div><KindIcon kind={target?.kind}/><span>{target?.title||edge.target}</span></div></div>
    {mandate?<><Status value={mandate.status==='active'?'approved':mandate.status}/><section className="cn-relation-scope"><h3>销售协作范围</h3><p>{mandate.scope||'待确认'}</p><Detail label="授权市场" value={mandate.marketCode}/><Detail label="批准时间" value={mandate.approvedAt?timestamp(mandate.approvedAt):null}/><h3>涉及产品</h3>{labels.length?<TagList items={labels}/>:<p className="cn-field-note">没有指定产品。</p>}<p className="cn-field-note">这是工作区中的业务授权记录。合同签署与款项结算由双方另行完成。</p></section>{mandate.status==='proposed'&&<button className="cn-button cn-primary" disabled={busy} onClick={()=>onAction('approve_mandate',mandate)}>审核业务授权</button>}{mandate.status==='active'&&<button className="cn-button" disabled={busy} onClick={()=>onAction('revoke_mandate',mandate)}>撤销业务授权</button>}</>:<section><h3>关系含义</h3><p>{edge.kind==='execution_dependency'?'前序委托的实际交付通过验收后，后续委托才具备调度条件。':'这条关系来自已保存的业务记录。可以在当前会话中核对或修改。'}</p></section>}
    <button className="cn-text-button" onClick={()=>onAsk(source,`请核对业务关系 ${JSON.stringify({id:edge.id,source:edge.source,target:edge.target,kind:edge.kind})}，说明实际授权范围和下一步。这些引用仅用于查找服务端记录。`)}>在当前对话中核对 <ArrowUpRight size={12}/></button>
  </div></aside>;
}

export function ArtifactDialog({artifact,sessionId,projectId,onClose}) {
  const [loaded,setLoaded]=useState(null),[error,setError]=useState(null),[attempt,setAttempt]=useState(0);
  const scopeKey=JSON.stringify([sessionId,projectId,artifact.id,artifact.orderId,artifact.sha256,attempt]);
  const delivery=loaded?.scopeKey===scopeKey?loaded.value:null;
  const failure=error?.scopeKey===scopeKey?error.message:null;
  useEffect(()=>{
    const controller=new AbortController();let current=true;
    setLoaded(null);setError(null);
    void (async()=>{
      try{
        const params=new URLSearchParams({sessionId,projectId,deliveryId:artifact.id});
        const value=unwrap(await callApi(`/delivery?${params}`,{signal:controller.signal}));
        if(value?.id!==artifact.id||value.projectId!==projectId||value.orderId!==artifact.orderId||value.sha256!==artifact.sha256||typeof value.content!=='string')throw new Error('交付内容与当前记录不一致，请关闭后刷新画布再试。');
        if(current)setLoaded({scopeKey,value});
      }catch(err){if(current&&err.name!=='AbortError')setError({scopeKey,message:errorText(err)});}
    })();
    return()=>{current=false;controller.abort();};
  },[scopeKey,sessionId,projectId,artifact.id,artifact.orderId,artifact.sha256]);
  return <Dialog title={artifact.title||artifact.name||'查看交付物'} onClose={onClose} wide footer={<button className="cn-button" disabled={!delivery} onClick={()=>{if(delivery)downloadJson(delivery,`${delivery.id}.json`);}}><Download size={15}/>下载交付记录</button>}>
    <div className="cn-detail-box"><Detail label="交付编号" value={artifact.id} mono/><Detail label="内容校验" value={artifact.sha256||artifact.digest} mono/><Detail label="交付时间" value={artifact.createdAt?timestamp(artifact.createdAt):null}/></div>
    {!delivery&&!failure&&<p role="status">正在读取交付内容…</p>}
    {failure&&<div><p role="alert" className="cn-danger-text">{failure}</p><button className="cn-button" onClick={()=>setAttempt(value=>value+1)}>重新读取交付内容</button></div>}
    {delivery&&<pre className="cn-artifact-content">{delivery.content}</pre>}
    {delivery?.sourceUrls?.length>0&&<section className="cn-source-links"><h4>服务商提交的来源</h4>{delivery.sourceUrls.filter(url=>safeUrl(url)).map((url,i)=><a key={i} href={safeUrl(url)} target="_blank" rel="noopener noreferrer">{url}</a>)}</section>}
  </Dialog>;
}

export function ReviewDialog({review,onClose,onConfirm,onReload,busy}) {
  const [reason,setReason]=useState('');
  const record=review.record;
  const labels={approve_order:'授权服务委托',accept_delivery:'验收这次交付',reject_delivery:'拒收这次交付',cancel_order:'取消服务委托',revoke_agent:'撤销 Agent 访问',issue_agent_credential:'创建新的连接凭据',approve_mandate:'确认业务授权',revoke_mandate:'撤销业务授权',resolve_failed_order:'核对停止并释放预留'};
  const descriptions={approve_order:'核对以下范围。授权后，当前 Assistant 可以通过 DSH 创建执行任务。',accept_delivery:'确认你已检查实际交付、来源与任务要求。验收不会自动触发付款。',reject_delivery:'写明未达到委托要求的内容。这项委托将结束；进一步修改需要创建新委托。',cancel_order:'正在执行的任务将请求停止。只有取得停止回执后才会显示为已取消。',revoke_agent:'撤销后，此 Agent 不能再领取任务或访问委托资料。正在执行的委托会按撤销规则处理。',issue_agent_credential:'新凭据只显示一次。已有凭据将失效，服务商需要重新连接。',approve_mandate:'确认下面的销售协作范围。此操作仅批准工作区业务授权，不代表双方签署法律合同。',revoke_mandate:'撤销后，画布会保留授权历史，并将这条协作关系标为已撤销。',resolve_failed_order:'已取得服务商的停止回执。请记录核对结论，确认释放仍被占用的费用预留。'};
  return <Dialog title={labels[review.command]} onClose={onClose} footer={<><button className="cn-button" onClick={onClose} disabled={busy}>返回</button><button className={`cn-button ${['cancel_order','revoke_agent','revoke_mandate'].includes(review.command)?'cn-danger':'cn-primary'}`} disabled={busy||review.loading||review.loadFailed||(review.command==='approve_order'&&!record.reviewDigest)||(['reject_delivery','resolve_failed_order'].includes(review.command)&&!reason.trim())} onClick={()=>onConfirm(review.command,record,reason)}>{busy?'正在提交…':review.loading?'正在读取授权快照…':review.command==='approve_order'?'确认授权':review.command==='accept_delivery'?'确认验收':review.command==='issue_agent_credential'?'生成凭据':'确认'}</button></>}>
    <h3>{record.title||record.displayName}</h3><p>{descriptions[review.command]}</p>
    {review.error&&<div><p role="alert" className="cn-danger-text">{review.error}</p><button className="cn-button" onClick={onReload} disabled={busy||review.loading}>重新读取并核对</button></div>}
    {['approve_order','accept_delivery'].includes(review.command)&&<><div className="cn-detail-box"><Detail label="费用上限" value={money(record.maximumMinor,record.currency)}/><Detail label="服务商 Agent" value={record.agentServiceId} mono/></div>{record.brief&&<p>{record.brief}</p>}<h4>授权服务</h4><TagList items={record.allowedActions} labels={ACTION_LABELS}/><h4>资料范围</h4><TagList items={record.allowedResourceRefs}/></>}
    {review.command==='approve_order'&&<div className="cn-sharing-review"><h4>将分享给服务商的实际资料</h4>{review.loading?<p>正在读取当前资料版本…</p>:review.loadFailed?<p role="alert">授权快照读取失败。请返回后重试。</p>:record.resources?.length?record.resources.map((resource,i)=><details open key={resource.ref||i}><summary>{resource.ref} · {resource.version||'当前版本'}</summary><pre className="cn-artifact-content">{typeof resource.content==='string'?resource.content:JSON.stringify(resource.content,null,2)}</pre><p className="cn-field-note">内容摘要：{resource.sha256}</p></details>):<p>本项委托不共享工作区资料，仅允许上述公开信息服务。</p>}</div>}
    {['approve_mandate','revoke_mandate'].includes(review.command)&&<div className="cn-detail-box"><Detail label="工厂" value={record.factoryPartyId}/><Detail label="代理商" value={record.distributorPartyId}/><Detail label="市场" value={record.marketCode}/><Detail label="业务范围" value={record.scope}/></div>}
    {['reject_delivery','resolve_failed_order'].includes(review.command)&&<label className="cn-field"><span>{review.command==='reject_delivery'?'拒收原因':'核对结论'}</span><textarea value={reason} onChange={e=>setReason(e.target.value)} rows={4} maxLength={2000} placeholder={review.command==='reject_delivery'?'哪些内容未达到委托要求？':'实际停止情况与费用核对结果'}/></label>}
  </Dialog>;
}
