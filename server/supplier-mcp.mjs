import { SupplierServiceError, supplierFail, supplierObject, supplierHash } from './supplier-profile.mjs';
import { invokeSupplierOwnerOperation } from './supplier-owner-operation.mjs';
import { SUPPLIER_OWNER_MCP_OPERATIONS, SUPPLIER_OWNER_MCP_TOOLS, validateSupplierOwnerArguments } from './supplier-owner-tools.mjs';
export { SUPPLIER_OWNER_MCP_TOOLS } from './supplier-owner-tools.mjs';

const args = { type: 'object', additionalProperties: false, properties: { taskRef: { type: 'string', maxLength: 128 }, attemptId: { type: 'string', maxLength: 128 }, fence: { type: 'integer', minimum: 1 } }, required: ['taskRef', 'attemptId', 'fence'] };
export const SUPPLIER_WORKER_MCP_TOOLS = Object.freeze([
  { name: 'workspace_supplier_listing_preview', description: 'Read only the exact retail preview explicitly included in this original approved task. Requires the current original attempt and lease; never returns private supplier costs or grants Shopify writes.', inputSchema: args },
  { name: 'workspace_supplier_monitor_status', description: 'Read only the exact aggregate seven-day monitor explicitly shared in this original approved task; missing data stays unavailable. No activation, external notification or billing.', inputSchema: args },
]);

// Extend an existing authenticated Dot/Muse MCP transport. The original bridge
// validates worker ownership, approval, cancellation, attempt/fence and lease.
// No token, new principal, schedule, invocation loop or grant store is created.
export function createSupplierWorkerMcpExtension({ bridge, service, store, memberRole, workspaceId }) {
  return { tools: SUPPLIER_WORKER_MCP_TOOLS, async call(name, input) {
    supplierObject(input, ['taskRef', 'attemptId', 'fence']);
    if (!SUPPLIER_WORKER_MCP_TOOLS.some(tool => tool.name === name) || typeof input.taskRef !== 'string' || typeof input.attemptId !== 'string' || !Number.isSafeInteger(input.fence)) supplierFail(400, 'SUPPLIER_MCP_ARGUMENTS_INVALID', 'Use an original task/attempt/fence.');
    const task = await bridge.readTask(input.taskRef);
    if (!task.canExecute || task.status !== 'claimed' || task.attemptId !== input.attemptId || task.fence !== input.fence || Date.parse(task.leaseUntil) <= Date.now()) supplierFail(409, 'SUPPLIER_MCP_LEASE_REQUIRED', 'Only the still-approved original live attempt can read this service scope.');
    let scope; try { scope = JSON.parse(task.inputs.product); } catch { supplierFail(403, 'SUPPLIER_MCP_SCOPE_REQUIRED', 'The original task contains no explicitly approved supplier scope.'); }
    supplierObject(scope, ['schema', 'serviceId', 'previewHash', 'readPreview', 'monitorId', 'monitorHash', 'readCurrentMetrics']);
    if (scope.schema !== 'workspace.supplier-task.v1') supplierFail(403, 'SUPPLIER_MCP_SCOPE_REQUIRED', 'The original exact task scope is not a supplier service grant.');
    const state = store.read(), order = state.workerOrders?.find(item => item.id === task.orderId), row = state.workspaceSupplierServices?.services.find(item => item.id === scope.serviceId);
    const role = memberRole(order?.createdBy);
    if (!order || !['admin', 'operator'].includes(role) || !row || row.subject !== order.createdBy || row.workspaceId !== workspaceId || row.cancelledAt || row.rejectedAt) supplierFail(403, 'SUPPLIER_MCP_SCOPE_REQUIRED', 'The original approving member and service ownership must remain valid.');
    const bound = service.forActor({ subject: order.createdBy, role, workspaceId });
    if (name === 'workspace_supplier_listing_preview') {
      if (scope.readPreview !== true || row.preview?.previewHash !== scope.previewHash) supplierFail(409, 'SUPPLIER_MCP_SCOPE_CHANGED', 'The original approved preview hash changed.');
      const preview = structuredClone(row.preview);
      // Original private image bytes/IDs never enter a Worker public task.
      preview.images = preview.images.map(({ kind, sourceNote, availability, transferStatus, url }) => ({ kind, sourceNote, availability, transferStatus, ...(kind === 'public_url' ? { url } : {}) }));
      return { preview, externalWriteAllowed: false, evidenceKind: 'original-approved-task-read' };
    }
    if (scope.readCurrentMetrics !== true) supplierFail(403, 'SUPPLIER_MCP_SCOPE_REQUIRED', 'Current sales metrics require separate explicit original-task scope.');
    const monitor = bound.monitors(row.conversationId, row.id).find(item => item.id === scope.monitorId && item.scopeHash === scope.monitorHash);
    if (!monitor) supplierFail(409, 'SUPPLIER_MCP_SCOPE_CHANGED', 'The original monitor scope changed.');
    return { monitorId: monitor.id, status: monitor.status, latestSample: monitor.latestSample, summary: monitor.summary, externalNotifications: monitor.externalNotifications, activationAllowed: false };
  } };
}

// Native owner Connectors can register the same closed service methods through
// their existing authenticated resource/grant binding. This factory does not
// install a credential or authorize a caller; the original Host must supply a
// fresh reviewed scope on each call, including its original budget/approval.
export function createSupplierOwnerMcpBinding({ service, publication, artifacts, store, actor: suppliedActor, conversationId, readReviewedScope, clock = Date.now, assertActive = () => {}, signal }) {
  if (typeof readReviewedScope !== 'function' || !suppliedActor?.subject || !suppliedActor.workspaceId || !conversationId || !['admin', 'operator'].includes(suppliedActor.role)) throw new TypeError('An existing authenticated owner and original reviewed resource scope are required.');
  const actor = Object.freeze({ subject: suppliedActor.subject, workspaceId: suppliedActor.workspaceId, role: suppliedActor.role });
  const call = async (operation, serviceId, input = {}) => {
    if (!Object.hasOwn(SUPPLIER_OWNER_MCP_OPERATIONS, operation)) supplierFail(403, 'SUPPLIER_MCP_OPERATION_FORBIDDEN', 'Only the registered original owner service methods are callable.');
    const definition = SUPPLIER_OWNER_MCP_OPERATIONS[operation];
    validateSupplierOwnerArguments(operation, { ...(serviceId !== undefined && serviceId !== null ? { serviceId } : {}), ...(definition.tool.inputSchema.properties.input ? { input } : {}) });
    input = structuredClone(input);
    const inputHash = supplierHash({ operation, serviceId: serviceId || null, input });
    const scope = await readReviewedScope({ actor, conversationId, operation, serviceId: serviceId || null, inputHash });
    assertActive();
    if (scope?.subject !== actor.subject || scope.workspaceId !== actor.workspaceId || scope.conversationId !== conversationId || !Array.isArray(scope.operations) || !scope.operations.includes(operation) || serviceId && (!Array.isArray(scope.serviceIds) || !scope.serviceIds.includes(serviceId)) || scope.revoked === true || !Number.isFinite(Date.parse(scope.expiresAt)) || Date.parse(scope.expiresAt) <= clock() || !definition.readOnly && scope.inputHash !== inputHash || operation === 'intake' && (serviceId || input.facts === undefined) && scope.piIntakeApproved !== true) supplierFail(403, 'SUPPLIER_MCP_SCOPE_REQUIRED', 'The original owner Connector grant does not admit this exact current call.');
    const assertCurrent = () => { assertActive(); if (scope.revoked === true || Date.parse(scope.expiresAt) <= clock()) supplierFail(403, 'SUPPLIER_MCP_SCOPE_REQUIRED', 'The original reviewed owner scope expired or was revoked.'); };
    return invokeSupplierOwnerOperation({ service, publication, artifacts, store, actor, conversationId, operation, serviceId, input, assertCurrent, signal });
  };
  return Object.freeze({ call, tools: SUPPLIER_OWNER_MCP_TOOLS, async callTool(name, args) {
    const operation = Object.keys(SUPPLIER_OWNER_MCP_OPERATIONS).find(key => SUPPLIER_OWNER_MCP_OPERATIONS[key].tool.name === name);
    validateSupplierOwnerArguments(operation, args);
    return call(operation, args.serviceId, args.input || {});
  } });
}
export const isSupplierMcpError = error => error instanceof SupplierServiceError;
