// The one rule for which node IDs may carry a saved position.
// The service uses it to validate writes and the browser uses it to decide what
// can be dragged and persisted, so the two can never disagree.

const present = (value) => typeof value === 'string' && value.length > 0;

/** A route owns a worker node when the plan configures one (same test as the sales projection). */
export const routeHasWorker = (route) => route?.monitorEnabled === true || Boolean(route?.workerRole || route?.workerGoal || route?.workerId);

export function layoutNodeIds({ products = [], routes = [], parties = [], agents = [], workOrders = [], mandates = [], trade = null } = {}) {
  const ids = new Set();
  for (const product of products) if (present(product?.id)) ids.add(`product:${product.id}`);
  for (const route of routes) {
    if (!present(route?.id)) continue;
    ids.add(`route:${route.id}`);
    if (present(route.market)) ids.add(`market:${route.market}`);
    if (routeHasWorker(route)) ids.add(`worker:${route.id}`);
  }
  for (const party of parties) if (present(party?.id) && (party.type === 'factory' || party.type === 'distributor')) ids.add(`${party.type}:${party.id}`);
  for (const agent of agents) if (present(agent?.id)) ids.add(`personal_agent:${agent.id}`);
  for (const order of workOrders) if (present(order?.id)) ids.add(`service_order:${order.id}`);
  for (const mandate of mandates) if (present(mandate?.id) && mandate.businessTerms) ids.add(`business_mandate:${mandate.id}`);
  if (trade) {
    const groups = [['rfq', trade.rfqs], ['quote', trade.quotes], ['buyer', trade.buyers], ['erp_order', trade.orders], ['sample', trade.samples]];
    for (const [kind, rows] of groups) for (const row of Array.isArray(rows) ? rows : []) if (present(row?.id)) ids.add(`${kind}:${row.id}`);
  }
  return ids;
}

/** Same sets as the service, built from the browser's workspace state. */
export function layoutNodeIdsFromState(state) {
  const projectId = state?.projectId;
  const mine = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row?.projectId === projectId);
  const network = state?.commerceNetwork || {};
  return layoutNodeIds({
    products: mine(state?.products),
    routes: mine(state?.routes),
    parties: mine(network.parties),
    agents: mine(network.agentServices),
    workOrders: mine(network.workOrders),
    mandates: mine(network.salesAuthorizations),
    trade: state?.trade && state.trade.projectId === projectId ? state.trade : null,
  });
}
