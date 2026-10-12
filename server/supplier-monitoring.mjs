import { randomUUID } from 'node:crypto';
import { goalDefinition, capabilityPayloadHash } from './capabilities.mjs';
import { supplierFail, supplierHash } from './supplier-profile.mjs';
import { supplierFind, supplierRegistry, supplierRequest } from './supplier-draft.mjs';
import { productCohortMetrics, SUPPLIER_METRIC_DEFINITION } from './supplier-metrics.mjs';
import { PRODUCT_TRAFFIC_DEFINITIONS, validateProductTrafficObservation } from './product-traffic-contract.mjs';

const DAY = 86400000;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export async function createSupplierMonitoring({ store, runtime, capabilities, shopify, clock = Date.now, trafficAdapter = null, notifications = null, authorizeOwner = null }) {
  const trafficV2 = trafficAdapter?.contractVersion === 2;
  if (trafficAdapter && (!trafficV2 && trafficAdapter.authorizationReviewed !== true || trafficAdapter.productAttribution !== 'exact_product_id' || typeof trafficAdapter.readProductTraffic !== 'function' || typeof trafficAdapter.id !== 'string')) throw new TypeError('Only an existing reviewed exact-product traffic adapter may be injected. No analytics permission is acquired by this service.');
  const now = () => new Date(clock()).toISOString(), inFlight = new Map(); let closing = false;
  if (store.read().workspaceSupplierServices?.monitors.some(row => row.checks.some(check => check.status === 'checking'))) await store.update(state => { for (const row of supplierRegistry(state).monitors) for (const check of row.checks) if (check.status === 'checking') { check.status = 'interrupted'; check.error = { code: 'SERVICE_CHECK_INTERRUPTED' }; } });
  const unsubscribe = store.subscribe(() => { for (const [key, job] of inFlight) { const state = store.read(), monitor = (state.workspaceSupplierServices?.monitors || []).find(item => item.id === key.slice(0, key.indexOf(':'))), service = state.workspaceSupplierServices?.services.find(item => item.id === monitor?.serviceId); if (monitor?.stoppedAt || service?.cancelledAt || service?.rejectedAt || monitor && authorizeOwner && !authorizeOwner(state, monitor)) job.controller.abort('ORIGINAL_MONITOR_STOPPED'); } });
  function lookup(state, actor, cid, sid, id) { supplierFind(state, actor, cid, sid); const row = (state.workspaceSupplierServices?.monitors || []).find(item => item.id === id && item.serviceId === sid && item.subject === actor.subject && item.workspaceId === actor.workspaceId); if (!row) supplierFail(404, 'SUPPLIER_MONITOR_NOT_FOUND', 'The original product monitor was not found.'); return row; }
  function projection(row) { const schedule = store.read().capabilities.schedules.find(item => item.id === row.scheduleId); const { notificationSubscriptions, notificationChallenges, notificationReviews, notificationExecution, firstNotificationExecution, firstNotificationReviewId, firstSampleNotification, externalNotification, ...publicRow } = structuredClone(row); return { ...publicRow, ...(notifications ? { notification: notifications.projection(row) } : {}), scheduleEnabled: schedule?.enabled === true, metricDefinition: SUPPLIER_METRIC_DEFINITION, externalNotifications: notifications?.status().status === 'configured' ? 'configured' : 'not_configured', productTrafficAdapterConfigured: !!trafficAdapter, productTrafficAvailable: row.latestSample?.trafficStatus === 'available', productTrafficContractVersion: row.scope.trafficContractVersion || 1, productDetailViewEventsAvailable: row.latestSample?.traffic?.contractVersion === 2 && row.latestSample.traffic.metrics.productDetailViews.value !== null, productTrafficDefinition: row.scope.trafficContractVersion === 2 ? PRODUCT_TRAFFIC_DEFINITIONS.productDetailViews : null }; }
  async function check(id, requestId, fingerprint) {
    if (closing) supplierFail(503, 'SHUTTING_DOWN', 'Supplier monitoring is closing.');
    const prior = (store.read().workspaceSupplierServices?.monitors || []).find(item => item.id === id)?.checks.find(item => item.requestId === requestId);
    if (prior?.fingerprint !== undefined && prior.fingerprint !== fingerprint) supplierFail(409, 'IDEMPOTENCY_CONFLICT', 'This original monitor request names a different exact check.');
    if (prior?.status === 'complete') return { sample: prior.sample, duplicate: true };
    const key = id + ':' + requestId;
    if (inFlight.has(key)) return inFlight.get(key).promise;
    const controller = new AbortController();
    const promise = (async () => {
      const claim = await store.update(state => { const monitor = supplierRegistry(state).monitors.find(item => item.id === id); if (monitor && authorizeOwner && !authorizeOwner(state, monitor)) supplierFail(403, 'SUPPLIER_MONITOR_AUTHORIZATION_REQUIRED', 'The original current member permission was revoked.'); const service = state.workspaceSupplierServices?.services.find(item => item.id === monitor?.serviceId); if (service?.cancelledAt || service?.rejectedAt) supplierFail(409, 'SUPPLIER_MONITOR_STOPPED', 'The original supplier intake was cancelled.'); if (!monitor || monitor.stoppedAt) supplierFail(409, 'SUPPLIER_MONITOR_STOPPED', 'The original monitor is stopped.');
        let record = monitor.checks.find(item => item.requestId === requestId);
        if (!record) { if (monitor.checks.length >= 100) supplierFail(409, 'SUPPLIER_CAPACITY_LIMIT', 'Retain and review the original monitoring check history.'); record = { requestId, fingerprint, ordinal: monitor.checks.length + 1, status: 'checking', from: monitor.scope.startAt, to: new Date(Math.min(clock(), Date.parse(monitor.scope.endAt))).toISOString(), admittedAt: now() }; monitor.checks.push(record); }
        else { record.status = 'checking'; record.error = null; record.ordinal ||= monitor.checks.indexOf(record) + 1; }
        return { monitor: structuredClone(monitor), record: structuredClone(record) }; });
      const { monitor, record } = claim;
      let sample = { requestId, checkOrdinal: record.ordinal, sampledAt: now(), coverage: { from: record.from, to: record.to }, dataLagSeconds: null, salesStatus: 'unavailable', trafficStatus: trafficAdapter ? 'unavailable' : 'unsupported', sales: null, traffic: null, completePagination: false, errors: [], source: 'shopify_admin_orders_2026-10', shopId: null, shopDomain: null, definition: SUPPLIER_METRIC_DEFINITION };
      try {
        if (Date.parse(record.to) <= Date.parse(record.from)) supplierFail(409, 'SUPPLIER_MONITOR_NOT_STARTED', 'The explicitly selected monitoring window has not started.');
        if (monitor.scope.shopifyFingerprint !== shopify.fingerprint) supplierFail(409, 'SHOPIFY_SCOPE_CHANGED', 'The original shop configuration changed; review the existing monitor scope again.');
        if (!shopify.status().configured) supplierFail(409, 'SHOPIFY_SETUP_REQUIRED', 'The original authorized shop is not configured.');
        await shopify.verify();
        const product = await shopify.readProductPublication({ productId: monitor.scope.productId, signal: controller.signal });
        if ((monitor.boundShopId || monitor.scope.shopId) && product.shopId !== (monitor.boundShopId || monitor.scope.shopId) || monitor.scope.variantIds.some(id => !product.variantIds.includes(id))) supplierFail(409, 'SHOPIFY_SCOPE_CHANGED', 'The original shop/product/variant binding changed.');
        const orders = [], cursors = new Set(); let cursor = null;
        do {
          const page = await shopify.readProductOrders({ productId: monitor.scope.productId, from: record.from, to: record.to, after: cursor, signal: controller.signal });
          if (page.shopId !== product.shopId) supplierFail(502, 'SHOPIFY_SCOPE_CHANGED', 'Shop identity changed during product sampling.');
          orders.push(...page.orders); if (orders.length > 2500) supplierFail(409, 'SHOPIFY_ORDERS_INCOMPLETE', 'The bounded cohort exceeded its complete-pagination limit.');
          cursor = page.nextCursor; if (cursor && cursors.has(cursor)) supplierFail(502, 'SHOPIFY_ORDERS_INCOMPLETE', 'Order pagination repeated a cursor.'); if (cursor) cursors.add(cursor);
        } while (cursor);
        sample.sales = productCohortMetrics(orders, { productId: monitor.scope.productId, variantIds: monitor.scope.variantIds, from: record.from, to: record.to });
        sample.salesStatus = 'available'; sample.completePagination = true; sample.shopId = product.shopId; sample.shopDomain = product.shopDomain;
      } catch (error) { sample.errors.push({ code: error.code || 'SUPPLIER_SOURCE_UNAVAILABLE' }); }
      if (trafficAdapter && trafficAdapter.id !== monitor.scope.trafficAdapterId) sample.errors.push({ code: 'SUPPLIER_TRAFFIC_SCOPE_CHANGED' });
      if (trafficAdapter && trafficAdapter.id === monitor.scope.trafficAdapterId && sample.shopId && !controller.signal.aborted) {
        try {
          if (trafficV2) {
            const scope = { workspaceId: monitor.workspaceId, shopId: sample.shopId, shopDomain: sample.shopDomain, productId: monitor.scope.productId, from: record.from, to: record.to, sampleKey: `supplier-check:${supplierHash([monitor.id, requestId])}`, signal: controller.signal };
            const observed = await trafficAdapter.readProductTraffic(scope);
            sample.traffic = validateProductTrafficObservation(observed, { ...scope, adapterId: monitor.scope.trafficAdapterId });
            sample.trafficStatus = sample.traffic.status;
          } else {
          const traffic = await trafficAdapter.readProductTraffic({ shopId: sample.shopId, productId: monitor.scope.productId, from: record.from, to: record.to, signal: controller.signal });
          if (traffic.productId !== monitor.scope.productId || traffic.shopId !== sample.shopId || traffic.attribution !== 'exact_product_id' || !iso(traffic.sampledAt) || !iso(traffic.coverage?.from) || !iso(traffic.coverage?.to) || traffic.coverage.from !== record.from || Date.parse(traffic.coverage.to) > Date.parse(record.to) || Date.parse(traffic.coverage.to) < Date.parse(record.from) || typeof traffic.complete !== 'boolean' || !Number.isSafeInteger(traffic.sessions) || traffic.sessions < 0 || traffic.dataLagSeconds !== null && (!Number.isFinite(traffic.dataLagSeconds) || traffic.dataLagSeconds < 0)) supplierFail(502, 'SUPPLIER_TRAFFIC_ATTRIBUTION_INVALID', 'Traffic needs authorized exact product identity, coverage and measured delay.');
          sample.traffic = { sessions: traffic.sessions, coverage: traffic.coverage, sampledAt: traffic.sampledAt, complete: traffic.complete, dataLagSeconds: traffic.dataLagSeconds, source: trafficAdapter.id, attribution: traffic.attribution }; sample.trafficStatus = traffic.complete && traffic.coverage.to === record.to ? 'available' : 'partial';
          }
        } catch (error) { sample.errors.push({ code: error.code || 'SUPPLIER_TRAFFIC_UNAVAILABLE' }); }
      }
      sample.sampledAt = now();
      if (controller.signal.aborted || closing) { await store.update(state => { const current = supplierRegistry(state).monitors.find(item => item.id === id).checks.find(item => item.requestId === requestId); current.status = 'interrupted'; current.error = { code: 'SERVICE_CHECK_INTERRUPTED' }; }); supplierFail(409, 'SERVICE_CHECK_INTERRUPTED', 'The read-only check can be reconciled with its exact original request.'); }
      return store.update(state => {
        const current = supplierRegistry(state).monitors.find(item => item.id === id), occurrence = current.checks.find(item => item.requestId === requestId);
        if (authorizeOwner && !authorizeOwner(state, current)) supplierFail(403, 'SUPPLIER_MONITOR_AUTHORIZATION_REQUIRED', 'The original current member permission changed during this check.'); const service = state.workspaceSupplierServices.services.find(item => item.id === current.serviceId);
        if (service?.cancelledAt || service?.rejectedAt || current.stoppedAt) supplierFail(409, 'SUPPLIER_MONITOR_STOPPED', 'The original monitor was stopped while reading.');
        occurrence.status = 'complete'; occurrence.sample = sample; occurrence.finishedAt = now();
        const latest = current.latestSample;
        if (latest && (Date.parse(latest.coverage.to) > Date.parse(sample.coverage.to) || latest.coverage.to === sample.coverage.to && latest.checkOrdinal > sample.checkOrdinal)) return { sample: structuredClone(sample), summary: current.summary || null, monitorId: id, latestProjectionUnchanged: true };
        if (sample.shopId) current.boundShopId ||= sample.shopId;
        current.latestSample = sample; current.status = sample.salesStatus === 'available' ? record.to === current.scope.endAt ? 'completed' : 'collecting' : 'blocked';
        const goal = state.goals.find(item => item.id === current.goalId);
        if (goal) { goal.status = current.status === 'completed' ? 'completed' : 'paused'; goal.output = JSON.stringify({ monitorId: current.id, salesStatus: sample.salesStatus, trafficStatus: sample.trafficStatus, sales: sample.sales, coverage: sample.coverage }); goal.updatedAt = now(); }
        if (record.to === current.scope.endAt) {
          const content = { monitorId: current.id, startAt: current.scope.startAt, endAt: current.scope.endAt, salesStatus: sample.salesStatus, trafficStatus: sample.trafficStatus, sales: sample.sales, traffic: sample.traffic, coverage: sample.coverage, dataLagSeconds: sample.dataLagSeconds, errors: sample.errors, definition: SUPPLIER_METRIC_DEFINITION };
          const semantic = value => Array.isArray(value) ? value.map(semantic) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !['sampledAt', 'sampleKey', 'requestFingerprint', 'diagnostics', 'observedAt'].includes(key)).map(([key, item]) => [key, semantic(item)])) : value;
          const hash = supplierHash(semantic(content)), old = current.summary;
          if (old && old.contentHash === hash) Object.assign(old, { traffic: content.traffic, sampledAt: sample.sampledAt });
          if (!old || old.contentHash !== hash) current.summary = { ...content, revision: (old?.revision || 0) + 1, contentHash: hash, sampledAt: sample.sampledAt, corrected: !!old, provisional: sample.salesStatus !== 'available' || sample.trafficStatus !== 'available', notificationCount: 1, messageId: `supplier-summary-${id}` };
          if (!old || old.contentHash !== hash) { let message = state.messages.find(item => item.id === current.summary.messageId); if (!message) { message = { id: current.summary.messageId, conversationId: current.conversationId, role: 'assistant', source: 'supplier_service', supplierMonitorId: id, status: 'complete', createdAt: now() }; state.messages.push(message); } message.content = `七天产品监测${old ? '总结已更正' : '结束'}。销量：${sample.salesStatus === 'available' ? `保留 ${sample.sales.retainedUnits} 个销售单位；原下单 ${sample.sales.grossUnits}、取消 ${sample.sales.cancelledUnits}、退款 ${sample.sales.refundedUnits}（有重叠，不重复扣减）` : '数据不可用，未按零处理'}。产品流量：${sample.traffic?.contractVersion === 2 ? `商品详情浏览事件 ${sample.traffic.metrics.productDetailViews.value ?? '不可用'} (${sample.trafficStatus}，临时观察；sessions 不可用)` : sample.trafficStatus === 'available' ? sample.traffic.sessions : sample.trafficStatus}。采样：${sample.sampledAt}；统计区间 ${current.scope.startAt} 至 ${current.scope.endAt}。数据延迟未知或见原数据源覆盖说明；晚到退款/取消可更正原总结。本次采样不执行商品发布或付费操作。`; }
          const schedule = state.capabilities.schedules.find(item => item.id === current.scheduleId); if (schedule) { schedule.enabled = false; schedule.status = 'ended'; }
        }
        return { sample: structuredClone(sample), summary: current.summary || null, monitorId: id };
      });
    })();
    inFlight.set(key, { promise, controller });
    try { return await promise; } finally { inFlight.delete(key); }
  }
  return {
    forActor(actor, { find, get, command, requireRevision }) {
      return {
        monitors(cid, sid) { find(cid, sid); return (store.read().workspaceSupplierServices?.monitors || []).filter(row => row.serviceId === sid && row.subject === actor.subject && row.workspaceId === actor.workspaceId).map(projection); },
        summary(cid, sid, id) { return lookup(store.read(), actor, cid, sid, id).summary || null; },
        async createMonitor(cid, sid, body) {
          supplierRequest(body, ['expectedRevision', 'confirmed', 'shopifyProductId', 'variantIds', 'startAt', 'startFromPublication']); if (body.confirmed !== true) supplierFail(400, 'SUPPLIER_CONFIRMATION_REQUIRED', 'Confirm the exact product and seven-day monitoring scope.');
          const service = find(cid, sid), productId = body.shopifyProductId || service.external?.productId;
          if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productId) || body.variantIds !== undefined && (!Array.isArray(body.variantIds) || body.variantIds.length > 250 || new Set(body.variantIds).size !== body.variantIds.length || body.variantIds.some(id => !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id)))) supplierFail(400, 'SUPPLIER_MONITOR_SCOPE_INVALID', 'Use exact existing product/variant IDs.');
          if (body.startFromPublication && (body.startAt !== undefined || service.external?.published !== true || service.external.productId !== productId || !service.external.publishedAt || service.external.publicationTimeSource !== 'online_store_published_at')) supplierFail(409, 'SUPPLIER_PUBLICATION_TIME_REQUIRED', 'Use a verified actual publication timestamp or explicitly choose a startAt.');
          const start = body.startFromPublication ? service.external.publishedAt : body.startAt;
          if (!iso(start) || Date.parse(start) > clock() + 365 * DAY) supplierFail(400, 'SUPPLIER_MONITOR_START_REQUIRED', 'Provide an explicit timestamp; preview creation never starts seven-day monitoring.');
          const scope = { productId, variantIds: [...(body.variantIds || [])].sort(), startAt: new Date(start).toISOString(), endAt: new Date(Date.parse(start) + 7 * DAY).toISOString(), startSource: body.startFromPublication ? 'verified_online_store_publication' : 'explicit_user_timestamp', shopifyFingerprint: shopify.fingerprint, shopId: service.external?.productId === productId ? service.external.shopId : null, trafficAdapterId: trafficAdapter?.id || null, ...(trafficV2 ? { trafficContractVersion: 2, trafficMetric: 'productDetailViewEvents', productTrafficDefinition: PRODUCT_TRAFFIC_DEFINITIONS.productDetailViews } : {}), modelRequired: false, estimatedCredits: 0 };
          const scopeHash = supplierHash(scope);
          const admitted = await store.update(state => command(state, actor, sid, 'monitor_create', body, () => { const current = find(cid, sid, state); const existing = supplierRegistry(state).monitors.find(row => row.serviceId === sid && row.subject === actor.subject && row.scopeHash === scopeHash); if (existing) return { monitorId: existing.id, duplicate: true }; requireRevision(current, body); if (supplierRegistry(state).monitors.length >= 1000) supplierFail(409, 'SUPPLIER_CAPACITY_LIMIT', 'Review original monitor storage capacity.');
            const monitor = { id: randomUUID(), serviceId: sid, subject: actor.subject, workspaceId: actor.workspaceId, conversationId: cid, title: `七天产品监测 · ${current.profile.name || '待核对产品'}`, scope, scopeHash, status: 'configuration_only', createdAt: now(), scheduledAt: new Date(Math.max(clock() + 1000, Date.parse(scope.startAt))).toISOString(), checks: [], summary: null, latestSample: null, stoppedAt: null, goalId: null, scheduleId: null };
            supplierRegistry(state).monitors.push(monitor); return { monitorId: monitor.id }; }));
          let monitor = lookup(store.read(), actor, cid, sid, admitted.monitorId);
          const { goal } = await runtime.createGoal({ requestId: `supplier-monitor-${monitor.id}`, conversationId: cid, title: monitor.title, description: JSON.stringify(monitor.scope), maxSteps: 1, maxOutputTokens: 1600 });
          await store.update(state => { const row = lookup(state, actor, cid, sid, monitor.id); row.goalId = goal.id; const item = state.goals.find(item => item.id === goal.id); item.serviceTask = { kind: 'supplier-monitor', monitorId: row.id, scopeHash: row.scopeHash, modelRequired: false }; });
          if (!store.read().capabilities.schedules.some(item => item.requestId === `supplier-schedule-${monitor.id}`) && Date.parse(monitor.scheduledAt) <= clock()) { await store.update(state => { lookup(state, actor, cid, sid, monitor.id).scheduledAt = new Date(clock() + 1000).toISOString(); }); monitor = lookup(store.read(), actor, cid, sid, monitor.id); }
          const { schedule } = await capabilities.createSchedule({ requestId: `supplier-schedule-${monitor.id}`, title: monitor.title, goalId: goal.id, kind: 'every', everySeconds: 86400, scheduledAt: monitor.scheduledAt });
          await store.update(state => { const row = lookup(state, actor, cid, sid, monitor.id); row.scheduleId = schedule.id; });
          monitor = lookup(store.read(), actor, cid, sid, monitor.id);
          return { monitor: projection(monitor), service: get(cid, sid), duplicate: !!admitted.duplicate, activation: 'disabled_requires_original_schedule_approval', status: shopify.status().configured ? 'configuration_only' : 'blocked', error: shopify.status().configured ? null : { code: 'SHOPIFY_SETUP_REQUIRED' } };
        },
        async checkMonitor(cid, sid, body) { supplierRequest(body, ['monitorId', 'expectedMonitorHash', 'confirmed']); const row = lookup(store.read(), actor, cid, sid, body.monitorId); if (body.confirmed !== true || body.expectedMonitorHash !== row.scopeHash) supplierFail(409, 'SUPPLIER_MONITOR_SCOPE_INVALID', 'Confirm the exact original monitor hash before a read-only check.'); return check(row.id, body.requestId, supplierHash(body)); },
        async stopMonitor(cid, sid, body) { supplierRequest(body, ['monitorId', 'expectedMonitorHash', 'confirmed']); const row = lookup(store.read(), actor, cid, sid, body.monitorId); if (body.confirmed !== true || body.expectedMonitorHash !== row.scopeHash) supplierFail(409, 'SUPPLIER_MONITOR_SCOPE_INVALID', 'Confirm the exact original monitor to stop.'); const admitted = await store.update(state => command(state, actor, sid, 'monitor_stop', body, () => { const current = lookup(state, actor, cid, sid, row.id); current.stoppedAt ||= now(); current.status = 'stopped'; return { monitorId: current.id }; })); const schedule = store.read().capabilities.schedules.find(item => item.id === row.scheduleId); if (schedule && (schedule.enabled || schedule.consent || schedule.status !== 'disabled')) await capabilities.disableSchedule(row.scheduleId); if (notifications) await notifications.forActor(actor, { command }).cancel(cid, sid, { requestId: `monitor-notification-cancel-${supplierHash(body).slice(0, 40)}`, monitorId: row.id, expectedMonitorHash: row.scopeHash, confirmed: true }); return { monitor: projection(lookup(store.read(), actor, cid, sid, row.id)), duplicate: !!admitted.duplicate }; },
      };
    },
    async dispatch({ goalId, requestId, expectedGoalDefinitionHash, scheduleClaim }) {
      const state = store.read(), goal = state.goals.find(item => item.id === goalId), monitor = state.workspaceSupplierServices?.monitors.find(item => item.id === goal?.serviceTask?.monitorId);
      const claim = scheduleClaim, schedule = state.capabilities.schedules.find(item => item.id === claim?.scheduleId), record = state.capabilities.scheduleRuns.find(item => item.id === claim?.id);
      if (!monitor || monitor.goalId !== goalId || monitor.scopeHash !== goal.serviceTask.scopeHash || !schedule || schedule.id !== monitor.scheduleId || !schedule.consent || schedule.revision !== claim.scheduleRevision || record?.status !== 'dispatching' || record.goalId !== goalId || claim.goalId !== goalId || record.requestId !== requestId || claim.requestId !== requestId || record.scheduleId !== schedule.id || record.scheduleRevision !== schedule.revision || capabilityPayloadHash(goalDefinition(goal, state)) !== expectedGoalDefinitionHash) supplierFail(409, 'SCHEDULE_CLAIM_RETIRED', 'Only the original approved schedule occurrence can dispatch this service.');
      const response = await check(monitor.id, requestId, supplierHash({ monitorId: monitor.id, requestId, scopeHash: monitor.scopeHash }));
      let notification = null;
      if (notifications && store.read().workspaceSupplierServices.monitors.find(item => item.id === monitor.id)?.summary) { try { notification = await notifications.dispatchApproved(store.read().workspaceSupplierServices.monitors.find(item => item.id === monitor.id)); } catch (error) { notification = { status: 'blocked', code: error.code || 'NOTIFICATION_SEPARATE_APPROVAL_REQUIRED' }; } }
      return { status: 'completed', ...(notification ? { notification } : {}), serviceReceipt: { monitorId: monitor.id, requestId, sampledAt: response.sample.sampledAt, salesStatus: response.sample.salesStatus, modelRequired: false } };
    },
    async close() { closing = true; unsubscribe(); for (const job of inFlight.values()) job.controller.abort('SHUTDOWN'); await Promise.allSettled([...inFlight.values()].map(job => job.promise)); },
  };
}
