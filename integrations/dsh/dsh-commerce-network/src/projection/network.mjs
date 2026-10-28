import { buildSalesGraph } from './graph.mjs';

/**
 * Commerce Network v0.5: a read-only, source-backed projection of independent
 * business parties, third-party agent services and delegated work orders.
 *
 * SECURITY: workspace.commerceNetwork MUST be a server-authenticated,
 * project-scoped, field-redacted projection. Client project IDs and filters do
 * not provide tenant isolation. No record here grants authority to dispatch.
 */
export const COMMERCE_NODE_KINDS = Object.freeze(['factory', 'distributor', 'personal_agent', 'service_order', 'business_mandate']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const validNodeId = value => {
  if (typeof value !== 'string') return false;
  const separator = value.indexOf(':');
  // The kind is not part of the record ID's 128-character limit. Split only
  // once: record IDs may themselves contain colons. Sales/market IDs retain
  // their own projection contract in buildSalesGraph.
  return separator > 0 && COMMERCE_NODE_KINDS.includes(value.slice(0, separator)) && validId(value.slice(separator + 1));
};
const objects = x => Array.isArray(x) ? x.filter(v => v && typeof v === 'object' && !Array.isArray(v)) : [];
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback;
const sourced = (record, stamp = 'verifiedAt') => validId(record.verificationReceiptId) && typeof record[stamp] === 'string' && Boolean(record[stamp].trim());
const stable = rows => [...rows].sort((a,b)=>a.id.localeCompare(b.id));
const kindForParty = type => type === 'factory' || type === 'distributor' ? type : null;
const statusForWork = order => {
  const state=order.status;
  if (!['proposed','authorized','queued','claimed','running','delivered','accepted','rejected','cancelled','failed','stop_requested'].includes(state)) return 'unknown';
  if (state === 'proposed' || state === 'cancelled' || state === 'failed') return state;
  if (!validId(order.approvalReceiptId) || !validId(order.grantId) || !validId(order.budgetReservationId)) return 'blocked';
  if (['queued','claimed','running','delivered','accepted','rejected','stop_requested'].includes(state) && !validId(order.dshTaskRef)) return 'blocked';
  if (['claimed','running','delivered','accepted','rejected'].includes(state) && (!validId(order.claimReceiptId) || !validId(order.leaseId))) return 'blocked';
  if (['running','delivered','accepted','rejected'].includes(state) && !validId(order.heartbeatReceiptId)) return 'blocked';
  if (['delivered','accepted','rejected'].includes(state) && (!validId(order.deliveryReceiptId) || !validId(order.deliverableId))) return 'blocked';
  if (state === 'accepted' && (!validId(order.acceptanceReceiptId) || order.reviewerPartyId !== order.requesterPartyId)) return 'blocked';
  if (state === 'rejected' && !validId(order.rejectionReceiptId)) return 'blocked';
  return state;
};

/** Preserves every v0.4 Channel Atlas node ID and layout; adds no fake entities. */
export function buildCommerceGraph(workspace, projectId, savedLayout = null) {
  const graph = buildSalesGraph(workspace, projectId, savedLayout);
  const network = workspace?.commerceNetwork;
  if (!network || network.projectId !== projectId) return graph;

  // Use only project-scoped, redacted registry entries from a trusted API.
  // Missing ownership/grants should cause a backend 403, not a frontend filter.
  const nodes = new Set(graph.nodes.map(n => n.id));
  const edges = new Set(graph.edges.map(e => e.id));
  const layout = savedLayout ?? (Array.isArray(workspace.canvasLayouts) ? workspace.canvasLayouts.find(l => l.projectId === projectId) : null);
  const positions = new Map(objects(layout?.nodes).filter(x => validNodeId(x.id) && Number.isFinite(x.position?.x) && Number.isFinite(x.position?.y))
    .map(x => [x.id, {x:x.position.x,y:x.position.y}]));
  const push = (kind, id, values, fallbackPosition) => {
    const nodeId=`${kind}:${id}`;
    if(nodes.has(nodeId))return false;
    nodes.add(nodeId);
    const persisted=positions.get(nodeId);
    graph.nodes.push({id:nodeId,kind,refId:id,title:values.title,subtitle:values.subtitle,status:values.status,
      info:values.info,evidenceIds:values.evidenceIds??[],position:persisted??fallbackPosition,
      positionSource:persisted?'user':'generated',source:'commerce-network'});
    return true;
  };
  const link=(id,source,target,kind,status)=>{
    if(!nodes.has(source)||!nodes.has(target)||edges.has(id))return;
    edges.add(id); graph.edges.push({id,source,target,kind,status});
  };
  const partyRows=stable(objects(network.parties).filter(p=>p.projectId===projectId&&validId(p.id)));
  const partyMap=new Map(partyRows.map(p=>[p.id,p]));
  const visibleParties=partyRows.filter(p=>kindForParty(p.type));
  visibleParties.forEach((p,i)=>{
    const kind=kindForParty(p.type);
    push(kind,p.id,{title:label(p.displayName,'未核实商业主体'),subtitle:kind==='factory'?'供应商 · 工厂':'海外代理商 / 分销商',
      status:sourced(p)?'verified':'unverified',info:{marketCode:label(p.marketCode,''),identityReceiptPresent:sourced(p)},
      evidenceIds:validId(p.verificationReceiptId)?[p.verificationReceiptId]:[]},
    {x:kind==='factory'?-400:650,y:110+i*285});
  });
  const agents=stable(objects(network.agentServices).filter(a=>a.projectId===projectId&&validId(a.id)&&validId(a.providerPartyId)&&partyMap.has(a.providerPartyId)));
  const agentIds=new Set();
  agents.forEach((a,i)=>{
    agentIds.add(a.id);
    const verified=validId(a.endpointVerificationReceiptId)&&Boolean(a.endpointVerifiedAt);
    push('personal_agent',a.id,{title:label(a.displayName,'未命名第三方 Agent'),subtitle:'独立 Personal AI Worker',
      status:verified?'endpoint_verified':'unverified',info:{protocol:['a2a','pull_gateway','managed'].includes(a.protocol)?a.protocol:'unverified',
        ownerPartyId:a.providerPartyId, skill:label(a.skillLabel,'技能未验证'), skillVerified:validId(a.skillVerificationReceiptId)&&Boolean(a.skillVerifiedAt)},
      evidenceIds:[a.endpointVerificationReceiptId,a.skillVerificationReceiptId].filter(validId)},
    {x:1130,y:110+i*275});
  });
  stable(objects(network.salesAuthorizations).filter(a=>a.projectId===projectId&&validId(a.id))).forEach(a=>{
    if(a.businessTerms)return;
    if(partyMap.get(a.factoryPartyId)?.type!=='factory'||partyMap.get(a.distributorPartyId)?.type!=='distributor'){
      graph.warnings.push({code:'NETWORK_AUTHORIZATION_INVALID_PARTY',recordId:a.id});return;
    }
    const active=a.status==='active'&&validId(a.approvalReceiptId)&&Boolean(a.approvedAt||a.signedAt);
    const revoked=a.status==='revoked';
    link(`mandate:${a.id}`,`factory:${a.factoryPartyId}`,`distributor:${a.distributorPartyId}`,
      active?'sales_authorized':revoked?'sales_revoked':'sales_proposed',active?'active':revoked?'revoked':'pending');
  });
  const orders=stable(objects(network.workOrders).filter(o=>o.projectId===projectId&&validId(o.id)));
  orders.forEach((o,i)=>{
    const requester=partyMap.get(o.requesterPartyId);
    if(!requester||!kindForParty(requester.type)||!agentIds.has(o.agentServiceId)){
      graph.warnings.push({code:'NETWORK_WORK_ORDER_UNRESOLVED',recordId:o.id});return;
    }
    const state=statusForWork(o);
    push('service_order',o.id,{title:label(o.title,'第三方服务委托'),subtitle:'商业任务 · 非自动授权',status:state,
      info:{taskRef:validId(o.dshTaskRef)?o.dshTaskRef:null, deliverableReady:validId(o.deliverableId)&&validId(o.deliveryReceiptId),
        humanAccepted:state==='accepted',stage:state,priceHidden:true},
      evidenceIds:[o.approvalReceiptId,o.deliveryReceiptId,o.acceptanceReceiptId].filter(validId)},
      {x:1500,y:180+i*250});
    const source=`${requester.type}:${o.requesterPartyId}`,order=`service_order:${o.id}`,target=`personal_agent:${o.agentServiceId}`;
    link(`requested:${o.id}`,source,order,'service_requested',state);
    link(`assigned:${o.id}`,order,target,state==='proposed'||state==='blocked'?'service_proposed':'service_delegated',state);
    if(state==='blocked')graph.warnings.push({code:'NETWORK_WORK_ORDER_UNVERIFIED_STATE',recordId:o.id});
  });
  stable(objects(network.salesAuthorizations).filter(a=>a.projectId===projectId&&validId(a.id)&&a.businessTerms)).forEach((a,i)=>{
    push('business_mandate',a.id,{title:label(a.title,'业务委托'),subtitle:`商业条款 · v${a.businessTerms.version}`,status:a.effectiveStatus||a.status,info:{marketCode:a.marketCode,stage:a.scope},evidenceIds:[a.approvalReceiptId].filter(validId)},{x:300,y:-300-i*230});
    const root=`business_mandate:${a.id}`,principal=partyMap.get(a.principalPartyId);
    if(principal)link(`principal:${a.id}`,`${principal.type}:${principal.id}`,root,'business_link',a.status);
    for(const [kind,ids] of [['product',a.productIds],['route',a.routeIds],['service_order',a.workOrderIds]])for(const id of ids||[])link(`business:${a.id}:${kind}:${id}`,root,`${kind}:${id}`,'business_link',a.status);
  });
  graph.nodes.sort((a,b)=>a.id.localeCompare(b.id));
  graph.edges.sort((a,b)=>a.id.localeCompare(b.id));
  // Current Channel Atlas 0.3 backend has not accepted new network node IDs
  // for layout writes. No browser assertion can grant that capability.
  graph.commerceNetwork={revision:Number.isSafeInteger(network.revision)?network.revision:null,
    layoutWriteSupported:network.layoutWriteSupported===true&&network.layoutContractVersion==='commerce-layout-v1',
    partyCount:visibleParties.length,thirdPartyAgentCount:agents.length,workOrderCount:orders.length};
  return graph;
}
