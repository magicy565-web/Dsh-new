import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { makeWorkOrderProposal, applyWorkOrderEvent } from '@workspace-agent/domain-commerce-network';

export class CommerceError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const fail = (code, message, status = 400) => { throw new CommerceError(code, message, status); };
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const ACTIONS = ['public_web_research', 'read_granted_product_context', 'draft_outreach', 'classify_opted_in_replies', 'summarize_rfq'];
const TERMINAL = new Set(['accepted', 'rejected', 'cancelled', 'failed']);
const LIVE = new Set(['claimed', 'running', 'stop_requested']);
const MAX_LEASE = 120_000;
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k])]));
  return value;
}
export function assertKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INPUT', 'Expected a JSON object.');
  if (Object.keys(value).some(k => !allowed.includes(k))) fail('INPUT', 'Unsupported request fields.');
}
const identifier = (value, field = 'id') => { if (typeof value !== 'string' || !ID.test(value)) fail('INPUT', `Invalid ${field}.`); return value; };
function text(value, field, maximum = 200, required = true) {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) fail('INPUT', `Invalid ${field}.`);
  return value.trim();
}
const integer = (value, field, min = 0, max = 100_000_000) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail('INPUT', `Invalid ${field}.`); return value; };
const array = (value, field, max = 100) => { if (!Array.isArray(value) || value.length > max) fail('INPUT', `Invalid ${field}.`); return value; };
const generated = prefix => `${prefix}_${randomUUID()}`;
const publicAgent = a => ({ ...a });

export function createCommerceService({ store, registry, clock = Date.now, resourceAdapter = null }) {
  let disposed = false;
  const workerWindows = new Map();
  const now = () => clock();
  const iso = () => new Date(now()).toISOString();
  const alive = signal => { if (disposed) fail('UNAVAILABLE', 'Commerce plugin has been unloaded.', 503); signal?.throwIfAborted(); };
  function workspace(workspaceId) {
    alive();
    if (!UUID.test(workspaceId ?? '') || !registry.get(workspaceId)) fail('WORKSPACE_REQUIRED', 'Use a current native DSH workspace.', 403);
    return workspaceId;
  }
  function sessionScope(sessionId) {
    alive();
    // SessionId is an opaque branded string in the official SDK. Web creates
    // `session-${randomUUID()}` (agent.js create), while SessionStore can mint
    // session-<counter>. Shape limits input; registry membership is authority.
    if (typeof sessionId !== 'string' || !ID.test(sessionId)) fail('SESSION_REQUIRED', 'Use the current native DSH conversation.', 403);
    const found = registry.list().find(w => w.sessionIds.includes(sessionId));
    if (!found) fail('SESSION_REQUIRED', 'The conversation is not attached to a native workspace.', 403);
    return { workspaceId: workspace(found.id), sessionId };
  }
  function browser(sessionId) { return { ...sessionScope(sessionId), actor: 'dsh-browser-admin', kind: 'owner' }; }
  function executionScope(execution) {
    alive(execution?.signal);
    const scope = sessionScope(execution?.agent?.session?.id);
    if (typeof execution?.callId !== 'string' || !execution.callId || execution.callId.length > 500) fail('TOOL_IDENTITY_REQUIRED', 'A native DSH tool-call identity is required.', 403);
    return { ...scope, actor: `dsh-agent:${scope.sessionId}`, kind: 'tool', callId: execution.callId, signal: execution.signal };
  }
  function checkScope(scope) {
    alive(scope.signal);
    workspace(scope.workspaceId);
    if (scope.sessionId && sessionScope(scope.sessionId).workspaceId !== scope.workspaceId) fail('SCOPE_CHANGED', 'Native conversation workspace changed.', 409);
  }
  function project(state, projectId) {
    identifier(projectId, 'projectId');
    const value = state.projects.find(p => p.id === projectId);
    if (!value) fail('PROJECT_NOT_FOUND', 'This project is not in the current workspace.', 404);
    return value;
  }
  function agent(state, projectId, agentId) {
    const value = state.agents.find(a => a.id === agentId && a.projectId === projectId);
    if (!value) fail('AGENT_NOT_FOUND', 'Agent service is not in this project.', 404);
    return value;
  }
  function order(state, projectId, orderId) {
    const value = state.workOrders.find(o => o.id === orderId && o.projectId === projectId);
    if (!value) fail('ORDER_NOT_FOUND', 'Work order is not in this project.', 404);
    return value;
  }
  function log(scope, type, entityId, summary) {
    store.audit(scope.workspaceId, { id: generated('evt'), actor: scope.actor, type, entityId, at: iso(), summary });
  }
  function transition(state, current, kind, fields, auth) {
    let next;
    try { next = applyWorkOrderEvent(current, { eventId: generated('event'), kind, ...fields }, { now: now(), ...auth }); }
    catch (error) { if (/^[A-Z_]+$/.test(error.message)) fail(error.message, 'Work order transition is not permitted in its current state.', 409); throw error; }
    next.updatedAt = iso();
    state.workOrders[state.workOrders.findIndex(o => o.id === current.id)] = next;
    return next;
  }
  const host = { role: 'host', actorPartyId: 'dsh-host' };
  function expire(state, scope) {
    let changed = false;
    for (const current of [...state.workOrders]) {
      if (TERMINAL.has(current.status) || current.status === 'delivered') continue;
      const jobExpired = Date.parse(current.expiresAt) <= now();
      const leaseExpired = LIVE.has(current.status) && Date.parse(current.leaseExpiresAt ?? '') <= now();
      if (!jobExpired && !leaseExpired) continue;
      if (['proposed', 'authorized'].includes(current.status)) {
        const next = transition(state, current, 'cancel', { cancellationRequestId: generated('expiry') }, { role: 'requester', actorPartyId: current.requesterPartyId });
        next.failureReason = 'task_expired';
      } else {
        const next = transition(state, current, 'fail', { failureReceiptId: generated('expiry') }, host);
        next.failureReason = leaseExpired ? 'lease_expired_no_automatic_retry' : 'task_expired';
        next.stopUnconfirmed = LIVE.has(current.status);
      }
      log(scope, 'work_order.expired', current.id, leaseExpired ? 'Worker lease expired. External stop is unconfirmed; no task was replayed.' : 'Work order deadline expired.');
      changed = true;
    }
    return changed;
  }
  function budget(state, p) {
    const rows = state.workOrders.filter(o => o.projectId === p.id);
    return { maximumMinor: p.maximumMinor ?? 0, currency: p.currency ?? 'USD',
      reservedMinor: rows.filter(o => (!TERMINAL.has(o.status) && o.status !== 'proposed') || (o.status === 'failed' && o.stopUnconfirmed)).reduce((v, o) => v + o.maximumMinor, 0),
      riskHeldMinor: rows.filter(o => o.status === 'failed' && o.stopUnconfirmed).reduce((v, o) => v + o.maximumMinor, 0),
      accruedMinor: rows.filter(o => o.status === 'accepted').reduce((v, o) => v + (o.actualMinor ?? 0), 0),
      paymentStatus: 'not_connected' };
  }
  function projection(scope, state, projectId = null) {
    const selected = projectId ? project(state, projectId).id : state.projects[0]?.id ?? null;
    const belongs = row => row.projectId === selected;
    const p = state.projects.find(p => p.id === selected);
    const events = store.events(scope.workspaceId).filter(e => !selected || e.entityId === selected || [...state.parties, ...state.agents, ...state.workOrders, ...state.products, ...state.routes, ...state.mandates].some(r => r.id === e.entityId && belongs(r)));
    return {
      workspaceId: scope.workspaceId, sessionId: scope.sessionId ?? null, revision: state.revision, projectId: selected,
      projects: state.projects.map(p => ({ ...p, budget: budget(state, p) })),
      products: state.products.filter(belongs), routes: state.routes.filter(belongs),
      assets: [], leads: [], quotes: [], orders: [], workers: [], workerRuns: [], channelConnections: [], channelMetrics: [], approvals: [], evidence: [],
      canvasLayouts: state.layouts.filter(belongs), events,
      deliverables: state.deliverables.filter(belongs),
      commerceNetwork: { projectId: selected, revision: state.revision,
        parties: state.parties.filter(belongs), agentServices: state.agents.filter(belongs).map(publicAgent),
        salesAuthorizations: state.mandates.filter(belongs), grants: state.grants.filter(belongs).map(({ resources, ...g }) => ({ ...g, resourceRefs: resources.map(r => r.ref) })),
        workOrders: state.workOrders.filter(belongs).map(({ appliedEvents, ...o }) => ({ ...o,
          dependencyStates: (o.dependsOn ?? []).map(id => { const previous = state.workOrders.find(w => w.id === id); return { id, title: previous?.title ?? id, status: previous?.status ?? 'missing' }; }),
          dispatchReady: o.status === 'authorized' && (o.dependsOn ?? []).every(id => state.workOrders.find(w => w.id === id)?.status === 'accepted') && state.agents.find(a => a.id === o.agentServiceId)?.status === 'connected' })),
        layoutWriteSupported: true, layoutContractVersion: 'commerce-layout-v1' },
      budget: p ? budget(state, p) : null,
      capabilities: { dispatch: 'native-tool-only', workerProtocol: 'pull_gateway', payment: false, outreach: false, multiTenantLogin: false },
    };
  }
  function readScope(scope, projectId) {
    checkScope(scope);
    return store.transaction(() => {
      const state = store.load(scope.workspaceId);
      if (expire(state, scope)) { state.revision++; store.save(scope.workspaceId, state); }
      checkScope(scope);
      return projection(scope, state, projectId);
    });
  }
  function mutate(scope, input, operation, { layout = false } = {}) {
    checkScope(scope); identifier(input.requestId, 'requestId');
    const fingerprint = sha(canonical(input));
    return store.transaction(() => {
      checkScope(scope);
      const state = store.load(scope.workspaceId);
      const prior = store.receipt(scope.workspaceId, scope.actor, input.requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('REQUEST_ID_CONFLICT', 'This request ID was used for different content.', 409);
        const receipt = JSON.parse(prior.result);
        return { ...projection(scope, state, receipt.projectId ?? input.projectId), receipt: { ...receipt, replayed: true }, ...(receipt.credentialIssued ? { credential: { token: null, alreadyIssued: true, message: 'The secret is shown only once. Rotate the credential if it was lost.' } } : {}) };
      }
      if (!layout && input.expectedRevision !== state.revision) fail('REVISION_CONFLICT', 'The network changed. Refresh and review before retrying.', 409);
      const extra = operation(state) ?? {};
      checkScope(scope);
      if (state.projects.length > 100 || state.parties.length > 1000 || state.agents.length > 500 || state.products.length > 2000 || state.routes.length > 2000 || state.workOrders.length > 5000 || state.mandates.length > 2000 || Buffer.byteLength(JSON.stringify(state)) > 32 * 1024 * 1024) fail('LIMIT', 'Workspace record limit reached.');
      if (!layout) state.revision++;
      const receipt = { id: generated('receipt'), requestId: input.requestId, projectId: extra.projectId ?? input.projectId ?? null, revision: state.revision, at: iso(), ...(extra.credential ? { credentialIssued: true } : {}) };
      store.save(scope.workspaceId, state);
      store.saveReceipt(scope.workspaceId, scope.actor, input.requestId, fingerprint, receipt, iso());
      return { ...projection(scope, state, receipt.projectId), receipt, ...(extra.credential ? { credential: extra.credential } : {}) };
    });
  }
  function createProject(state, payload) {
    assertKeys(payload, ['id', 'title', 'name', 'goal']);
    if (state.projects.length >= 100) fail('LIMIT', 'Workspace project limit reached.');
    const p = { id: payload.id ? identifier(payload.id) : generated('project'), name: text(payload.title ?? payload.name, 'title'), goal: text(payload.goal ?? '', 'goal', 8000, false), createdAt: iso(), maximumMinor: 0, currency: 'USD' };
    if (state.projects.some(x => x.id === p.id)) fail('ID_CONFLICT', 'Project ID already exists.', 409);
    state.projects.push(p); return p;
  }
  function upsertParty(state, projectId, payload) {
    assertKeys(payload, ['id', 'type', 'displayName', 'marketCode']);
    if (!['factory', 'distributor', 'provider'].includes(payload.type)) fail('INPUT', 'Unknown business party type.');
    const id = payload.id ? identifier(payload.id) : generated('party');
    let p = state.parties.find(p => p.id === id);
    if (p && (p.projectId !== projectId || p.type !== payload.type)) fail('PARTY_IMMUTABLE', 'Party project and type cannot change.', 409);
    const fields = { id, projectId, type: payload.type, displayName: text(payload.displayName, 'displayName'), marketCode: text(payload.marketCode ?? '', 'marketCode', 40, false), verification: 'unverified' };
    if (p) Object.assign(p, fields); else { p = { ...fields, createdAt: iso() }; state.parties.push(p); }
    return p;
  }
  function registerAgent(state, projectId, payload) {
    assertKeys(payload, ['id', 'providerPartyId', 'displayName', 'skills', 'skillLabel']);
    const provider = state.parties.find(p => p.id === payload.providerPartyId && p.projectId === projectId);
    if (!provider) fail('PROVIDER_REQUIRED', 'Register the independent provider party first.');
    const skills = array(payload.skills, 'skills', 10);
    if (!skills.length || skills.some(s => !ACTIONS.includes(s))) fail('CAPABILITY_DENIED', 'Unsupported worker capability.');
    const id = payload.id ? identifier(payload.id) : generated('agent');
    if (state.agents.some(a => a.id === id)) fail('ID_CONFLICT', 'Agent service ID already exists.', 409);
    const a = { id, projectId, providerPartyId: provider.id, displayName: text(payload.displayName, 'displayName'), protocol: 'pull_gateway', skills: [...new Set(skills)], skillLabel: text(payload.skillLabel ?? skills.join(', '), 'skillLabel', 300), status: 'pending', executionEnabled: false, createdAt: iso() };
    state.agents.push(a); return a;
  }
  function upsertProduct(state, projectId, payload) {
    assertKeys(payload, ['id', 'name', 'sku', 'description', 'source', 'category', 'moq', 'leadTimeDays', 'sourceRef']);
    const id = payload.id ? identifier(payload.id) : generated('product');
    const prior = state.products.find(p => p.id === id);
    if (prior && prior.projectId !== projectId) fail('PRODUCT_SCOPE', 'Product belongs to another project.', 403);
    const value = { id, projectId, name: text(payload.name, 'name'), sku: text(payload.sku ?? '', 'sku', 100, false), description: text(payload.description ?? '', 'description', 12000, false), source: text(payload.source ?? 'native_conversation', 'source', 2000), category: text(payload.category ?? '', 'category', 100, false), version: (prior?.version ?? 0) + 1, status: 'draft' };
    if (payload.moq != null) value.moq = integer(payload.moq, 'moq', 1);
    if (payload.leadTimeDays != null) value.leadTimeDays = integer(payload.leadTimeDays, 'leadTimeDays', 0, 3650);
    if (payload.sourceRef != null) {
      assertKeys(payload.sourceRef, ['kind', 'id', 'revision', 'version', 'sha256']);
      if (!['product', 'document'].includes(payload.sourceRef.kind)) fail('INPUT', 'Unknown native source type.');
      identifier(payload.sourceRef.id, 'source id');
      if (payload.sourceRef.kind === 'product') integer(payload.sourceRef.revision, 'source revision', 1);
      else { integer(payload.sourceRef.version, 'source version', 1); if (!/^[a-f0-9]{64}$/.test(payload.sourceRef.sha256 ?? '')) fail('INPUT', 'Native document SHA256 required.'); }
      value.sourceRef = { ...payload.sourceRef };
    }
    if (prior) state.products[state.products.indexOf(prior)] = value; else state.products.push(value);
    return value;
  }
  function upsertRoute(state, projectId, payload) {
    assertKeys(payload, ['id', 'name', 'market', 'channel', 'goal', 'productIds', 'workerRole', 'workerGoal']);
    const id = payload.id ? identifier(payload.id) : generated('route');
    const prior = state.routes.find(r => r.id === id);
    if (prior && prior.projectId !== projectId) fail('ROUTE_SCOPE', 'Route belongs to another project.', 403);
    const productIds = array(payload.productIds ?? [], 'productIds', 100).map(id => identifier(id));
    if (productIds.some(id => !state.products.some(p => p.id === id && p.projectId === projectId))) fail('PRODUCT_NOT_FOUND', 'Route product is missing from the current project.');
    const value = { id, projectId, name: text(payload.name, 'name'), market: text(payload.market, 'market', 12), channel: text(payload.channel, 'channel', 80), goal: text(payload.goal ?? '', 'goal', 4000, false), productIds, workerRole: text(payload.workerRole ?? '', 'workerRole', 200, false), workerGoal: text(payload.workerGoal ?? '', 'workerGoal', 4000, false), status: 'planning', monitorEnabled: false };
    if (prior) state.routes[state.routes.indexOf(prior)] = value; else state.routes.push(value);
    return value;
  }
  function proposeOrder(state, projectId, payload) {
    assertKeys(payload, ['id', 'requesterPartyId', 'agentServiceId', 'title', 'brief', 'allowedActions', 'allowedResourceRefs', 'maximumMinor', 'currency', 'ttlSeconds', 'opportunityId', 'dependsOn']);
    const requester = state.parties.find(p => p.id === payload.requesterPartyId && p.projectId === projectId && ['factory', 'distributor'].includes(p.type));
    if (!requester) fail('REQUESTER_REQUIRED', 'Choose a factory or distributor in this project.');
    const a = agent(state, projectId, payload.agentServiceId);
    if (a.status === 'revoked') fail('AGENT_REVOKED', 'This agent service was revoked.', 409);
    let proposal;
    try { proposal = makeWorkOrderProposal({ projectId, requesterPartyId: requester.id, agentServiceId: a.id,
      opportunityId: payload.opportunityId ?? projectId, allowedActions: payload.allowedActions,
      allowedResourceRefs: payload.allowedResourceRefs ?? [], allowSubdelegation: false,
      maximumMinor: payload.maximumMinor ?? 0, currency: payload.currency ?? 'USD', ttlSeconds: payload.ttlSeconds ?? 86400,
      acceptanceReviewerPartyId: requester.id }); }
    catch (error) { if (/^[A-Z_]+$/.test(error.message)) fail(error.message, 'The proposed task is outside the supported delegation policy.'); throw error; }
    if (proposal.allowedActions.some(v => !a.skills.includes(v))) fail('CAPABILITY_DENIED', 'Agent did not declare all requested actions.');
    const id = payload.id ? identifier(payload.id) : generated('work');
    if (state.workOrders.some(o => o.id === id)) fail('ID_CONFLICT', 'Work order already exists.', 409);
    const dependsOn = [...new Set(array(payload.dependsOn ?? [], 'dependsOn', 20).map(id => identifier(id)))];
    const o = { ...proposal, id, providerPartyId: a.providerPartyId, title: text(payload.title, 'title'), brief: text(payload.brief, 'brief', 16000), dependsOn, revision: 1, createdAt: iso(), updatedAt: iso(), expiresAt: new Date(now() + proposal.ttlSeconds * 1000).toISOString(), appliedEvents: [] };
    state.workOrders.push(o); return o;
  }
  function validateDependencies(state, projectId) {
    const orders = state.workOrders.filter(o => o.projectId === projectId), ids = new Set(orders.map(o => o.id));
    const indegree = new Map(), successors = new Map();
    for (const o of orders) {
      const deps = o.dependsOn ?? [];
      if (deps.some(id => !ids.has(id) || id === o.id)) fail('DEPENDENCY_INVALID', 'Dependencies must reference other work orders in this project.');
      indegree.set(o.id, deps.length);
      for (const id of deps) { if (!successors.has(id)) successors.set(id, []); successors.get(id).push(o.id); }
    }
    const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id); let count = 0;
    while (ready.length) { const id = ready.pop(); count++; for (const next of successors.get(id) ?? []) { indegree.set(next, indegree.get(next) - 1); if (indegree.get(next) === 0) ready.push(next); } }
    if (count !== orders.length) fail('DEPENDENCY_CYCLE', 'Work-order dependencies must not contain a cycle.');
  }
  function proposeMandate(state, projectId, payload) {
    assertKeys(payload, ['id', 'factoryPartyId', 'distributorPartyId', 'marketCode', 'productIds', 'scope']);
    if (!state.parties.some(p => p.projectId === projectId && p.id === payload.factoryPartyId && p.type === 'factory') || !state.parties.some(p => p.projectId === projectId && p.id === payload.distributorPartyId && p.type === 'distributor')) fail('MANDATE_PARTY', 'Choose the factory and distributor in this project.');
    const productIds = [...new Set(array(payload.productIds, 'productIds', 100).map(id => identifier(id)))];
    if (!productIds.length || productIds.some(id => !state.products.some(p => p.projectId === projectId && p.id === id))) fail('MANDATE_PRODUCT', 'Choose explicit product context nodes in this project.');
    const id = payload.id ? identifier(payload.id) : generated('mandate');
    if (state.mandates.some(m => m.id === id)) fail('ID_CONFLICT', 'Sales mandate already exists.', 409);
    const mandate = { id, projectId, factoryPartyId: payload.factoryPartyId, distributorPartyId: payload.distributorPartyId,
      marketCode: text(payload.marketCode, 'marketCode', 40), productIds, scope: text(payload.scope, 'scope', 4000), status: 'proposed', revision: 1, createdAt: iso(), legalSignature: false };
    state.mandates.push(mandate); return mandate;
  }
  function resourceSnapshots(state, projectId, refs, scope) {
    return refs.map(ref => {
      if (ref.startsWith('accepted_deliverable:')) {
        const predecessor = state.workOrders.find(o => o.id === ref.slice('accepted_deliverable:'.length) && o.projectId === projectId && o.status === 'accepted');
        const delivery = predecessor && state.deliverables.find(d => d.id === predecessor.deliverableId && d.orderId === predecessor.id && d.projectId === projectId);
        if (!delivery || sha(delivery.content) !== predecessor.deliverableSha256 || delivery.sha256 !== predecessor.deliverableSha256) fail('DELIVERY_INPUT_UNAVAILABLE', 'Only an accepted, intact delivery from this project can be shared with the next worker.', 409);
        const content = { title: delivery.title, text: delivery.content, sourceUrls: delivery.sourceUrls, provenance: delivery.provenance };
        return { ref, version: 1, sha256: sha(canonical(content)), content, source: { kind: 'accepted-delivery', orderId: predecessor.id, deliverableId: delivery.id, deliverableSha256: delivery.sha256 } };
      }
      if (!ref.startsWith('product:')) fail('RESOURCE_UNAVAILABLE', 'This release shares explicit project product snapshots only. Other references require a native source adapter.');
      const p = state.products.find(p => p.id === ref.slice(8) && p.projectId === projectId);
      if (!p) fail('RESOURCE_UNAVAILABLE', 'The referenced product is unavailable in this project.');
      if (p.sourceRef) {
        const snapshot = scope.preparedResources?.find(r => r.ref === ref);
        if (!snapshot || canonical(snapshot.sourceRef) !== canonical(p.sourceRef)) fail('RESOURCE_UNAVAILABLE', 'The pinned native source was not revalidated.');
        return snapshot;
      }
      // Prices, private documents and the whole workspace are never sent.
      const content = { name: p.name, sku: p.sku, description: p.description, category: p.category, source: p.source, verification: 'unverified', ...(p.moq != null ? { moq: p.moq } : {}), ...(p.leadTimeDays != null ? { leadTimeDays: p.leadTimeDays } : {}) };
      return { ref, version: p.version, sha256: sha(canonical(content)), content, source: { kind: 'conversation-plan-context', verified: false } };
    });
  }
  function assertGrant(state, o) {
    const grant = state.grants.find(g => g.id === o.grantId && g.orderId === o.id && g.agentServiceId === o.agentServiceId && g.status === 'active');
    if (!grant || Date.parse(grant.expiresAt) <= now()) fail('GRANT_REVOKED', 'The exact delegation grant is unavailable or expired.', 403);
    const a = agent(state, o.projectId, o.agentServiceId);
    if (a.status !== 'connected' || !a.executionEnabled) fail('AGENT_UNAVAILABLE', 'Personal Worker is not connected or has been revoked.', 409);
    for (const resource of grant.resources.filter(r => r.source?.kind === 'accepted-delivery')) {
      const previous = state.workOrders.find(w => w.id === resource.source.orderId && w.projectId === o.projectId && w.status === 'accepted');
      const delivery = state.deliverables.find(d => d.id === resource.source.deliverableId && d.projectId === o.projectId && d.orderId === previous?.id);
      if (!delivery || previous.deliverableSha256 !== resource.source.deliverableSha256 || sha(delivery.content) !== resource.source.deliverableSha256 || sha(canonical(resource.content)) !== resource.sha256) fail('DELIVERY_INPUT_UNAVAILABLE', 'The approved predecessor output is unavailable or changed.', 409);
    }
    return grant;
  }
  function authorizeOrder(state, projectId, payload, scope) {
    assertKeys(payload, ['orderId', 'reviewDigest']);
    const o = order(state, projectId, payload.orderId), p = project(state, projectId), a = agent(state, projectId, o.agentServiceId);
    if (a.status !== 'connected' || !a.endpointVerificationReceiptId) fail('AGENT_NOT_CONNECTED', 'Connect the Personal Worker before authorizing a task.', 409);
    const b = budget(state, p);
    if (o.currency !== b.currency || b.reservedMinor + b.accruedMinor + o.maximumMinor > b.maximumMinor) fail('BUDGET_EXCEEDED', 'The authorized project budget is insufficient.', 409);
    const resources = resourceSnapshots(state, projectId, o.allowedResourceRefs, scope);
    if (Buffer.byteLength(JSON.stringify(resources)) > 192 * 1024) fail('RESOURCE_TOO_LARGE', 'The approved shared context exceeds 192 KiB. Select fewer resources.', 413);
    if (payload.reviewDigest !== reviewDigest(o, resources)) fail('REVIEW_CHANGED', 'Review the exact task and shared resources before authorizing.', 409);
    const grant = { id: generated('grant'), projectId, orderId: o.id, agentServiceId: o.agentServiceId, requesterPartyId: o.requesterPartyId, actions: [...o.allowedActions], resources, status: 'active', createdAt: iso(), expiresAt: o.expiresAt };
    state.grants.push(grant);
    const next = transition(state, o, 'authorize', { approvalReceiptId: generated('approval'), grantId: grant.id, budgetReservationId: generated('budget') }, { role: 'requester', actorPartyId: o.requesterPartyId });
    next.approvedBy = scope.actor;
    next.approvedResources = resources.map(({ content, ...r }) => ({ ...r, title: typeof content === 'object' ? content.name : r.ref }));
    log(scope, 'work_order.authorized', o.id, 'Exact task, resources and maximum cost authorized by the DSH owner.');
  }
  function reviewDigest(o, resources) {
    return sha(canonical({ id: o.id, revision: o.revision, requesterPartyId: o.requesterPartyId, agentServiceId: o.agentServiceId, title: o.title, brief: o.brief, allowedActions: o.allowedActions, maximumMinor: o.maximumMinor, currency: o.currency, expiresAt: o.expiresAt, resources }));
  }
  async function prepareResources(scope, state, o) {
    const preparedResources = [];
    for (const ref of o.allowedResourceRefs) {
      const p = state.products.find(p => ref === `product:${p.id}` && p.projectId === o.projectId);
      if (!p?.sourceRef) continue;
      if (!resourceAdapter) fail('RESOURCE_ADAPTER_UNAVAILABLE', 'The native source adapter is not connected.', 503);
      const snapshot = await resourceAdapter.resolve({ workspaceId: scope.workspaceId, projectId: o.projectId, ref, sourceRef: p.sourceRef }, { signal: scope.signal });
      preparedResources.push(snapshot); checkScope(scope);
    }
    return preparedResources;
  }
  async function review(sessionId, projectId, orderId) {
    const scope = browser(sessionId), state = store.load(scope.workspaceId), o = order(state, projectId, orderId);
    if (o.status !== 'proposed') fail('REVIEW_STATE', 'Only proposed work orders can be authorized.', 409);
    const preparedResources = await prepareResources(scope, state, o);
    checkScope(scope);
    if (store.load(scope.workspaceId).revision !== state.revision) fail('REVISION_CONFLICT', 'Network changed during review. Refresh and review again.', 409);
    const resources = resourceSnapshots(state, projectId, o.allowedResourceRefs, { ...scope, preparedResources });
    return { orderId, projectId, networkRevision: state.revision, reviewDigest: reviewDigest(o, resources), resources, title: o.title, brief: o.brief,
      allowedActions: o.allowedActions, maximumMinor: o.maximumMinor, currency: o.currency, expiresAt: o.expiresAt, requesterPartyId: o.requesterPartyId, agentServiceId: o.agentServiceId };
  }
  function cancelOrder(state, projectId, payload, scope) {
    assertKeys(payload, ['orderId']);
    const o = order(state, projectId, payload.orderId);
    transition(state, o, 'cancel', { cancellationRequestId: generated('cancel') }, { role: 'requester', actorPartyId: o.requesterPartyId });
    const grant = state.grants.find(g => g.orderId === o.id); if (grant) grant.status = 'revoked';
    log(scope, 'work_order.cancel_requested', o.id, LIVE.has(o.status) ? 'Stop requested; waiting for a real worker acknowledgement.' : 'Work order cancelled before execution.');
  }
  function ownerOnly(scope) { if (scope.kind !== 'owner') fail('OWNER_ACTION_REQUIRED', 'This action requires an explicit decision in the authenticated canvas.', 403); }
  const ownerActions = new Set(['approve_order', 'accept_delivery', 'reject_delivery', 'cancel_order', 'revoke_agent', 'issue_agent_credential', 'set_budget', 'revoke_grant', 'approve_mandate', 'revoke_mandate', 'resolve_failed_order']);
  function applyCommand(scope, input) {
    assertKeys(input, ['projectId', 'expectedRevision', 'requestId', 'command', 'payload']);
    text(input.command, 'command', 80); const payload = input.payload ?? {};
    if (ownerActions.has(input.command)) ownerOnly(scope);
    if (input.command === 'dispatch_order' && scope.kind !== 'tool') fail('NATIVE_DISPATCH_REQUIRED', 'Dispatch must run through the native DSH conversation.', 403);
    return mutate(scope, input, state => {
      let projectId = input.projectId;
      if (input.command === 'create_project') {
        const p = createProject(state, payload); projectId = p.id;
        log(scope, 'project.created', p.id, `Created ${p.name}`); return { projectId };
      }
      if (input.command === 'apply_plan') {
        if (scope.kind !== 'tool') fail('NATIVE_PLAN_REQUIRED', 'The native conversation applies network plans.', 403);
        assertKeys(payload, ['title', 'goal', 'parties', 'agents', 'products', 'routes', 'workOrders', 'mandates']);
        if (!projectId) projectId = createProject(state, { title: payload.title, goal: payload.goal ?? '' }).id;
        else { const p = project(state, projectId); if (payload.title) p.name = text(payload.title, 'title'); if (payload.goal != null) p.goal = text(payload.goal, 'goal', 8000, false); }
        for (const v of array(payload.parties ?? [], 'parties', 50)) upsertParty(state, projectId, v);
        for (const v of array(payload.agents ?? [], 'agents', 30)) registerAgent(state, projectId, v);
        for (const v of array(payload.products ?? [], 'products', 100)) upsertProduct(state, projectId, v);
        for (const v of array(payload.routes ?? [], 'routes', 100)) upsertRoute(state, projectId, v);
        for (const v of array(payload.mandates ?? [], 'mandates', 50)) proposeMandate(state, projectId, v);
        for (const v of array(payload.workOrders ?? [], 'workOrders', 30)) proposeOrder(state, projectId, v);
        validateDependencies(state, projectId);
        log(scope, 'plan.applied', projectId, 'Native DSH applied a business plan. No authorization or dispatch was implied.');
        return { projectId };
      }
      project(state, projectId);
      if (input.command === 'upsert_party') { const p = upsertParty(state, projectId, payload); log(scope, 'party.recorded', p.id, 'Business party recorded as unverified.'); }
      else if (input.command === 'register_agent') { const a = registerAgent(state, projectId, payload); log(scope, 'agent.registered', a.id, 'Independent Personal Worker registered; credential handshake pending.'); }
      else if (input.command === 'upsert_product') { const p = upsertProduct(state, projectId, payload); log(scope, 'product.recorded', p.id, 'Draft product information recorded.'); }
      else if (input.command === 'upsert_route') { const r = upsertRoute(state, projectId, payload); log(scope, 'route.recorded', r.id, 'Planned sales channel recorded; account not connected.'); }
      else if (input.command === 'propose_order') { const o = proposeOrder(state, projectId, payload); validateDependencies(state, projectId); log(scope, 'work_order.proposed', o.id, 'Service task proposed for owner review.'); }
      else if (input.command === 'propose_mandate') { const m = proposeMandate(state, projectId, payload); log(scope, 'mandate.proposed', m.id, 'Factory-distributor relationship proposed with explicit product/market scope.'); }
      else if (input.command === 'approve_mandate' || input.command === 'revoke_mandate') {
        assertKeys(payload, ['mandateId']); const m = state.mandates.find(m => m.projectId === projectId && m.id === payload.mandateId);
        if (!m) fail('MANDATE_NOT_FOUND', 'Sales mandate not found.', 404);
        if (input.command === 'approve_mandate') {
          if (m.status !== 'proposed') fail('MANDATE_STATE', 'Only a proposed mandate can be approved.', 409);
          m.status = 'active'; m.approvalReceiptId = generated('mandate_approval'); m.approvedAt = iso(); m.approvedBy = scope.actor;
          log(scope, 'mandate.approved', m.id, 'Owner recorded business authorization. This is not a legal signature or channel connection.');
        } else {
          if (m.status === 'revoked') fail('MANDATE_STATE', 'Mandate is already revoked.', 409);
          m.status = 'revoked'; m.revokedAt = iso(); m.revocationReceiptId = generated('mandate_revoke');
          log(scope, 'mandate.revoked', m.id, 'Business authorization revoked.');
        }
        m.revision++;
      }
      else if (input.command === 'set_budget') {
        assertKeys(payload, ['maximumMinor', 'currency']); const p = project(state, projectId), b = budget(state, p);
        integer(payload.maximumMinor, 'maximumMinor'); if (!/^[A-Z]{3}$/.test(payload.currency ?? '')) fail('INPUT', 'Invalid currency.');
        if (payload.maximumMinor < b.reservedMinor + b.accruedMinor || (payload.currency !== p.currency && (b.reservedMinor || b.accruedMinor))) fail('BUDGET_COMMITTED', 'Existing commitments prevent this budget change.', 409);
        p.maximumMinor = payload.maximumMinor; p.currency = payload.currency; log(scope, 'budget.updated', projectId, 'Project service budget explicitly changed. No payment was made.');
      } else if (input.command === 'issue_agent_credential') {
        assertKeys(payload, ['agentServiceId']); const a = agent(state, projectId, payload.agentServiceId);
        if (a.status === 'revoked') fail('AGENT_REVOKED', 'Register a new service to replace a revoked agent.', 409);
        if (state.workOrders.some(o => o.agentServiceId === a.id && LIVE.has(o.status))) fail('AGENT_BUSY', 'Stop the current work order before rotating credentials.', 409);
        store.revokeCredentials(scope.workspaceId, a.id, iso());
        const credentialId = randomBytes(12).toString('hex'), secret = randomBytes(32).toString('base64url'), token = `cnw_${credentialId}.${secret}`;
        const expiresAt = new Date(now() + 30 * 86400_000).toISOString();
        store.addCredential({ id: credentialId, workspaceId: scope.workspaceId, projectId, agentId: a.id, secretHash: sha(token), createdAt: iso(), expiresAt });
        a.status = 'credential_issued'; a.executionEnabled = false;
        delete a.endpointVerificationReceiptId; delete a.endpointVerifiedAt;
        log(scope, 'agent.credential_issued', a.id, 'Scoped credential issued; only its hash was stored.');
        return { projectId, credential: { token, agentServiceId: a.id, gatewayPath: '/commerce-worker-api', expiresAt } };
      } else if (input.command === 'approve_order') authorizeOrder(state, projectId, payload, scope);
      else if (input.command === 'dispatch_order') {
        assertKeys(payload, ['orderId']); const o = order(state, projectId, payload.orderId); assertGrant(state, o);
        if ((o.dependsOn ?? []).some(id => state.workOrders.find(previous => previous.id === id && previous.projectId === projectId)?.status !== 'accepted')) fail('DEPENDENCY_NOT_ACCEPTED', 'Every predecessor must have an accepted real delivery before this task can be dispatched.', 409);
        const next = transition(state, o, 'dispatch', { dshTaskRef: `dsh_${sha(`${scope.sessionId}/${scope.callId}`)}` }, host);
        next.nativeDispatch = { sessionId: scope.sessionId, callId: scope.callId, at: iso() };
        log(scope, 'work_order.queued', o.id, 'Authorized task queued by an actual native DSH tool call.');
      } else if (input.command === 'cancel_order') cancelOrder(state, projectId, payload, scope);
      else if (input.command === 'accept_delivery' || input.command === 'reject_delivery') {
        assertKeys(payload, input.command === 'reject_delivery' ? ['orderId', 'reason'] : ['orderId']);
        const o = order(state, projectId, payload.orderId), accept = input.command === 'accept_delivery';
        const next = transition(state, o, accept ? 'accept' : 'reject', { [accept ? 'acceptanceReceiptId' : 'rejectionReceiptId']: generated(accept ? 'accept' : 'reject'), reviewerPartyId: o.requesterPartyId }, { role: 'requester', actorPartyId: o.requesterPartyId });
        next.reviewedBy = scope.actor; if (!accept) next.rejectionReason = text(payload.reason, 'reason', 2000);
        const g = state.grants.find(g => g.orderId === o.id); if (g) g.status = 'closed';
        log(scope, accept ? 'delivery.accepted' : 'delivery.rejected', o.id, accept ? 'Owner accepted the actual delivery. Budget recorded; no payment made.' : 'Owner rejected the delivery; no automatic rerun.');
      } else if (input.command === 'revoke_agent') {
        assertKeys(payload, ['agentServiceId']); const a = agent(state, projectId, payload.agentServiceId);
        a.status = 'revoked'; a.executionEnabled = false; a.revokedAt = iso(); store.revokeCredentials(scope.workspaceId, a.id, iso());
        for (const o of [...state.workOrders].filter(o => o.agentServiceId === a.id && !TERMINAL.has(o.status) && o.status !== 'delivered' && o.status !== 'stop_requested')) cancelOrder(state, projectId, { orderId: o.id }, scope);
        for (const g of state.grants.filter(g => g.agentServiceId === a.id)) g.status = 'revoked';
        log(scope, 'agent.revoked', a.id, 'Agent access revoked. Active work requires an external stop acknowledgement.');
      } else if (input.command === 'revoke_grant') {
        assertKeys(payload, ['grantId']); const g = state.grants.find(g => g.id === payload.grantId && g.projectId === projectId);
        if (!g) fail('GRANT_NOT_FOUND', 'Grant not found.', 404);
        g.status = 'revoked'; const o = order(state, projectId, g.orderId);
        if (!TERMINAL.has(o.status) && !['delivered', 'stop_requested'].includes(o.status)) cancelOrder(state, projectId, { orderId: o.id }, scope);
        log(scope, 'grant.revoked', o.id, 'Delegation access revoked.');
      } else if (input.command === 'resolve_failed_order') {
        assertKeys(payload, ['orderId', 'reason']); const o = order(state, projectId, payload.orderId);
        if (o.status !== 'failed' || !o.stopUnconfirmed || !o.stopAcknowledgedAt) fail('STOP_UNCONFIRMED', 'A real worker stop acknowledgement is required before releasing the held reservation.', 409);
        o.stopUnconfirmed = false; o.reservationResolvedBy = scope.actor; o.resolutionReason = text(payload.reason, 'reason', 2000); o.revision++;
        log(scope, 'work_order.reservation_resolved', o.id, 'Owner released an at-risk reservation after authenticated worker stop acknowledgement.');
      } else fail('COMMAND_NOT_FOUND', 'Unknown commerce command.');
      if (state.parties.length > 1000 || state.agents.length > 500 || state.products.length > 2000 || state.routes.length > 2000 || state.workOrders.length > 5000) fail('LIMIT', 'Workspace record limit reached.');
      return { projectId };
    });
  }
  async function command(scope, input) {
    checkScope(scope);
    if (input.command === 'approve_order') {
      ownerOnly(scope);
      const state = store.load(scope.workspaceId);
      if (store.receipt(scope.workspaceId, scope.actor, input.requestId)) return applyCommand(scope, input);
      if (state.revision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Refresh the network before approving this task.', 409);
      const o = order(state, input.projectId, input.payload?.orderId);
      const preparedResources = await prepareResources(scope, state, o);
      scope = { ...scope, preparedResources };
    }
    return applyCommand(scope, input);
  }
  function layout(sessionId, input) {
    const scope = browser(sessionId);
    assertKeys(input, ['projectId', 'requestId', 'expectedLayoutRevision', 'nodes', 'viewport']);
    return mutate(scope, input, state => {
      project(state, input.projectId);
      const current = state.layouts.find(l => l.projectId === input.projectId);
      if (input.expectedLayoutRevision !== (current?.revision ?? 0)) fail('LAYOUT_CONFLICT', 'The canvas layout changed. Refresh before saving.', 409);
      const allowed = new Set();
      for (const p of state.products.filter(p => p.projectId === input.projectId)) allowed.add(`product:${p.id}`);
      for (const r of state.routes.filter(r => r.projectId === input.projectId)) { allowed.add(`route:${r.id}`); allowed.add(`market:${r.market}`); if (r.workerRole || r.workerGoal) allowed.add(`worker:${r.id}`); }
      for (const p of state.parties.filter(p => p.projectId === input.projectId && ['factory', 'distributor'].includes(p.type))) allowed.add(`${p.type}:${p.id}`);
      for (const a of state.agents.filter(a => a.projectId === input.projectId)) allowed.add(`personal_agent:${a.id}`);
      for (const o of state.workOrders.filter(o => o.projectId === input.projectId)) allowed.add(`service_order:${o.id}`);
      const seen = new Set();
      const nodes = array(input.nodes, 'nodes', 3000).map(n => {
        assertKeys(n, ['id', 'position']); assertKeys(n.position, ['x', 'y']);
        if (!allowed.has(n.id) || seen.has(n.id) || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y) || Math.abs(n.position.x) > 1e6 || Math.abs(n.position.y) > 1e6) fail('LAYOUT_INPUT', 'Invalid node coordinates.');
        seen.add(n.id); return { id: n.id, position: { x: n.position.x, y: n.position.y } };
      });
      let viewport = null;
      if (input.viewport != null) {
        assertKeys(input.viewport, ['x', 'y', 'zoom']); const v = input.viewport;
        if (![v.x, v.y, v.zoom].every(Number.isFinite) || Math.abs(v.x) > 1e6 || Math.abs(v.y) > 1e6 || v.zoom < 0.1 || v.zoom > 4) fail('LAYOUT_INPUT', 'Invalid viewport.');
        viewport = { ...v };
      }
      const next = { projectId: input.projectId, revision: (current?.revision ?? 0) + 1, nodes, viewport, updatedAt: iso() };
      if (current) state.layouts[state.layouts.indexOf(current)] = next; else state.layouts.push(next);
      return { projectId: input.projectId };
    }, { layout: true });
  }
  function workerIdentity(token, allowRevoked = false) {
    alive();
    if (typeof token !== 'string' || !/^cnw_[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/.test(token)) fail('WORKER_UNAUTHORIZED', 'A valid scoped worker credential is required.', 401);
    const c = store.credential(token.slice(4, 28));
    if (!c || !timingSafeEqual(Buffer.from(c.secret_hash, 'hex'), Buffer.from(sha(token), 'hex')) || Date.parse(c.expires_at) <= now() || (!allowRevoked && c.revoked_at)) fail('WORKER_UNAUTHORIZED', 'Worker credential is invalid, expired or revoked.', 401);
    workspace(c.workspace_id);
    return { workspaceId: c.workspace_id, projectId: c.project_id, agentServiceId: c.agent_id, actor: `worker:${c.agent_id}`, kind: 'worker', credentialId: c.id, revoked: !!c.revoked_at };
  }
  function workerTransaction(token, action, input, verifiedGrant = null) {
    const allowRevoked = action === 'status' || action === 'stopped';
    const scope = workerIdentity(token, allowRevoked);
    assertKeys(input, ['requestId', 'orderId', 'leaseId', 'content', 'title', 'sourceUrls', 'actualMinor']);
    identifier(input.requestId, 'requestId');
    const fingerprint = sha(canonical({ action, ...input }));
    return store.transaction(() => {
      workerIdentity(token, allowRevoked);
      const state = store.load(scope.workspaceId), a = agent(state, scope.projectId, scope.agentServiceId);
      if (expire(state, scope)) { state.revision++; store.save(scope.workspaceId, state); }
      const prior = store.receipt(scope.workspaceId, scope.actor, input.requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('REQUEST_ID_CONFLICT', 'Worker request ID conflicts with another operation.', 409);
        const response = JSON.parse(prior.result);
        if (response.order?.id) {
          const current = order(state, scope.projectId, response.order.id);
          if (current.status === 'stop_requested' || current.status === 'delivered' || TERMINAL.has(current.status)) return { replayed: true, order: { id: current.id, status: current.status }, stopRequested: current.status !== 'delivered' };
          assertGrant(state, current);
          if ((response.order.resources || response.resources) && verifiedGrant !== sha(canonical(state.grants.find(g => g.id === current.grantId)))) fail('GRANT_CHANGED', 'The resource grant changed while it was being checked.', 409);
        }
        return { ...response, replayed: true };
      }
      let response, dirty = false;
      if (action === 'connect') {
        if (scope.revoked || a.status === 'revoked') fail('AGENT_REVOKED', 'Agent access was revoked.', 403);
        if (a.status !== 'connected') {
          a.status = 'connected'; a.executionEnabled = true; a.endpointVerificationReceiptId = generated('handshake'); a.endpointVerifiedAt = iso(); a.lastSeenAt = iso(); dirty = true;
          log(scope, 'agent.connected', a.id, 'Scoped credential possession verified. Skill quality remains unverified.');
        }
        response = { agentServiceId: a.id, projectId: a.projectId, status: 'connected', capabilities: a.skills, leaseSeconds: MAX_LEASE / 1000 };
      } else if (action === 'claim') {
        if (a.status !== 'connected') fail('AGENT_UNAVAILABLE', 'Complete the credential handshake first.', 409);
        if (state.workOrders.some(o => o.agentServiceId === a.id && LIVE.has(o.status))) fail('AGENT_BUSY', 'Only one active lease per Personal Worker is allowed.', 409);
        const o = state.workOrders.find(o => o.agentServiceId === a.id && o.projectId === scope.projectId && o.status === 'queued' && (!input.orderId || input.orderId === o.id));
        if (!o) response = { order: null, retryAfterSeconds: 15 };
        else {
          const g = assertGrant(state, o), leaseId = generated('lease'), leaseExpiresAt = new Date(Math.min(now() + MAX_LEASE, Date.parse(o.expiresAt))).toISOString();
          if (g.resources.some(r => r.sourceRef) && verifiedGrant !== sha(canonical(g))) fail('GRANT_CHANGED', 'The resource grant changed while it was being checked.', 409);
          const next = transition(state, o, 'claim', { claimReceiptId: generated('claim'), leaseId, leaseExpiresAt }, { role: 'provider', actorPartyId: a.providerPartyId, agentServiceId: a.id });
          a.lastSeenAt = iso(); dirty = true;
          response = { order: { id: next.id, title: next.title, brief: next.brief, allowedActions: next.allowedActions, maximumMinor: next.maximumMinor, currency: next.currency, expiresAt: next.expiresAt, leaseId, leaseExpiresAt, resources: g.resources, status: next.status }, policy: { subdelegation: false, outboundMessages: false, payments: false, credentialSharing: false } };
          log(scope, 'work_order.claimed', o.id, 'Personal Worker claimed the exact delegated task.');
        }
      } else {
        identifier(input.orderId, 'orderId');
        const o = order(state, scope.projectId, input.orderId);
        if (o.agentServiceId !== a.id || !input.leaseId || input.leaseId !== o.leaseId) fail('LEASE_DENIED', 'This work order is not leased to this agent.', 403);
        const auth = { role: 'provider', actorPartyId: a.providerPartyId, agentServiceId: a.id, leaseId: input.leaseId };
        if (action === 'status') response = { order: { id: o.id, status: o.status, leaseExpiresAt: o.leaseExpiresAt }, stopRequested: scope.revoked || o.status === 'stop_requested' || TERMINAL.has(o.status) };
        else if (action === 'resources') {
          const g = assertGrant(state, o);
          if (!['claimed', 'running'].includes(o.status) || Date.parse(o.leaseExpiresAt) <= now()) fail('LEASE_EXPIRED', 'Resource access requires a current worker lease.', 409);
          if (g.resources.some(r => r.sourceRef) && verifiedGrant !== sha(canonical(g))) fail('GRANT_CHANGED', 'The resource grant changed while it was being checked.', 409);
          response = { order: { id: o.id, status: o.status }, resources: g.resources };
        }
        else if (action === 'stopped') {
          const next = o.status === 'failed' && o.stopUnconfirmed ? o : transition(state, o, 'stopped', { stopReceiptId: generated('stopped') }, host);
          if (next.status === 'failed') { next.stopReceiptId = generated('stopped'); next.revision++; }
          next.stopAcknowledgedBy = a.id; next.stopAcknowledgedAt = iso(); dirty = true; response = { order: { id: next.id, status: next.status }, stopRequested: true };
          log(scope, 'work_order.stopped', o.id, 'Authenticated worker acknowledged stopping the task.');
        } else if (action === 'heartbeat') {
          if (o.status === 'stop_requested') response = { order: { id: o.id, status: o.status }, stopRequested: true };
          else {
            assertGrant(state, o);
            if (!['claimed', 'running'].includes(o.status) || Date.parse(o.leaseExpiresAt) <= now()) fail('LEASE_EXPIRED', 'The worker lease is no longer active.', 409);
            let next = o;
            if (o.status === 'claimed') next = transition(state, o, 'start', { heartbeatReceiptId: generated('heartbeat') }, auth);
            else { next.revision++; next.heartbeatReceiptId = generated('heartbeat'); }
            next.leaseExpiresAt = new Date(Math.min(now() + MAX_LEASE, Date.parse(o.expiresAt))).toISOString(); next.updatedAt = iso(); a.lastSeenAt = iso(); dirty = true;
            response = { order: { id: next.id, status: next.status, leaseExpiresAt: next.leaseExpiresAt }, stopRequested: false };
          }
        } else if (action === 'deliver') {
          assertGrant(state, o);
          if (Date.parse(o.leaseExpiresAt) <= now()) fail('LEASE_EXPIRED', 'Cannot deliver with an expired lease.', 409);
          const content = text(input.content, 'content', 100_000), title = text(input.title, 'title', 200), actualMinor = integer(input.actualMinor ?? 0, 'actualMinor', 0, o.maximumMinor);
          const sources = array(input.sourceUrls ?? [], 'sourceUrls', 50).map(value => {
            const source = text(value, 'source URL', 2000); let u; try { u = new URL(source); } catch { fail('INPUT', 'Invalid source URL.'); }
            if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) fail('INPUT', 'Unsafe source URL.'); return u.toString();
          });
          const deliverable = { id: generated('delivery'), projectId: o.projectId, orderId: o.id, agentServiceId: a.id, title, content, sourceUrls: sources, sha256: sha(content), createdAt: iso(), provenance: 'external-worker-submission-unverified' };
          state.deliverables.push(deliverable);
          const next = transition(state, o, 'deliver', { deliverableId: deliverable.id, deliveryReceiptId: generated('delivery_receipt'), deliverableSha256: deliverable.sha256 }, auth);
          next.actualMinor = actualMinor; dirty = true; response = { order: { id: next.id, status: next.status }, deliverable: { id: deliverable.id, sha256: deliverable.sha256 }, acceptance: 'pending_owner_review' };
          log(scope, 'work_order.delivered', o.id, 'Actual content stored and hashed. Owner acceptance is pending.');
        } else fail('WORKER_ACTION', 'Unsupported worker action.', 404);
      }
      checkScope(scope);
      if (dirty) { state.revision++; store.save(scope.workspaceId, state); }
      // Read-only lease status/resource reads do not churn graph revisions or
      // duplicate potentially large resource snapshots in the receipt ledger.
      if (!['status', 'resources'].includes(action)) store.saveReceipt(scope.workspaceId, scope.actor, input.requestId, fingerprint, response, iso());
      return response;
    });
  }
  async function worker(token, action, input) {
    const scope = workerIdentity(token, action === 'status' || action === 'stopped');
    const window = workerWindows.get(scope.credentialId);
    if (!window || window.until <= now()) {
      for (const [id, old] of workerWindows) if (old.until <= now()) workerWindows.delete(id);
      workerWindows.set(scope.credentialId, { count: 1, until: now() + 60_000 });
    } else {
      if (window.count >= 60) fail('WORKER_RATE_LIMIT', 'Worker request limit reached. Retry after the current minute.', 429);
      window.count++;
    }
    let verifiedGrant = null;
    if (['claim', 'resources', 'deliver'].includes(action)) {
      const state = store.load(scope.workspaceId);
      const replay = input?.requestId && store.receipt(scope.workspaceId, scope.actor, input.requestId);
      const replayOrderId = replay ? JSON.parse(replay.result).order?.id : null;
      const o = action === 'claim'
        ? state.workOrders.find(o => o.agentServiceId === scope.agentServiceId && o.projectId === scope.projectId && (replayOrderId ? o.id === replayOrderId : o.status === 'queued' && (!input.orderId || input.orderId === o.id)))
        : state.workOrders.find(o => o.agentServiceId === scope.agentServiceId && o.projectId === scope.projectId && o.id === input.orderId);
      if (o && !TERMINAL.has(o.status) && !['delivered', 'stop_requested'].includes(o.status)) {
        const g = assertGrant(state, o);
        verifiedGrant = sha(canonical(g));
        for (const r of g.resources.filter(r => r.sourceRef)) {
          if (!resourceAdapter) fail('RESOURCE_ADAPTER_UNAVAILABLE', 'The native source adapter is not connected.', 503);
          await resourceAdapter.verify(r, { workspaceId: scope.workspaceId, projectId: scope.projectId, ref: r.ref }, {});
          workerIdentity(token);
        }
      }
    }
    return workerTransaction(token, action, input, verifiedGrant);
  }
  return {
    state: (sessionId, projectId) => readScope(browser(sessionId), projectId),
    review,
    command: (sessionId, input) => command(browser(sessionId), input),
    layout,
    toolRead: (input, execution) => { assertKeys(input, ['projectId']); return readScope(executionScope(execution), input.projectId); },
    toolCommand: (input, execution) => command(executionScope(execution), input),
    worker,
    close: () => { disposed = true; workerWindows.clear(); store.close(); },
  };
}
