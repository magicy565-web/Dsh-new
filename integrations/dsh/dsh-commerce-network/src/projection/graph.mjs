/**
 * Channel Atlas business graph projection.
 *
 * Business facts come ONLY from the authenticated Workspace API. The canvas
 * stores presentation coordinates but is never the system of record for sales.
 * Every edge is derived from validated relationships, not from drawn lines.
 */
export const SALES_NODE_KINDS = Object.freeze([
  'product', 'market', 'channel', 'worker', 'buyer', 'quote', 'order', 'approval', 'evidence',
]);

const MARKET_NAMES = Object.freeze({
  US: '美国', GB: '英国', UK: '英国', DE: '德国', FR: '法国', AU: '澳大利亚', JP: '日本', CA: '加拿大',
});
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const obj = (value) => value && typeof value === 'object' && !Array.isArray(value);
const arr = (value) => Array.isArray(value) ? value : [];
const string = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const stable = (values) => [...values].sort((a, b) => String(a.id ?? a).localeCompare(String(b.id ?? b)));

function identity(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 180; }
function uid(kind, ref) { return `${kind}:${ref}`; }
function knownMarket(code, markets) {
  const record = arr(markets).find((market) => market.id === code || market.code === code);
  return string(record?.name) || MARKET_NAMES[code] || code;
}
function assetCount(workspace, productId) {
  return arr(workspace.assets).filter((asset) => asset.productId === productId).length;
}
function productInfo(product, workspace) {
  const checks = [Boolean(product.name?.trim()), Boolean(product.sku?.trim()), Boolean(product.description?.trim()), Boolean(product.imageUrl || product.imageAssetId), product.moq != null, Boolean(product.leadTimeDays != null || product.leadTime)];
  return { available: checks.filter(Boolean).length, total: checks.length, assetCount: assetCount(workspace, product.id) };
}
function evidenceRefs(workspace, entity, id) {
  return arr(workspace.evidence).filter((e) => e.entityType === entity && e.entityId === id && identity(e.id)).map((e) => e.id);
}
function authoritativeRun(workspace, routeId) {
  // A configured monitor is not a worker run. Require a concrete task reference
  // and execution evidence before a worker can be shown as running or delivered.
  const jobs = arr(workspace.workerRuns).filter((r) => r.routeId === routeId && identity(r.taskRef) && identity(r.id));
  const run = [...jobs].sort((a,b) => string(b.updatedAt).localeCompare(string(a.updatedAt)))[0];
  if (!run) return null;
  const statuses = new Set(['queued','claimed','running','blocked','failed','completed','cancelled','stop_requested']);
  return { id: run.id, taskRef: run.taskRef, status: statuses.has(run.status) ? run.status : 'unknown', receiptId: identity(run.receiptId) ? run.receiptId : null, updatedAt: string(run.updatedAt) || null };
}
function authoritativeMetrics(workspace, routeId) {
  // A generated plan can never supply commercial results.
  const metrics = arr(workspace.channelMetrics).find((m) => m.routeId === routeId && identity(m.externalSourceId) && identity(m.verifiedAt));
  if (!metrics) return null;
  return { inquiries: Number.isInteger(metrics.inquiries) && metrics.inquiries >= 0 ? metrics.inquiries : null,
    orders: Number.isInteger(metrics.orders) && metrics.orders >= 0 ? metrics.orders : null,
    revenueMinor: Number.isSafeInteger(metrics.revenueMinor) && metrics.revenueMinor >= 0 ? metrics.revenueMinor : null,
    currency: string(metrics.currency) || null, externalSourceId: metrics.externalSourceId, verifiedAt: metrics.verifiedAt };
}

/**
 * Pure conversion from a real, authenticated Channel Atlas workspace to an
 * immutable graph with typed connections and stable layout IDs.
 * No placeholders, fabricated workers, leads, order counts, or success states.
 */
export function buildSalesGraph(workspace, projectId, savedLayout = null) {
  if (!obj(workspace) || !identity(projectId)) throw new TypeError('A valid authenticated workspace and projectId are required');
  const project = arr(workspace.projects).find((p) => p.id === projectId);
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  const products = stable(arr(workspace.products).filter((p) => p.projectId === projectId && identity(p.id)));
  const routes = stable(arr(workspace.routes).filter((r) => r.projectId === projectId && identity(r.id)));
  const allProducts = new Map(products.map((product) => [product.id, product]));
  const layout = savedLayout ?? arr(workspace.canvasLayouts).find((r) => r.projectId === projectId) ?? {};
  const positions = new Map(arr(layout.nodes).filter((p) => identity(p.id) && obj(p.position) && finite(p.position.x) && finite(p.position.y))
    .map((p) => [p.id, { x: p.position.x, y: p.position.y }]));
  const graph = { projectId, projectTitle: string(project.name, '未命名项目'), workspaceRevision: Number.isSafeInteger(workspace.revision) ? workspace.revision : null,
    layoutRevision: Number.isSafeInteger(layout.revision) ? layout.revision : 0,
    viewport: obj(layout.viewport) && finite(layout.viewport.x) && finite(layout.viewport.y) && finite(layout.viewport.zoom) ? {x:layout.viewport.x,y:layout.viewport.y,zoom:layout.viewport.zoom} : null,
    nodes: [], edges: [], warnings: [] };
  const nodeIds = new Set();
  const push = (node) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    const persisted = positions.get(node.id);
    graph.nodes.push({ ...node, position: persisted ?? node.position, positionSource: persisted ? 'user' : 'generated' });
  };
  const edgeIds = new Set();
  const link = (source, target, kind) => {
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    const id = `${source}__${kind}__${target}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    graph.edges.push({ id, source, target, kind });
  };

  products.forEach((product, index) => {
    const info = productInfo(product, workspace);
    push({ id: uid('product', product.id), kind: 'product', refId: product.id,
      title: string(product.name, '未命名产品'), subtitle: string(product.sku) || '未设置 SKU',
      status: product.verifiedAt ? 'verified' : 'unverified',
      imageUrl: string(product.imageUrl) || null, info,
      evidenceIds: evidenceRefs(workspace, 'product', product.id),
      source: string(product.source, 'workspace'),
      position: {x:0, y:index*260+100}, raw: {sku:string(product.sku), description:string(product.description), category:string(product.category)} });
  });
  const marketCodes = [...new Set(routes.map((route) => route.market).filter(identity))].sort();
  const rowForRoute = new Map();
  let nextY = 80;
  marketCodes.forEach((code, mIndex) => {
    const selected = routes.filter((route) => route.market === code);
    push({id:uid('market',code),kind:'market',refId:code,title:knownMarket(code,workspace.markets),subtitle:code,status:'planning',
      info: { channelCount:selected.length }, evidenceIds:evidenceRefs(workspace,'market',code),position:{x:390,y:nextY}});
    selected.forEach((route,i) => rowForRoute.set(route.id,nextY+105+i*270));
    nextY += Math.max(1,selected.length)*270+90;
  });

  routes.forEach((route) => {
    if (!marketCodes.includes(route.market)) graph.warnings.push({code:'MISSING_MARKET',routeId:route.id});
    const routeY = rowForRoute.get(route.id) ?? nextY;
    const channelId = uid('route',route.id); // preserve Channel Atlas v0.3 layout IDs
    const run = authoritativeRun(workspace,route.id);
    const metrics = authoritativeMetrics(workspace,route.id);
    const connected = arr(workspace.channelConnections).some((c) => c.routeId === route.id && c.status === 'connected' && identity(c.externalAccountId) && identity(c.verifiedAt));
    push({ id:channelId,kind:'channel',refId:route.id, title:string(route.name) || string(route.channel) || '未命名渠道',
      subtitle:`${string(route.channel, '待指定平台')} · ${knownMarket(route.market,workspace.markets)}`,
      status:route.status === 'paused' ? 'paused' : connected ? 'connected' : 'not_connected',
      info:{goal:string(route.goal), channel:string(route.channel), market:route.market, productCount:arr(route.productIds).length,
        monitorConfigured:route.monitorEnabled === true, metrics },
      evidenceIds:evidenceRefs(workspace,'route',route.id), position:{x:760,y:routeY} });
    const productIds = new Set(arr(route.productIds).filter(identity));
    for (const productId of productIds) {
      if (!allProducts.has(productId)) { graph.warnings.push({code:'MISSING_PRODUCT',routeId:route.id,productId});continue; }
      link(uid('product',productId),channelId,'listed_in_plan');
    }
    if (nodeIds.has(uid('market',route.market))) link(uid('market',route.market),channelId,'targets_market');
    const workerConfigured = route.monitorEnabled === true || Boolean(route.workerRole || route.workerGoal || route.workerId);
    if (workerConfigured || run) {
      const workerId = uid('worker',route.id);
      push({id:workerId,kind:'worker',refId:route.id,title:string(route.workerRole,'AI Worker 计划'),
        subtitle:run ? `任务 ${run.taskRef}` : '尚未取得执行任务编号',
        status:run?.status ?? (route.monitorEnabled ? 'configured' : 'unconfigured'),
        info:{goal:string(route.workerGoal,route.goal),frequencyHours:finite(route.checkEveryHours)?route.checkEveryHours:null,
          budgetTotalCents:finite(route.budgetTotalCents)?route.budgetTotalCents:null,
          budgetPerRunCents:finite(route.budgetPerRunCents)?route.budgetPerRunCents:null,
          currency:string(route.currency) || null,run},
        evidenceIds:evidenceRefs(workspace,'worker',route.id),position:{x:1120,y:routeY}});
      link(channelId,workerId,'tracked_by');
    }
  });

  const leads = stable(arr(workspace.leads).filter((l) => l.projectId === projectId && identity(l.id) && identity(l.routeId)));
  leads.forEach((lead,index) => {
    const target=uid('route',lead.routeId);
    if (!nodeIds.has(target)) {graph.warnings.push({code:'ORPHAN_LEAD',leadId:lead.id});return;}
    push({id:uid('buyer',lead.id),kind:'buyer',refId:lead.id,title:string(lead.displayName,'待确认买手'),
      subtitle:string(lead.stage,'待核验'),status:lead.verifiedAt ? 'verified' : 'unverified',
      info:{stage:string(lead.stage),source:string(lead.source),nextAction:string(lead.nextAction)},
      evidenceIds:evidenceRefs(workspace,'buyer',lead.id),position:{x:1490,y:index*218+100}});
    link(target,uid('buyer',lead.id),'generated_lead');
  });
  const quotes = stable(arr(workspace.quotes).filter((q) => q.projectId === projectId && identity(q.id) && identity(q.leadId)));
  quotes.forEach((quote,index) => {
    const source=uid('buyer',quote.leadId);
    if (!nodeIds.has(source)) return;
    push({id:uid('quote',quote.id),kind:'quote',refId:quote.id,title:`报价 ${quote.reference || quote.id.slice(0,8)}`,
      subtitle:string(quote.status,'待审批'),status:string(quote.status,'unverified'),
      info:{approvedAt:string(quote.approvedAt)||null,expiresAt:string(quote.expiresAt)||null,priceHidden:true},
      evidenceIds:evidenceRefs(workspace,'quote',quote.id),position:{x:1840,y:index*226+100}});
    link(source,uid('quote',quote.id),'requested_quote');
  });
  const orders = stable(arr(workspace.orders).filter((o) => o.projectId === projectId && identity(o.id) && identity(o.quoteId) && identity(o.externalOrderId)));
  orders.forEach((order,index) => {
    const source=uid('quote',order.quoteId);
    if (!nodeIds.has(source)) return;
    push({id:uid('order',order.id),kind:'order',refId:order.id,title:`订单 ${order.externalOrderId}`,
      subtitle:string(order.status,'待核验'),status:order.verifiedAt ? string(order.status,'verified') : 'unverified',
      info:{externalOrderId:order.externalOrderId,verifiedAt:string(order.verifiedAt)||null},
      evidenceIds:evidenceRefs(workspace,'order',order.id),position:{x:2200,y:index*232+100}});
    link(source,uid('order',order.id),'converted_to_order');
  });
  stable(arr(workspace.approvals).filter((a) => a.projectId === projectId && identity(a.id))).forEach((approval,index) => {
    const owner=identity(approval.routeId)?uid('route',approval.routeId):null;
    push({id:uid('approval',approval.id),kind:'approval',refId:approval.id,title:string(approval.title,'人工审批'),
      subtitle:string(approval.status,'pending'),status:string(approval.status,'pending'),
      info:{scope:string(approval.scope),action:string(approval.action)},
      evidenceIds:evidenceRefs(workspace,'approval',approval.id),position:{x:1130,y:nextY+index*210}});
    if (owner) link(owner,uid('approval',approval.id),'requires_approval');
  });
  stable(arr(workspace.evidence).filter((e) => e.projectId === projectId && identity(e.id))).forEach((evidence,index) => {
    const owner = identity(evidence.routeId) ? uid('route',evidence.routeId) : identity(evidence.productId) ? uid('product',evidence.productId) : null;
    push({id:uid('evidence',evidence.id),kind:'evidence',refId:evidence.id,title:string(evidence.title,'证据资料'),
      subtitle:string(evidence.source,'来源待核验'),status:evidence.verifiedAt ? 'verified' : 'unverified',
      info:{source:string(evidence.source),verifiedAt:string(evidence.verifiedAt)||null,assetId:string(evidence.assetId)||null},
      evidenceIds:[],position:{x:1490,y:nextY+index*185}});
    if (owner) link(owner,uid('evidence',evidence.id),'supported_by');
  });
  return graph;
}

/** Construct a reversible spatial edit with no capability to alter business facts. */
export function makeLayoutPatch(graph, changes, viewport = graph.viewport) {
  if (!obj(graph) || !identity(graph.projectId)) throw new TypeError('Invalid sales graph');
  if (graph.commerceNetwork && graph.commerceNetwork.layoutWriteSupported !== true) throw new Error('NETWORK_LAYOUT_BACKEND_UNAVAILABLE');
  if (!Array.isArray(changes)) throw new TypeError('changes must be an array');
  const allowed = new Set(graph.nodes.map((n) => n.id));
  const positions = new Map(graph.nodes.map((n) => [n.id,{...n.position}]));
  for (const c of changes) {
    if (!allowed.has(c?.id) || !finite(c?.x) || !finite(c?.y) || Math.abs(c.x)>1e6 || Math.abs(c.y)>1e6) throw new TypeError('Invalid layout change');
    positions.set(c.id,{x:c.x,y:c.y});
  }
  if (viewport && (!finite(viewport.x)||!finite(viewport.y)||!finite(viewport.zoom)||viewport.zoom<0.1||viewport.zoom>4)) throw new TypeError('Invalid viewport');
  return {projectId:graph.projectId,expectedLayoutRevision:graph.layoutRevision,
    nodes:[...positions].map(([id,position])=>({id,position})),
    viewport:viewport?{x:viewport.x,y:viewport.y,zoom:viewport.zoom}:null};
}

/** Never trust a visual edge as authority for sending data, money or messages. */
export function getCanvasNodeContext(graph, nodeId) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error('NODE_NOT_FOUND');
  const touching = graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
  return {projectId:graph.projectId,nodeId:node.id,kind:node.kind,refId:node.refId,
    title:node.title,workspaceRevision:graph.workspaceRevision,layoutRevision:graph.layoutRevision,
    relationships:touching.map(({kind,source,target})=>({kind,source,target}))};
}
