import { capabilityPayloadHash as hash, goalDefinition } from './capabilities.mjs';
import { assessMarketValidation } from './market-validation-assessment.mjs';
import { validateResultAssessment } from '../packages/workspace-market-validation/src/plan.mjs';
import { ApiError } from './runtime.mjs';
import { productCohortMetrics, SUPPLIER_METRIC_DEFINITION } from './supplier-metrics.mjs';
import { validateProductTrafficObservation } from './product-traffic-contract.mjs';

const DAY = 86400000;
const KIND = 'market-validation-monitor';
const fail = (code, message, status = 409) => { throw new ApiError(status, code, message); };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const reference = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === (value.length === 20 ? value.slice(0, -1) + '.000Z' : value);
const gid = (kind, value) => typeof value === 'string' && new RegExp(`^gid://shopify/${kind}/\\d+$`).test(value);
const copy = value => structuredClone(value);
const outcomeKeys = mode => mode === 'b2b' ? ['qualifiedInquiries', 'quoteRequests', 'sampleRequests', 'orders'] : ['paidOrders', 'paidUnits', 'netPaidOrders', 'netPaidUnits', 'refundedUnits'];
const planAliases = { qualified_inquiries: 'qualifiedInquiries', quote_requests: 'quoteRequests', sample_requests: 'sampleRequests', b2b_orders: 'orders', visits: 'visits', add_to_cart: 'add_to_cart', checkouts: 'checkouts', net_paid_orders: 'netPaidOrders', net_paid_units: 'netPaidUnits', refunds: 'refunds' };
function measurement(scope, outcomes) {
  const metrics = Object.fromEntries(scope.requiredMetrics.map(metric => {
    const value = outcomes.metrics?.[planAliases[metric.id]];
    return [metric.id, { value: value ?? null, status: value == null ? outcomes.status === 'available' ? 'unsupported' : outcomes.status : outcomes.status,
      definition: metric.definition, sourceDefinition: outcomes.definition || null, sourceId: outcomes.sourceId || null,
      reason: value == null ? 'SELECTED_METRIC_NOT_MEASURED' : null, dataLagSeconds: outcomes.dataLagSeconds ?? null }];
  }));
  const gaps = Object.entries(metrics).filter(([, item]) => item.status !== 'available' || item.value === null).map(([metric, item]) => ({ metric, status: item.status, reason: item.reason }));
  return { metrics, status: gaps.length ? 'insufficient_evidence' : 'observed_not_adjudicated', gaps, goalVerified: false };
}
const semantic = value => Array.isArray(value) ? value.map(semantic) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['sampledAt', 'localDate', 'sampleKey', 'requestFingerprint', 'observedAt', 'diagnostics'].includes(key)).map(([key, item]) => [key, semantic(item)])) : value;
const unknown = (status, reason) => ({ status, value: null, reason });
function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fail('INVALID_INPUT', 'Use only the documented original references.', 400);
}
function receiptScope(receipt, request, clock) {
  if (!receipt || receipt.id !== request.launchReceiptId || receipt.planId !== request.planId || receipt.planRevision !== request.planRevision ||
      receipt.approved !== true || receipt.status !== 'launched' || receipt.evidenceKind !== 'real' || receipt.launchKind !== 'acquisition' ||
      !instant(receipt.startedAt) || Date.parse(receipt.startedAt) > clock() || !['b2b', 'b2c'].includes(receipt.businessMode) ||
      !gid('Product', receipt.productId) || !gid('Shop', receipt.shopId) || !reference(receipt.channelId) || !id(receipt.conversationId) ||
      !Array.isArray(receipt.variantIds) || receipt.variantIds.length > 250 || new Set(receipt.variantIds).size !== receipt.variantIds.length || receipt.variantIds.some(value => !gid('ProductVariant', value))) {
    fail('REAL_LAUNCH_RECEIPT_REQUIRED', 'An original approved acquisition launch receipt with a real start time is required.');
  }
  try { if (typeof receipt.timezone !== 'string') throw Error(); new Intl.DateTimeFormat('en', { timeZone: receipt.timezone }).format(); }
  catch { fail('LAUNCH_TIMEZONE_REQUIRED', 'The original launch needs a valid IANA timezone.'); }
  const allowed = receipt.businessMode === 'b2b' ? ['qualified_inquiries', 'quote_requests', 'sample_requests', 'b2b_orders'] : ['visits', 'add_to_cart', 'checkouts', 'net_paid_orders', 'net_paid_units', 'refunds'];
  const requiredMetrics = receipt.requiredMetrics ?? [{ id: receipt.businessMode === 'b2b' ? 'b2b_orders' : 'net_paid_units', definition: 'Exact-product/channel outcome cohort; compare against the original approved goal.' }];
  if (!Array.isArray(requiredMetrics) || !requiredMetrics.length || requiredMetrics.length > 10 || new Set(requiredMetrics.map(item => item.id)).size !== requiredMetrics.length || requiredMetrics.some(item => !allowed.includes(item.id) || typeof item.definition !== 'string' || !item.definition.trim() || item.definition.length > 2000)) fail('PLAN_METRICS_REQUIRED', 'Use the selected original plan metrics and definitions.');
  if (receipt.salesRequirement && (!requiredMetrics.some(item => item.id === receipt.salesRequirement.metric) || receipt.salesRequirement.target !== null && (!Number.isSafeInteger(receipt.salesRequirement.target) || receipt.salesRequirement.target < 0) || typeof receipt.salesRequirement.definition !== 'string')) fail('PLAN_METRICS_REQUIRED', 'Retain the original selected sales requirement.');
  let resultAssessment = null, marketBenchmark = null;
  if (receipt.resultAssessment != null) {
    try { validateResultAssessment(receipt.resultAssessment); } catch { fail('PLAN_METRICS_REQUIRED', 'Select an explicit assessment metric and comparable benchmark reference.'); }
    resultAssessment = copy(receipt.resultAssessment);
    if (resultAssessment.channelId !== receipt.channelId || (resultAssessment.metric === 'sales_units' ? resultAssessment.unit !== 'net_paid_units_per_168h' : resultAssessment.unit !== 'net_paid_orders_per_valid_visit')) fail('PLAN_METRICS_REQUIRED', 'Assessment units and acquisition channel must match.');
  }
  if (receipt.marketBenchmark != null) {
    const b = receipt.marketBenchmark, keys = ['sourceId', 'evidenceRef', 'metric', 'category', 'region', 'channelId', 'unit', 'windowHours', 'value', 'observedAt', 'evidenceKind', 'reviewed', 'validVisitDefinition', 'coverage'];
    if (typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(b, k))
      || !['sourceId', 'evidenceRef', 'metric', 'category', 'region', 'channelId', 'unit'].every(k => reference(b[k])) || typeof b.validVisitDefinition !== 'string' || !b.validVisitDefinition.trim() || b.validVisitDefinition.length > 2000 || !instant(b.observedAt)
      || !b.coverage || Object.keys(b.coverage).length !== 2 || !instant(b.coverage.from) || !instant(b.coverage.to)
      || Date.parse(b.coverage.to) - Date.parse(b.coverage.from) !== 168 * 3600000 || Date.parse(b.coverage.to) > Date.parse(receipt.startedAt) || Date.parse(b.observedAt) < Date.parse(b.coverage.to)
      || !Number.isFinite(b.value) || b.value <= 0 || b.evidenceKind !== 'real' || b.reviewed !== true || b.windowHours !== 168) fail('BENCHMARK_EVIDENCE_INVALID', 'Use a reviewed original benchmark with explicit comparable dimensions.');
    marketBenchmark = copy(b);
  }
  let baseline = { status: 'unavailable', reason: 'NO_VERIFIED_PRELAUNCH_BASELINE', value: null };
  if (receipt.baseline != null) {
    const source = receipt.baseline;
    if (source.status !== 'available' || !reference(source.sourceId) || !reference(source.evidenceRef) || source.productId !== receipt.productId || source.shopId !== receipt.shopId || source.channelId !== receipt.channelId
      || source.businessMode !== receipt.businessMode || !Array.isArray(source.variantIds) || hash([...source.variantIds].sort()) !== hash([...receipt.variantIds].sort())
      || !instant(source.observedAt) || Date.parse(source.observedAt) > clock() || !instant(source.coverage?.from) || !instant(source.coverage?.to)
      || Date.parse(source.coverage.from) >= Date.parse(source.coverage.to) || Date.parse(source.coverage.to) > Date.parse(receipt.startedAt)
      || Date.parse(source.observedAt) < Date.parse(source.coverage.to) || !source.metrics || Object.keys(source.metrics).some(key => !allowed.includes(key))
      || !Object.keys(source.metrics).length || Object.values(source.metrics).some(item => !item || !Number.isSafeInteger(item.value) || item.value < 0 || typeof item.definition !== 'string' || !item.definition.trim())) fail('BASELINE_EVIDENCE_INVALID', 'Baseline requires an original exact-product/channel source and a prelaunch window.');
    baseline = { status: 'available', sourceId: source.sourceId, evidenceRef: source.evidenceRef, observedAt: source.observedAt,
      coverage: { from: source.coverage.from, to: source.coverage.to }, metrics: Object.fromEntries(Object.entries(source.metrics).map(([key, item]) => [key, { value: item.value, definition: item.definition }])) };
  }
  return { planId: receipt.planId, planRevision: receipt.planRevision, launchReceiptId: receipt.id,
    productId: receipt.productId, variantIds: [...receipt.variantIds].sort(), shopId: receipt.shopId,
    channelId: receipt.channelId, businessMode: receipt.businessMode, conversationId: receipt.conversationId,
    timezone: receipt.timezone, startAt: new Date(receipt.startedAt).toISOString(), endAt: new Date(Date.parse(receipt.startedAt) + 7 * DAY).toISOString(),
    windowDefinition: '168 elapsed hours from the real approved acquisition launch; local dates are display labels',
    requiredMetrics: requiredMetrics.map(item => ({ id: item.id, definition: item.definition })),
    salesRequirement: receipt.salesRequirement ? { metric: receipt.salesRequirement.metric, target: receipt.salesRequirement.target, definition: receipt.salesRequirement.definition } : null,
    baseline, ...(resultAssessment ? { resultAssessment } : {}), ...(marketBenchmark ? { marketBenchmark } : {}) };
}

// This validates an already authorized source, not its authorization. The Host
// owns the reviewed adapter and its original source records; callers cannot inject it.
function outcomeObservation(value, scope, adapterId) {
  const keys = [...outcomeKeys(scope.businessMode), ...(scope.businessMode === 'b2c' ? ['visits', 'add_to_cart', 'checkouts', 'refunds'] : [])];
  if (!value || value.productId !== scope.productId || value.shopId !== scope.shopId || value.channelId !== scope.channelId ||
      !Array.isArray(value.variantIds) || hash(value.variantIds) !== hash(scope.variantIds) ||
      value.businessMode !== scope.businessMode || value.from !== scope.from || value.to !== scope.to || value.sourceId !== adapterId ||
      !['available', 'partial', 'delayed', 'unconfigured', 'unavailable', 'no_data'].includes(value.status) || !instant(value.sampledAt) ||
      Date.parse(value.sampledAt) > scope.now || typeof value.definition !== 'string' || !value.definition.trim() || value.definition.length > 2000 ||
      value.dataLagSeconds !== null && (!Number.isFinite(value.dataLagSeconds) || value.dataLagSeconds < 0) ||
      !value.metrics || !Object.keys(value.metrics).length || Object.keys(value.metrics).some(key => !keys.includes(key))) {
    fail('OUTCOME_OBSERVATION_INVALID', 'Outcomes need exact product/channel identity, metric definitions, window and freshness.', 502);
  }
  for (const count of Object.values(value.metrics)) {
    if (count !== null && (!Number.isSafeInteger(count) || count < 0 || !['available', 'partial', 'delayed'].includes(value.status))) fail('OUTCOME_OBSERVATION_INVALID', 'Missing data cannot be recorded as zero.', 502);
    if (value.status === 'available' && count === null) fail('OUTCOME_OBSERVATION_INVALID', 'Available outcomes require complete measured counts.', 502);
  }
  if (value.status === 'available' && (Date.parse(value.sampledAt) < Date.parse(scope.to) || value.dataLagSeconds !== 0)) fail('OUTCOME_OBSERVATION_INVALID', 'Complete outcomes must acknowledge the full requested cutoff without lag.', 502);
  if (scope.businessMode === 'b2c') for (const [net, gross] of [['netPaidOrders', 'paidOrders'], ['netPaidUnits', 'paidUnits'], ['refundedUnits', 'paidUnits']]) {
    if (value.metrics[net] != null && value.metrics[gross] != null && value.metrics[net] > value.metrics[gross]) fail('OUTCOME_OBSERVATION_INVALID', 'Net or refunded cohort counts cannot exceed the acknowledged paid cohort.', 502);
  }
  let resultEvidence;
  if (value.resultEvidence != null) {
    const e = value.resultEvidence;
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k => !['evidenceKind', 'evidenceRef', 'paymentStatus', 'coverageRatio', 'validVisits', 'qualifiedInquiries', 'validVisitDefinition'].includes(k))
      || (typeof e.validVisitDefinition !== 'string' || !e.validVisitDefinition.trim() || e.validVisitDefinition.length > 2000) || e.evidenceKind !== 'real' || !reference(e.evidenceRef) || e.paymentStatus !== 'net_paid_verified'
      || !Number.isFinite(e.coverageRatio) || e.coverageRatio < 0 || e.coverageRatio > 1
      || !['validVisits', 'qualifiedInquiries'].every(k => e[k] === null || Number.isSafeInteger(e[k]) && e[k] >= 0)) fail('OUTCOME_OBSERVATION_INVALID', 'Result evidence requires reviewed net payment, valid traffic counts and coverage.');
    resultEvidence = copy(e);
  }
  return { ...(resultEvidence ? { resultEvidence } : {}), status: value.status, sourceId: adapterId, sampledAt: value.sampledAt, dataLagSeconds: value.dataLagSeconds,
    definition: value.definition, metrics: copy(value.metrics), attribution: 'exact_product_and_channel', coverage: { from: scope.from, to: scope.to } };
}

export async function createMarketValidationMonitor({ store, runtime, capabilities, shopify = null,
  resolveLaunchReceipt = null, authorizeOwner = null, clock = Date.now, trafficAdapter = null, outcomeAdapter = null }) {
  if (trafficAdapter && (trafficAdapter.contractVersion !== 2 || trafficAdapter.productAttribution !== 'exact_product_id' || typeof trafficAdapter.readProductTraffic !== 'function' || !reference(trafficAdapter.id))) throw new TypeError('Use the existing exact-product traffic v2 adapter.');
  if (outcomeAdapter && (outcomeAdapter.authorizationReviewed !== true || typeof outcomeAdapter.readOutcomes !== 'function' || !reference(outcomeAdapter.id))) throw new TypeError('Use an existing Host-reviewed outcome source.');
  const now = () => new Date(clock()).toISOString();
  const jobs = new Map(), creations = new Map(); let closing = false;
  const taskFor = (state, goalId) => {
    const goal = state.goals.find(row => row.id === goalId);
    if (goal?.serviceTask?.kind !== KIND || !goal.marketValidationMonitor) fail('MONITOR_NOT_FOUND', 'The original monitoring task was not found.', 404);
    return { goal, task: goal.marketValidationMonitor };
  };
  function owner(state, actor) {
    if (!actor || !reference(actor.subject) || !reference(actor.workspaceId) || typeof authorizeOwner !== 'function' || authorizeOwner(state, actor) !== true) fail('MONITOR_AUTHORIZATION_REQUIRED', 'Current original member permission is required.', 403);
  }
  function owned(state, actor, goalId) {
    owner(state, actor); const value = taskFor(state, goalId);
    if (value.task.subject !== actor.subject || value.task.workspaceId !== actor.workspaceId) fail('MONITOR_NOT_FOUND', 'The original monitoring task was not found.', 404);
    ownedSource(state, actor, value.task.scope.conversationId);
    return value;
  }
  function ownedSource(state, actor, conversationId) {
    const source = state.conversations.find(row => row.id === conversationId), sourceOwner = source?.businessAgentOwner || source?.piTaskOwner;
    if (!source || (sourceOwner ? sourceOwner.subject !== actor.subject || sourceOwner.workspaceId !== actor.workspaceId : source.createdBy !== actor.subject || source.workspaceId !== actor.workspaceId)) fail('MONITOR_SOURCE_OWNER_REQUIRED', 'Use the actual member\'s original source conversation.', 403);
    return source;
  }
  function active(state, actor, goalId) {
    const result = owned(state, actor, goalId);
    if (['cancelled', 'paused'].includes(result.goal.status) || ['cancelled', 'paused'].includes(result.task.status)) fail('MONITOR_STOPPED', 'The original task is paused or cancelled.');
    return result;
  }
  async function launch(actor, request, signal) {
    signal?.throwIfAborted();
    owner(store.read(), actor);
    if (typeof resolveLaunchReceipt !== 'function') fail('REAL_LAUNCH_RECEIPT_REQUIRED', 'The original launch receipt reader is not connected.');
    const receipt = await resolveLaunchReceipt({ actor: copy(actor), planId: request.planId, planRevision: request.planRevision, launchReceiptId: request.launchReceiptId, ...(signal ? { signal } : {}) });
    signal?.throwIfAborted(); return receiptScope(receipt, request, clock);
  }
  function projection(state, goalId) {
    const { goal, task } = taskFor(state, goalId), schedule = state.capabilities.schedules.find(row => row.id === task.scheduleId);
    return { goalId, goalStatus: goal.status, taskConversationId: goal.conversationId, scheduleId: task.scheduleId, scopeHash: task.scopeHash, ...copy(task.scope), status: ['paused', 'cancelled'].includes(goal.status) ? goal.status : task.status,
      scheduleEnabled: schedule?.enabled === true, scheduleStatus: schedule?.status || 'not_created', modelRequired: false,
      observations: copy(task.observations), summary: copy(task.summary), missedDays: copy(task.missedDays) };
  }
  // State is in the original durable Goal. Routing metadata is immutable because
  // it is part of the original schedule's approved goalDefinition hash.
  await store.update(state => { for (const goal of state.goals) if (goal.serviceTask?.kind === KIND) {
    for (const record of goal.marketValidationMonitor.observations) if (record.status === 'reading') { record.status = 'interrupted'; record.error = 'OBSERVATION_INTERRUPTED'; }
  } });
  const unsubscribe = store.subscribe(() => { for (const job of jobs.values()) {
    try { active(store.read(), job.actor, job.goalId); } catch { job.controller.abort('MONITOR_STOPPED'); }
  } });

  async function create(actor, body, route = {}, proposal = false) {
    fields(body, proposal ? ['requestId', 'planId', 'planRevision', 'launchReceiptId'] : ['requestId', 'planId', 'planRevision', 'launchReceiptId', 'confirmed']);
    route.signal?.throwIfAborted();
    if (!id(body.requestId) || !reference(body.planId) || !reference(body.launchReceiptId) || !Number.isSafeInteger(body.planRevision) || body.planRevision < 1) fail('INVALID_INPUT', 'Use stable original plan and launch references.', 400);
    if (closing) fail('SHUTTING_DOWN', 'Monitoring is closing.', 503);
    const scope = await launch(actor, body, route.signal), scopeHash = hash(scope);
    route.signal?.throwIfAborted();
    owner(store.read(), actor);
    if (route.sourceConversationId !== undefined && route.sourceConversationId !== scope.conversationId) fail('MONITOR_SOURCE_OWNER_REQUIRED', 'The receipt must belong to this original source conversation.', 403);
    const source = ownedSource(store.read(), actor, scope.conversationId);
    const linked = !!(source.businessAgentOwner || source.piTaskOwner);
    if (linked && !proposal && body.confirmed !== true) fail('MONITOR_CONFIRMATION_REQUIRED', 'Explicitly confirm creating the linked original service-only task.', 400);
    const key = hash([actor.workspaceId, actor.subject, body.launchReceiptId, body.planId, body.planRevision]);
    if (creations.has(key)) { await creations.get(key); return create(actor, body, route, proposal); }
    const work = (async () => {
      // The same real launch always maps to one original task, even when the
      // client retries with a different transport requestId after restarting.
      const serviceTaskContext = linked ? { kind: KIND, scopeHash, sourceConversationId: scope.conversationId, subject: actor.subject, workspaceId: actor.workspaceId, modelRequired: false } : null;
      const taskAdmission = serviceTaskContext ? { serviceTaskContext, authorizeServiceTask: state => { route.signal?.throwIfAborted(); owner(state, actor); return true; } } : {};
      const taskConversationId = linked ? (await runtime.createConversation({ title: '七天市场验证观察任务', requestId: `market-context-${key}` }, actor, taskAdmission)).conversation.id : scope.conversationId;
      const { goal } = await runtime.createGoal({ requestId: `market-monitor-${key}`, title: '七天市场验证观察', description: JSON.stringify(scope), conversationId: taskConversationId, maxSteps: 1, maxOutputTokens: 1600 }, taskAdmission);
      await store.update(state => {
        route.signal?.throwIfAborted(); owner(state, actor); const current = state.goals.find(row => row.id === goal.id);
        if (current.marketValidationMonitor) { if (current.marketValidationMonitor.scopeHash !== scopeHash) fail('LAUNCH_SCOPE_CHANGED', 'The original launch scope changed.'); return; }
        current.serviceTask = { kind: KIND, scopeHash, modelRequired: false };
        current.marketValidationMonitor = { subject: actor.subject, workspaceId: actor.workspaceId, scope, scopeHash,
          status: 'ready', createdAt: now(), scheduleId: null, observations: [], summary: null, missedDays: [],
          sourceBinding: { shopify: shopify?.fingerprint || null, traffic: trafficAdapter?.id || null, outcome: outcomeAdapter?.id || null },
          scheduledAt: new Date(Math.max(clock() + 1000, Date.parse(scope.startAt) + DAY)).toISOString() };
      });
      const { task } = owned(store.read(), actor, goal.id);
      if (!task.scheduleId) {
        // createSchedule deduplicates its stable requestId even after a crash
        // between its durable commit and recording the original scheduleId.
        const requestId = `market-schedule-${key}`;
        if (!store.read().capabilities.schedules.some(row => row.requestId === requestId) && Date.parse(task.scheduledAt) <= clock()) await store.update(state => { owned(state, actor, goal.id).task.scheduledAt = new Date(clock() + 1000).toISOString(); });
        const { schedule } = await capabilities.createSchedule({ requestId, title: '七天市场验证每日观察', goalId: goal.id, kind: 'every', everySeconds: 86400, scheduledAt: taskFor(store.read(), goal.id).task.scheduledAt });
        await store.update(state => { const current = owned(state, actor, goal.id); current.task.scheduleId = schedule.id; current.goal.serviceTask.scheduleId = schedule.id; });
      }
      return projection(store.read(), goal.id);
    })();
    creations.set(key, work);
    try { return await work; } finally { creations.delete(key); }
  }

  async function collect(scope, binding, signal, requestId) {
    const sample = { sampledAt: now(), coverage: { from: scope.from, to: scope.to }, productId: scope.productId, channelId: scope.channelId,
      localDate: new Intl.DateTimeFormat('en-CA', { timeZone: scope.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(clock())),
      cohort: unknown(shopify?.status().configured ? 'unavailable' : 'unconfigured', 'SHOPIFY_SETUP_REQUIRED'),
      traffic: unknown(trafficAdapter ? 'unavailable' : 'unconfigured', 'PRODUCT_TRAFFIC_SOURCE_NOT_CONFIGURED'),
      outcomes: { ...unknown(outcomeAdapter ? 'unavailable' : 'unconfigured', scope.businessMode === 'b2b' ? 'B2B_OUTCOME_SOURCE_NOT_CONFIGURED' : 'PAID_OUTCOME_SOURCE_NOT_CONFIGURED'),
        metrics: Object.fromEntries(outcomeKeys(scope.businessMode).map(key => [key, null])) },
      funnel: { sessions: unknown('unsupported', 'PRODUCT_DETAIL_VIEW_EVENTS_ARE_NOT_SESSIONS'),
        addToCarts: unknown('unconfigured', 'EXACT_PRODUCT_CART_SOURCE_NOT_CONFIGURED'), checkouts: unknown('unconfigured', 'EXACT_PRODUCT_CHECKOUT_SOURCE_NOT_CONFIGURED') }, errors: [] };
    if (shopify?.status().configured) try {
      if (binding.shopify !== shopify.fingerprint) fail('SHOPIFY_SCOPE_CHANGED', 'The original Shopify binding changed.');
      await shopify.verify();
      const product = await shopify.readProductPublication({ productId: scope.productId, signal });
      if (product.shopId !== scope.shopId || scope.variantIds.some(value => !product.variantIds.includes(value))) fail('SHOPIFY_SCOPE_CHANGED', 'The original product or shop changed.');
      const orders = [], cursors = new Set(); let after = null;
      do {
        const page = await shopify.readProductOrders({ productId: scope.productId, from: scope.from, to: scope.to, after, signal });
        if (page.shopId !== scope.shopId) fail('SHOPIFY_SCOPE_CHANGED', 'The order source shop changed.');
        orders.push(...page.orders); if (orders.length > 2500) fail('SHOPIFY_ORDERS_INCOMPLETE', 'The bounded complete-pagination limit was exceeded.');
        after = page.nextCursor;
        if (after && cursors.has(after)) fail('SHOPIFY_ORDERS_INCOMPLETE', 'Order pagination repeated a cursor.');
        if (after) cursors.add(after);
      } while (after && !signal.aborted);
      if (signal.aborted) throw Error('aborted');
      sample.cohort = { status: 'available', quantities: productCohortMetrics(orders, scope), sourceId: 'shopify_admin_orders_2026-10',
        definition: SUPPLIER_METRIC_DEFINITION, dataLagSeconds: null, freshness: 'unknown', attribution: 'exact_product_all_channels', paidStatus: 'unsupported' };
    } catch (error) { sample.cohort = unknown('unavailable', 'SHOPIFY_READ_FAILED'); sample.errors.push({ source: 'shopify', code: error.code || 'SOURCE_READ_FAILED' }); }
    if (trafficAdapter) try {
      if (binding.traffic !== trafficAdapter.id) fail('TRAFFIC_SCOPE_CHANGED', 'The original traffic adapter changed.');
      const status = shopify?.status();
      if (!status?.shop || status.shop.id !== scope.shopId) fail('SHOPIFY_IDENTITY_REQUIRED', 'Traffic needs the verified original shop identity.');
      const input = { workspaceId: scope.workspaceId, shopId: scope.shopId, shopDomain: status.shop.domain,
        productId: scope.productId, from: scope.from, to: scope.to, sampleKey: `market-check:${hash([scope.goalId, requestId])}`, signal };
      sample.traffic = validateProductTrafficObservation(await trafficAdapter.readProductTraffic(input), { ...input, adapterId: trafficAdapter.id });
    } catch (error) { sample.traffic = unknown('unavailable', 'TRAFFIC_READ_FAILED'); sample.errors.push({ source: 'traffic', code: error.code || 'SOURCE_READ_FAILED' }); }
    if (outcomeAdapter) try {
      if (binding.outcome !== outcomeAdapter.id) fail('OUTCOME_SCOPE_CHANGED', 'The original outcome adapter changed.');
      sample.outcomes = outcomeObservation(await outcomeAdapter.readOutcomes({ ...scope, signal }), { ...scope, now: clock() }, outcomeAdapter.id);
    } catch (error) { sample.outcomes.reason = 'OUTCOME_READ_FAILED'; sample.errors.push({ source: 'outcomes', code: error.code || 'SOURCE_READ_FAILED' }); }
    sample.measurement = measurement(scope, sample.outcomes);
    sample.sampledAt = now(); return sample;
  }

  async function observe(actor, body, scheduleClaim = null) {
    fields(body, ['goalId', 'requestId', 'expectedScopeHash', 'confirmed']);
    if (!id(body.requestId) || body.confirmed !== true) fail('MONITOR_CONFIRMATION_REQUIRED', 'Confirm the exact original read-only observation scope.', 400);
    if (closing) fail('SHUTTING_DOWN', 'Monitoring is closing.', 503);
    const { task } = active(store.read(), actor, body.goalId);
    if (task.scopeHash !== body.expectedScopeHash) fail('MONITOR_SCOPE_CHANGED', 'Confirm the original scope hash.');
    if (hash(await launch(actor, task.scope)) !== task.scopeHash) fail('LAUNCH_SCOPE_CHANGED', 'Reconcile the original launch receipt.');
    const prior = task.observations.find(row => row.requestId === body.requestId);
    if (prior?.status === 'complete') return { observation: copy(prior), summary: copy(task.summary), duplicate: true };
    const key = hash([body.goalId, body.requestId]);
    if (jobs.has(key)) return jobs.get(key).promise;
    const controller = new AbortController();
    const promise = (async () => {
      const record = await store.update(state => {
        const { task: current } = active(state, actor, body.goalId);
        let row = current.observations.find(item => item.requestId === body.requestId);
        if (!row) {
          if (current.observations.length >= 100) fail('MONITOR_CAPACITY_LIMIT', 'Review the existing bounded observation history.');
          row = { requestId: body.requestId, status: 'reading', ordinal: current.observations.length + 1,
            from: current.scope.startAt, to: new Date(Math.min(clock(), Date.parse(current.scope.endAt))).toISOString(),
            dueAt: scheduleClaim?.dueAt || null, admittedAt: now() };
          if (Date.parse(row.to) <= Date.parse(row.from)) fail('MONITOR_NOT_STARTED', 'The real observation interval has no elapsed time.');
          current.observations.push(row);
        }
        row.status = 'reading'; row.error = null; return copy(row);
      });
      try {
        const scope = { ...task.scope, from: record.from, to: record.to, workspaceId: actor.workspaceId, goalId: body.goalId };
        const sample = await collect(scope, task.sourceBinding, controller.signal, body.requestId);
        if (hash(await launch(actor, task.scope)) !== task.scopeHash) fail('LAUNCH_SCOPE_CHANGED', 'The original launch authorization changed during observation.');
        if (controller.signal.aborted || closing) fail('OBSERVATION_INTERRUPTED', 'Reconcile the original frozen observation after recovery.');
        return await store.update(state => {
          const { goal, task: current } = active(state, actor, body.goalId), row = current.observations.find(item => item.requestId === body.requestId);
          if (scheduleClaim) validateClaim(state, scheduleClaim);
          Object.assign(row, { status: 'complete', sample, finishedAt: now() });
          const latest = current.observations.filter(item => item.status === 'complete').sort((a, b) => Date.parse(b.to) - Date.parse(a.to) || b.ordinal - a.ordinal)[0];
          if (latest.requestId === row.requestId) {
            current.status = row.to === current.scope.endAt ? 'window_ended' : 'observing';
            // Missing days remain gaps. A catch-up read is a cumulative cohort,
            // never seven invented daily observations after downtime.
            const elapsed = Math.min(7, Math.floor((Date.parse(row.to) - Date.parse(row.from)) / DAY));
            current.missedDays = Array.from({ length: elapsed }, (_, index) => index + 1).filter(day => !current.observations.some(item => item.status === 'complete' && Math.ceil((Date.parse(item.to) - Date.parse(item.from)) / DAY) === day));
            if (row.to === current.scope.endAt) {
              const provisional = sample.measurement.status === 'insufficient_evidence';
              const content = { startAt: current.scope.startAt, endAt: current.scope.endAt, timezone: current.scope.timezone,
                businessMode: current.scope.businessMode, productId: current.scope.productId, channelId: current.scope.channelId,
                baseline: copy(current.scope.baseline),
                assessment: assessMarketValidation({ scope: current.scope, sample, windowComplete: true }),
                requiredMetrics: copy(current.scope.requiredMetrics), measurement: copy(sample.measurement), goalVerified: false,
                sample, missedDays: copy(current.missedDays), provisional, sampleSize: sample.outcomes.metrics || null,
                recommendation: provisional ? 'adjust_measurement' : 'review_evidence_against_approved_plan',
                limitations: ['No guarantee of sales, profit or statistical significance.', 'Zero measured orders alone does not establish no market.', 'Shopify quantities span channels and do not prove payment or acquisition attribution.', 'Unknown baseline, consent omissions and source delay are not reconstructed.'] };
              // A summary is the same original message; late corrections do not
              // send external notifications or start another seven-day window.
              const contentHash = hash(semantic(content)), old = current.summary;
              current.summary = { ...content, contentHash, revision: old?.contentHash === contentHash ? old.revision : (old?.revision || 0) + 1,
                messageId: `market-summary-${goal.id}`, corrected: !!old && old.contentHash !== contentHash };
              let message = state.messages.find(item => item.id === current.summary.messageId);
              if (!message) { message = { id: current.summary.messageId, conversationId: goal.conversationId, role: 'assistant', source: KIND, status: 'complete', createdAt: now(), goalId: goal.id }; state.messages.push(message); }
              message.content = JSON.stringify(current.summary);
              goal.output = JSON.stringify(current.summary); goal.status = 'review_required'; goal.updatedAt = now();
              const schedule = state.capabilities.schedules.find(item => item.id === current.scheduleId);
              if (schedule) { schedule.enabled = false; schedule.consent = null; schedule.status = 'ended'; }
            }
          }
          return { observation: copy(row), summary: copy(current.summary), duplicate: false };
        });
      } catch (error) {
        await store.update(state => { const row = taskFor(state, body.goalId).task.observations.find(item => item.requestId === body.requestId); if (row?.status === 'reading') { row.status = 'interrupted'; row.error = error.code || 'OBSERVATION_INTERRUPTED'; } });
        throw error;
      }
    })();
    jobs.set(key, { promise, controller, actor: copy(actor), goalId: body.goalId });
    try { return await promise; } finally { jobs.delete(key); }
  }
  function validateClaim(state, args) {
    const { goal, task } = taskFor(state, args.goalId), claim = args.scheduleClaim;
    const schedule = state.capabilities.schedules.find(row => row.id === task.scheduleId), record = state.capabilities.scheduleRuns.find(row => row.id === claim?.id);
    if (!schedule?.enabled || !schedule.consent || !claim || schedule.id !== claim.scheduleId || schedule.revision !== claim.scheduleRevision ||
        record?.status !== 'dispatching' || record.scheduleId !== schedule.id || record.scheduleRevision !== schedule.revision ||
        record.goalId !== goal.id || claim.goalId !== goal.id || record.requestId !== args.requestId || claim.requestId !== args.requestId ||
        goal.serviceTask.scopeHash !== task.scopeHash || record.expectedGoalDefinitionHash !== args.expectedGoalDefinitionHash ||
        schedule.consent.definitionHash !== args.expectedGoalDefinitionHash || hash(goalDefinition(goal, state)) !== args.expectedGoalDefinitionHash) fail('SCHEDULE_CLAIM_RETIRED', 'Only the original current approved ScheduleRun may dispatch this task.');
  }
  return {
    forActor(actor) { actor = { subject: actor?.subject, workspaceId: actor?.workspaceId, ...(actor?.role ? { role: actor.role } : {}), sessionId: actor?.session?.id || actor?.sessionId || null }; return {
      create: (body, route) => create(actor, body, route),
      // Host-only proposal: creates draft Goal/disabled Schedule; no consent,
      // collection or enable action is available through this method.
      propose: (body, route) => create(actor, body, route, true),
      list(sourceConversationId) { const state = store.read(); owner(state, actor); ownedSource(state, actor, sourceConversationId); return state.goals.filter(goal => goal.serviceTask?.kind === KIND && goal.marketValidationMonitor?.scope.conversationId === sourceConversationId && goal.marketValidationMonitor.subject === actor.subject && goal.marketValidationMonitor.workspaceId === actor.workspaceId).map(goal => projection(state, goal.id)); },
      get(goalId) { owned(store.read(), actor, goalId); return projection(store.read(), goalId); },
      observe: body => observe(actor, body),
      async control(body) {
        fields(body, ['goalId', 'action', 'expectedScopeHash', 'confirmed']);
        const { task } = owned(store.read(), actor, body.goalId);
        if (closing) fail('SHUTTING_DOWN', 'Monitoring is closing.', 503);
        if (body.expectedScopeHash !== task.scopeHash || body.confirmed !== true || !['pause', 'resume', 'cancel'].includes(body.action)) fail('MONITOR_SCOPE_CHANGED', 'Confirm the exact task and control action.');
        if (body.action === 'resume' && (task.status === 'cancelled' || taskFor(store.read(), body.goalId).goal.status === 'cancelled')) fail('MONITOR_CANCELLED', 'A cancelled task cannot resume.');
        if (body.action === 'resume' && clock() >= Date.parse(task.scope.endAt)) fail('MONITOR_WINDOW_ENDED', 'The real seven-day window cannot be extended by resuming.');
        if (body.action === 'resume') {
          if (hash(await launch(actor, task.scope)) !== task.scopeHash) fail('LAUNCH_SCOPE_CHANGED', 'Reconcile the original launch receipt.');
          if (task.scheduleId) await capabilities.disableSchedule(task.scheduleId);
          await store.update(state => { const { goal, task: current } = owned(state, actor, body.goalId); if (current.status === 'cancelled' || goal.status === 'cancelled') fail('MONITOR_CANCELLED', 'A cancelled task cannot resume.'); current.status = 'ready'; goal.status = 'draft'; });
        } else {
          await store.update(state => { const { goal, task: current } = owned(state, actor, body.goalId); if (current.status === 'cancelled') return; current.status = body.action === 'cancel' ? 'cancelled' : 'paused'; goal.status = current.status; });
          if (task.scheduleId) await capabilities.disableSchedule(task.scheduleId);
        }
        return projection(store.read(), body.goalId);
      },
    }; },
    async dispatch(args) {
      validateClaim(store.read(), args);
      const { task } = taskFor(store.read(), args.goalId), actor = { subject: task.subject, workspaceId: task.workspaceId };
      const result = await observe(actor, { goalId: args.goalId, requestId: args.requestId, expectedScopeHash: task.scopeHash, confirmed: true }, args);
      return { status: 'completed', serviceReceipt: { goalId: args.goalId, requestId: args.requestId, sampledAt: result.observation.sample.sampledAt,
        outcomeStatus: result.observation.sample.outcomes.status, modelRequired: false, readOnly: true } };
    },
    async close() { closing = true; unsubscribe(); for (const job of jobs.values()) job.controller.abort('SHUTDOWN'); await Promise.allSettled([...jobs.values()].map(job => job.promise)); await Promise.allSettled([...creations.values()]); },
  };
}
