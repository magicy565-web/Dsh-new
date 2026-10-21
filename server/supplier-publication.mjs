import { randomUUID } from 'node:crypto';
import { supplierFail, supplierHash } from './supplier-profile.mjs';
import { assertSupplierProductSource, supplierFind, supplierRegistry, supplierRequest } from './supplier-draft.mjs';
import { SUPPLIER_SHOPIFY_TARGET } from './shopify-publication.mjs';

const gid = (kind, value) => typeof value === 'string' && new RegExp(`^gid://shopify/${kind}/\\d+$`).test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clone = value => structuredClone(value);
const receiptValidFor = (target, value, operation) => Boolean(value)
  && value.previewHash === operation.scope.previewHash
  && target.isProductId(value.productId)
  && (value.shopId ?? null) === (operation.scope.shopId ?? null)
  && (value.shopDomain ?? null) === (operation.scope.shopDomain ?? null)
  && Array.isArray(value.variantIds)
  && value.variantIds.every(id => target.isVariantId(id));

/** Business receipts stay on the original supplier entity; approvals and
 * connector executions stay in the original capability collections. */
export async function createSupplierPublication({ store, capabilities, shopify, adapter, clock = Date.now, connectorId = null } = {}) {
  if (!store || !capabilities || !shopify || !adapter) throw new TypeError('Use the existing Workspace store, capabilities, Shopify client and publication adapter.');
  // The business flow reads the commerce target from the adapter. Shopify is the
  // default only for adapters that predate the descriptor. See
  // docs/MEDUSA-SHOPIFY-PARITY.md.
  const target = adapter.target ?? SUPPLIER_SHOPIFY_TARGET;
  const receiptValid = (value, operation) => receiptValidFor(target, value, operation);
  const at = () => new Date(clock()).toISOString();
  const originalConnectors = () => store.read().capabilities?.connectors || [];
  if (!connectorId) connectorId = originalConnectors().find(item => item.adapter === target.adapter)?.id || null;
  async function ensureConnector() {
    connectorId ||= originalConnectors().find(item => item.adapter === target.adapter)?.id || null;
    if (!connectorId) connectorId = (await capabilities.createConnector({ requestId: target.connectorRequestId, name: target.connectorName, description: target.connectorDescription, adapter: target.adapter, capabilities: [...target.actions], credentialRefs: { ...target.credentialRefs }, enabled: false })).connector.id;
    return connector();
  }
  function connector() {
    if (!connectorId) return { id: null, status: 'not_configured', enabled: false };
    const value = originalConnectors().find(item => item.id === connectorId);
    if (!value || value.adapter !== target.adapter) supplierFail(409, 'SUPPLIER_CONNECTOR_REQUIRED', 'Use the original registered supplier commerce connector.');
    return capabilities.getConnector(connectorId);
  }
  function locate(state, actor, cid, sid, operationId) {
    const row = supplierFind(state, actor, cid, sid), operation = row.publicationOperations?.find(item => item.id === operationId);
    if (!operation) supplierFail(404, 'SUPPLIER_PUBLICATION_NOT_FOUND', 'The original supplier publication operation was not found.');
    return { row, operation };
  }
  function current(row, operation, actorRole) {
    assertSupplierProductSource(store.read(), row);
    const scope = operation.scope;
    if (actorRole !== scope.actorRole || row.cancelledAt || row.rejectedAt || row.revision !== scope.serviceRevision || row.preview?.previewHash !== scope.previewHash || supplierHash(row.preview) !== scope.previewSnapshotHash || adapter.fingerprint !== scope.configFingerprint) supplierFail(409, 'SUPPLIER_PUBLICATION_STALE', 'The reviewed product revision, preview or host configuration changed. Create a current review; do not execute this one.');
  }
  function replay(state, actor, sid, kind, body) {
    const fingerprint = supplierHash({ sid, kind, body });
    const previous = supplierRegistry(state).commands.find(item => item.subject === actor.subject && item.workspaceId === actor.workspaceId && item.requestId === body.requestId);
    if (previous && previous.fingerprint !== fingerprint) supplierFail(409, 'IDEMPOTENCY_CONFLICT', 'Keep the exact original supplier publication request.');
    return { fingerprint, previous };
  }
  function remember(state, actor, sid, kind, body, result) {
    const { fingerprint, previous } = replay(state, actor, sid, kind, body);
    if (previous) return previous.result;
    if (supplierRegistry(state).commands.length >= 4000) supplierFail(409, 'SUPPLIER_CAPACITY_LIMIT', 'Preserve and review the original command receipts before admitting more operations.');
    supplierRegistry(state).commands.push({ subject: actor.subject, workspaceId: actor.workspaceId, requestId: body.requestId, fingerprint, result: clone(result), committedAt: at() });
    return result;
  }
  function isLatestExternalOperation(row, operation) {
    const operations = row.publicationOperations || [];
    return !operations.slice(operations.indexOf(operation) + 1).some(item => item.connectorRunId);
  }
  function uncertain(row, operation, error) {
    operation.status = 'uncertain'; operation.error = error; operation.updatedAt = at();
    if (isLatestExternalOperation(row, operation)) row.external = {
      status: 'uncertain', published: false, complete: false,
      productId: operation.receipt?.productId || operation.scope.productId || row.external?.productId || null,
      variantIds: operation.receipt?.variantIds || operation.scope.variantIds || [],
      shopId: operation.scope.shopId, shopDomain: operation.scope.shopDomain,
      publicationId: operation.scope.publicationId, publishedAt: null, publicationTimeSource: null,
      operationId: operation.id, scopeHash: operation.scopeHash, previewHash: operation.scope.previewHash,
      observedAt: at(), error: clone(error),
    };
  }
  function applyReceipt(row, operation, receipt, source) {
    operation.receipt = clone(receipt); operation.updatedAt = at(); operation.reconciliationSource = source;
    if (!receiptValid(receipt, operation)) { uncertain(row, operation, { code: 'SHOPIFY_RECEIPT_UNCONFIRMED', message: 'The original external receipt is not confirmed. No write was repeated.' }); return; }
    operation.status = receipt.complete ? 'succeeded' : 'partial';
    if (!operation.remoteContentHash && sha(receipt.remoteContentHash) && receipt.complete) operation.remoteContentHash = receipt.remoteContentHash;
    operation.error = receipt.complete ? null : { code: 'SHOPIFY_PRODUCT_PARTIAL', message: 'The original product exists, but its reviewed content, media or publication is incomplete. No missing write is retried automatically.' };
    if (isLatestExternalOperation(row, operation)) row.external = { ...clone(receipt), status: receipt.externalStatus, operationId: operation.id, scopeHash: operation.scopeHash, previewHash: operation.scope.previewHash };
    if (operation.action === 'repair_draft' && receipt.complete) {
      const original = row.publicationOperations.find(item => item.id === operation.scope.draftOperationId && item.action === 'draft' && item.scopeHash === operation.scope.draftScopeHash);
      if (original) { applyReceipt(row, original, receipt, 'separately_approved_missing_step_repair'); original.repairedBy ||= []; if (!original.repairedBy.includes(operation.id)) original.repairedBy.push(operation.id); }
    }
  }
  // A known original connector receipt can close a local response-loss gap.
  // Otherwise recovery is read-only and requires the original operation id.
  await store.update(state => { for (const row of state.workspaceSupplierServices?.services || []) for (const operation of row.publicationOperations || []) if (operation.status === 'running') {
    const run = state.capabilities.connectorRuns.find(item => item.id === operation.connectorRunId);
    if (run?.status === 'succeeded' && receiptValid(run.result, operation)) applyReceipt(row, operation, run.result, 'original_connector_receipt');
    else uncertain(row, operation, { code: 'SHOPIFY_OPERATION_INTERRUPTED', message: 'Service restarted with an uncertain external result. Query this original operation; never create a replacement blindly.' });
  } });
  const approvalView = id => capabilities.listApprovals().find(item => item.id === id) || null;
  const operationView = (row, operation) => {
    let sourceStale = false;
    try { assertSupplierProductSource(store.read(), row); } catch (error) { if (error.code !== 'SHOPIFY_PRODUCT_SOURCE_CHANGED') throw error; sourceStale = true; }
    const approval = approvalView(operation.approvalId), stale = sourceStale || row.revision !== operation.scope.serviceRevision || row.preview?.previewHash !== operation.scope.previewHash || adapter.fingerprint !== operation.scope.configFingerprint;
    return { ...clone(operation), approvalStatus: approval?.status || null, approval, stale, businessCompletion: operation.receipt?.published ? 'published' : operation.receipt?.found ? 'draft_only' : 'not_completed', canExecute: !stale && operation.status === 'approved' && approval?.status === 'approved' && Date.parse(approval.expiresAt) > clock(), canReconcile: !!operation.connectorRunId && operation.status !== 'running', automaticRetry: false };
  };
  function binding(operation) { return { type: 'supplier-publication', subject: operation.scope.subject, workspaceId: operation.scope.workspaceId, conversationId: operation.scope.conversationId, serviceId: operation.scope.serviceId, operationId: operation.id, scopeHash: operation.scopeHash }; }
  const executionInput = operation => ({ action: target.actionName(operation.action), resource: `${target.resourcePrefix}:${operation.scope.shopDomain}:${operation.scope.productId || operation.scope.handle}:${operation.scope.publicationId || 'draft'}`, payload: clone(operation.scope) });
  return {
    get connectorId() { return connectorId; }, ensureConnector,
    status() { return { ...adapter.status(), connectorId, connectorStatus: connector().status, reviewRequired: true, deliveryChannel: 'original_conversation', externalNotifications: 'not_configured' }; },
    forActor(context, helpers = {}) {
      const actor = { subject: context.subject, workspaceId: context.workspaceId || 'local', role: context.role };
      const assertCaller = state => {
        helpers.signal?.throwIfAborted();
        const checked = helpers.assertCurrent?.(state);
        if (checked === false || checked && typeof checked.then === 'function') { checked?.catch?.(() => {}); supplierFail(403, 'SHOPIFY_PRODUCT_SOURCE_CHANGED', 'Use the original synchronous source and Run guard.'); }
      };
      const getService = (cid, sid) => helpers.get ? helpers.get(cid, sid) : clone(supplierFind(store.read(), actor, cid, sid));
      const publication = (cid, sid) => { const row = supplierFind(store.read(), actor, cid, sid), operations = (row.publicationOperations || []).map(operation => operationView(row, operation)); return { service: getService(cid, sid), publication: { schema: 'workspace.supplier-publication.v1', ...this.status(), operations, latest: operations.at(-1) || null } }; };
      const response = (cid, sid, opid, extra = {}) => { const { row, operation } = locate(store.read(), actor, cid, sid, opid), view = operationView(row, operation); return { service: getService(cid, sid), operation: view, approval: view.approval, status: view.status, ...extra }; };
      const checked = (cid, sid, body, fields = []) => { supplierRequest(body, ['operationId', 'expectedScopeHash', 'confirmed', ...fields]); if (body.confirmed !== true || !sha(body.expectedScopeHash)) supplierFail(400, 'SUPPLIER_CONFIRMATION_REQUIRED', 'Explicitly confirm this exact original publication scope.'); const found = locate(store.read(), actor, cid, sid, body.operationId); if (found.operation.scopeHash !== body.expectedScopeHash) supplierFail(409, 'SUPPLIER_PUBLICATION_SCOPE_CHANGED', 'Read the original publication scope before acting.'); return found; };
      const ensureApproval = async (cid, sid, operationId) => {
        const operation = locate(store.read(), actor, cid, sid, operationId).operation;
        if (operation.approvalId) return;
        const request = capabilities.connectorApprovalRequest(connectorId, executionInput(operation), { binding: binding(operation) });
        try { await capabilities.requestApproval({ ...request, expiresInSeconds: 1800 }, { onCreated(state, approval) { assertCaller(state); const found = locate(state, actor, cid, sid, operation.id); if (found.operation.approvalId) supplierFail(409, 'SUPPLIER_APPROVAL_ALREADY_PREPARED', 'The original review already has an approval.'); current(found.row, found.operation, actor.role); found.operation.approvalId = approval.id; found.operation.status = 'pending_approval'; found.operation.updatedAt = at(); } }); }
        catch (error) { if (error.code !== 'SUPPLIER_APPROVAL_ALREADY_PREPARED') throw error; }
      };
      return {
        publication,
        async reviewPublication(cid, sid, body) {
          assertCaller(store.read());
          supplierRequest(body, ['expectedRevision', 'expectedPreviewHash', 'action', 'publicationId', 'draftOperationId', 'expectedRemoteContentHash', 'approveObservedMedia', 'confirmed']);
          if (body.confirmed !== true || !['draft', 'publish', 'repair_draft'].includes(body.action) || !sha(body.expectedPreviewHash) || body.action === 'publish' && !target.isPublicationId(body.publicationId) || body.action !== 'publish' && body.publicationId !== undefined || body.action === 'repair_draft' && (typeof body.draftOperationId !== 'string' || !sha(body.expectedRemoteContentHash) || body.approveObservedMedia !== undefined && typeof body.approveObservedMedia !== 'boolean') || body.action !== 'repair_draft' && ['draftOperationId', 'expectedRemoteContentHash', 'approveObservedMedia'].some(field => body[field] !== undefined)) supplierFail(400, 'SUPPLIER_PUBLICATION_REVIEW_INVALID', 'Explicitly review a draft, one publication, or the exact reconciled missing-step repair.');
          const before = supplierFind(store.read(), actor, cid, sid), prior = replay(store.read(), actor, sid, 'publication_review', body).previous;
          assertSupplierProductSource(store.read(), before);
          if (prior) { await ensureApproval(cid, sid, prior.result.operationId); return response(cid, sid, prior.result.operationId, { duplicate: true }); }
          if (before.revision !== body.expectedRevision || before.preview?.previewHash !== body.expectedPreviewHash || before.preview.phase !== 'preview_ready' || before.preview.missingFields.length) supplierFail(409, 'SUPPLIER_PREVIEW_REQUIRED', 'Generate and explicitly review the complete current retail preview first.');
          const readiness = adapter.status();
          if (readiness.enabled && readiness.configured) await ensureConnector();
          const selectedConnector = connector();
          if (!readiness.configured || !target.clientConfigured({ shopify, adapter }) || !readiness.enabled || selectedConnector.status !== 'ready') return { service: getService(cid, sid), operation: null, approval: null, status: 'blocked', error: { code: !readiness.configured || !target.clientConfigured({ shopify, adapter }) ? 'SHOPIFY_SETUP_REQUIRED' : 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED', message: 'Configure and explicitly enable the existing host Shopify connector before preparing a write approval.' } };
          if (!selectedConnector.capabilities.includes(target.actionName(body.action))) return { service: getService(cid, sid), operation: null, approval: null, status: 'blocked', error: { code: body.action === 'repair_draft' ? 'SUPPLIER_REPAIR_CONNECTOR_REVIEW_REQUIRED' : 'SUPPLIER_PUBLICATION_CAPABILITY_REQUIRED', message: 'The existing Connector does not declare this separately reviewed action. Its capabilities were not expanded automatically.' } };
          const verified = await target.verify({ shopify, adapter });
          if (!target.allowsAction(verified, body.action)) supplierFail(409, 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED', 'The existing shop grant does not allow this exact operation.');
          if (target.consumerCurrency(verified) !== before.preview.market.currency) supplierFail(409, 'SHOPIFY_CURRENCY_MISMATCH', 'Consumer price currency must match the actual shop; no implicit conversion is performed.');
          let originalDraft = null, draftReceipt = null, repair = null;
          if (body.action === 'publish') {
            originalDraft = [...(before.publicationOperations || [])].reverse().find(item => item.action === 'draft' && item.scope.previewHash === before.preview.previewHash && ['succeeded', 'partial'].includes(item.status) && receiptValid(item.receipt, item));
            if (!originalDraft) supplierFail(409, 'SHOPIFY_DRAFT_REQUIRED', 'Create and verify the exact reviewed Shopify draft before preparing publication.');
            draftReceipt = await adapter.reconcile(originalDraft.scope);
            if (!draftReceipt.complete || draftReceipt.status !== target.draftStatus) supplierFail(409, 'SHOPIFY_DRAFT_CHANGED', 'The actual remote draft must match this exact preview and ready media.');
          }
          if (body.action === 'repair_draft') {
            originalDraft = before.publicationOperations?.find(item => item.id === body.draftOperationId && item.action === 'draft' && item.scope.previewHash === before.preview.previewHash);
            if (!originalDraft || originalDraft.status !== 'partial' || originalDraft.reconciliationSource !== 'read_only_shopify_reconciliation' || !receiptValid(originalDraft.receipt, originalDraft)) supplierFail(409, 'SHOPIFY_REPAIR_RECONCILIATION_REQUIRED', 'First reconcile the exact original unknown draft; only a read-confirmed partial existing product may be reviewed for repair.');
            if (originalDraft.receipt.remoteContentHash !== body.expectedRemoteContentHash || originalDraft.scope.serviceRevision !== before.revision || originalDraft.scope.previewSnapshotHash !== supplierHash(before.preview)) supplierFail(409, 'SHOPIFY_REPAIR_STALE', 'Read and confirm the exact original preview and remote content before reviewing repair.');
            const planned = await adapter.planRepair(originalDraft.scope, { approveObservedMedia: body.approveObservedMedia === true });
            if (planned.observed.remoteContentHash !== body.expectedRemoteContentHash) supplierFail(409, 'SHOPIFY_REPAIR_STALE', 'The remote draft changed during read-only repair preparation.');
            draftReceipt = planned.observed; repair = planned.repair;
          }
          const admitted = await store.update(state => {
            assertCaller(state);
            const row = supplierFind(state, actor, cid, sid), prior = replay(state, actor, sid, 'publication_review', body).previous;
            assertSupplierProductSource(state, row);
            if (prior) return prior.result;
            if (row.revision !== before.revision || supplierHash(row.preview) !== supplierHash(before.preview)) supplierFail(409, 'SUPPLIER_PUBLICATION_STALE', 'The original preview changed during read-only preparation.');
            const operations = row.publicationOperations ||= [];
            if (operations.length >= 100) supplierFail(409, 'SUPPLIER_CAPACITY_LIMIT', 'Review original publication history before admitting more operations.');
            for (const previous of operations) if (['preparing', 'pending_approval', 'approved'].includes(previous.status)) {
              const approval = previous.approvalId && state.capabilities.approvals.find(item => item.id === previous.approvalId);
              if (previous.scope.serviceRevision !== row.revision || previous.scope.previewHash !== row.preview.previewHash || previous.scope.configFingerprint !== adapter.fingerprint || approval && Date.parse(approval.expiresAt) <= clock() || body.action === 'repair_draft' && previous.action === 'repair_draft' && supplierHash(previous.scope.repair) !== supplierHash(repair)) { previous.status = 'stale'; previous.updatedAt = at(); }
            }
            const outstanding = operations.find(item => item.action === body.action && ['preparing', 'pending_approval', 'approved', 'running', 'uncertain'].includes(item.status));
            if (outstanding) { if (outstanding.scope.previewHash !== row.preview.previewHash) supplierFail(409, 'SUPPLIER_PUBLICATION_PENDING', 'Resolve the previous original publication review before preparing another version.'); remember(state, actor, sid, 'publication_review', body, { operationId: outstanding.id }); return { operationId: outstanding.id }; }
            if (body.action === 'draft' && operations.some(item => item.action === 'draft' && item.receipt?.found)) supplierFail(409, 'SUPPLIER_EXISTING_REMOTE_PRODUCT', 'The original remote draft already exists. Reconcile it; creating another product is not an update.');
            if (repair && (!row.publicationOperations.some(item => item.id === originalDraft.id && item.status === 'partial' && item.receipt?.remoteContentHash === body.expectedRemoteContentHash) || row.publicationOperations.some(item => item.action === 'publish' && item.connectorRunId && item.scope.productId === draftReceipt.productId))) supplierFail(409, 'SHOPIFY_REPAIR_STALE', 'The original draft or publication changed during preparation.');
            const id = randomUUID(), scope = { schema: 'workspace.supplier-publication-scope.v1', operationId: id, action: body.action, subject: actor.subject, actorRole: actor.role, workspaceId: actor.workspaceId, conversationId: cid, serviceId: sid, serviceRevision: row.revision, previewHash: row.preview.previewHash, previewSnapshotHash: supplierHash(row.preview), preview: clone(row.preview), ...target.scopeFields(verified, body), configFingerprint: adapter.fingerprint, handle: originalDraft?.scope.handle || `cnsub-${supplierHash([actor.workspaceId, actor.subject, sid, id]).slice(0,32)}`, productId: draftReceipt?.productId || null, variantIds: draftReceipt?.variantIds || [], remoteContentHash: draftReceipt?.remoteContentHash || null, draftOperationId: originalDraft?.id || null, draftScopeHash: originalDraft?.scopeHash || null, draftScope: originalDraft ? clone(originalDraft.scope) : null, ...(repair ? { repair: clone(repair) } : {}), budget: { modelCalls: 0, paidServiceCalls: 0, source: 'original_business_service' }, transfer: { images: row.preview.images.map(image => image.kind === 'artifact' ? { kind: image.kind, asset: clone(image.asset), sourceNote: image.sourceNote } : { kind: image.kind, url: image.url, sourceNote: image.sourceNote }), approvedPublicFields: clone(row.preview.publicFields) } };
            const operation = { id, action: body.action, status: 'preparing', scope, scopeHash: supplierHash(scope), approvalId: null, connectorId, connectorRunId: null, createdAt: at(), updatedAt: at(), receipt: null, error: null, steps: [] };
            operations.push(operation); remember(state, actor, sid, 'publication_review', body, { operationId: id }); return { operationId: id };
          });
          await ensureApproval(cid, sid, admitted.operationId);
          const operation = locate(store.read(), actor, cid, sid, admitted.operationId).operation;
          return response(cid, sid, operation.id, { review: { title: body.action === 'draft' ? '创建已审阅的 Shopify 草稿' : body.action === 'repair_draft' ? '修复已对账的原 Shopify 草稿缺失步骤' : '正式发布已审阅的 Shopify 商品', scopeHash: operation.scopeHash, scope: clone(operation.scope), createsDraftOnly: body.action === 'draft', publishes: body.action === 'publish', ...(body.action === 'repair_draft' ? { repairsExistingDraft: true, createsProduct: false, uploadsMedia: false, repairSteps: clone(operation.scope.repair.steps), approveObservedMedia: operation.scope.repair.approveObservedMedia } : {}), automaticRetry: false } });
        },
        async decidePublication(cid, sid, body) {
          const found = checked(cid, sid, body, ['decision']);
          if (!['approved', 'denied'].includes(body.decision)) supplierFail(400, 'SUPPLIER_DECISION_REQUIRED', 'Explicitly approve or deny the exact operation.');
          if (replay(store.read(), actor, sid, 'publication_decision', body).previous) return response(cid, sid, found.operation.id, { duplicate: true });
          await capabilities.decideApproval(found.operation.approvalId, { decision: body.decision, confirmed: true }, { onDecision(state) { const actual = locate(state, actor, cid, sid, found.operation.id); if (body.decision === 'approved') current(actual.row, actual.operation, actor.role); actual.operation.status = body.decision; actual.operation.updatedAt = at(); actual.operation.decidedBy = actor.subject; remember(state, actor, sid, 'publication_decision', body, { operationId: actual.operation.id }); } });
          return response(cid, sid, found.operation.id);
        },
        async executePublication(cid, sid, body) {
          const found = checked(cid, sid, body), operation = found.operation;
          if (replay(store.read(), actor, sid, 'publication_execute', body).previous) return response(cid, sid, operation.id, { duplicate: true });
          current(found.row, operation, actor.role);
          if (operation.connectorRunId || operation.status !== 'approved') supplierFail(409, 'SUPPLIER_PUBLICATION_NOT_EXECUTABLE', 'Only a current unexecuted approved operation may run. Unknown outcomes require reconciliation.');
          const result = await capabilities.executeConnector(connectorId, { ...executionInput(operation), approvalId: operation.approvalId }, {
            binding: binding(operation), signal: helpers.signal,
            assertAllowed(state) { assertCaller(state); const actual = locate(state, actor, cid, sid, operation.id); current(actual.row, actual.operation, actor.role); if (actual.operation.status !== 'approved' || actual.operation.connectorRunId || actual.operation.decidedBy !== actor.subject) supplierFail(409, 'SUPPLIER_PUBLICATION_NOT_EXECUTABLE', 'The original owner-approved operation was already used or changed.'); if (operation.scope.productId && actual.row.publicationOperations.some(item => item.id !== operation.id && item.connectorRunId && ['running', 'uncertain'].includes(item.status) && (item.scope.productId || item.receipt?.productId) === operation.scope.productId)) supplierFail(409, 'SUPPLIER_PUBLICATION_PENDING', 'Resolve the original in-flight or unknown write on this exact product first.'); if (operation.action === 'repair_draft' && actual.row.publicationOperations.some(item => item.action === 'publish' && item.connectorRunId && item.scope.productId === operation.scope.productId)) supplierFail(409, 'SHOPIFY_REPAIR_PUBLICATION_PRESENT', 'An admitted publication cannot be repaired or rolled back as a draft.'); replay(state, actor, sid, 'publication_execute', body); },
            onAdmitted(state, run) { const actual = locate(state, actor, cid, sid, operation.id); actual.operation.status = 'running'; actual.operation.connectorRunId = run.id; actual.operation.updatedAt = at(); remember(state, actor, sid, 'publication_execute', body, { operationId: operation.id }); },
          });
          await store.update(state => { const actual = locate(state, actor, cid, sid, operation.id); if (result.execution.status === 'succeeded') applyReceipt(actual.row, actual.operation, result.execution.result, 'original_connector_receipt'); else if (result.execution.status === 'blocked') { actual.operation.status = 'blocked'; actual.operation.error = result.execution.error; actual.operation.updatedAt = at(); } else uncertain(actual.row, actual.operation, result.execution.error || { code: 'SHOPIFY_PUBLICATION_UNCERTAIN' }); });
          return response(cid, sid, operation.id);
        },
        async reconcilePublication(cid, sid, body) {
          const found = checked(cid, sid, body), operation = found.operation;
          const previous = replay(store.read(), actor, sid, 'publication_reconcile', body).previous;
          if (previous) return response(cid, sid, operation.id, { duplicate: true, observation: previous.result.observation });
          if (!operation.connectorRunId) supplierFail(409, 'SUPPLIER_RECONCILIATION_NOT_REQUIRED', 'This operation has never been admitted for an external write.');
          if (operation.status === 'running' && store.read().capabilities.connectorRuns.find(item => item.id === operation.connectorRunId)?.status === 'running') supplierFail(409, 'SUPPLIER_PUBLICATION_BUSY', 'Wait for the original in-flight operation before reconciling it.');
          let observation;
          try { observation = await adapter.reconcile(operation.scope); }
          catch (error) { observation = { status: 'uncertain', found: false, complete: false, observedAt: at(), error: { code: error.code || 'SHOPIFY_RECEIPT_UNAVAILABLE' } }; }
          await store.update(state => { const actual = locate(state, actor, cid, sid, operation.id); applyReceipt(actual.row, actual.operation, observation, 'read_only_shopify_reconciliation'); remember(state, actor, sid, 'publication_reconcile', body, { operationId: operation.id, observation: clone(observation) }); });
          return response(cid, sid, operation.id, { observation });
        },
      };
    },
  };
}

/** Call after existing enterprise authentication/body checks, before the
 * general supplier route. The original /shopify-draft remains non-writing. */
export async function supplierPublicationHttp({ publication, req, res, pathname, context, body, respond, service, access }) {
  const match = pathname.match(/^\/api\/conversations\/([^/]+)\/supplier-services\/([^/]+)\/(publication|shopify-review|shopify-decision|shopify-execute|shopify-reconcile)$/);
  if (!match) return false;
  let cid, sid; try { cid = decodeURIComponent(match[1]); sid = decodeURIComponent(match[2]); } catch { supplierFail(400, 'INVALID_PATH', 'Encode the original supplier conversation and identifier once.'); }
  const helpers = service?.forActor(context), action = match[3];
  const controller = new AbortController();
  const watcher = action === 'shopify-execute' && req.method === 'POST' ? access?.watchStream(context, () => controller.abort('SESSION_REVOKED')) : null;
  const bound = publication.forActor(context, { ...(helpers ? { get: helpers.get } : {}), signal: controller.signal });
  if (req.method === 'GET' && action === 'publication') { await respond(res, 200, bound.publication(cid, sid)); return true; }
  const methods = { 'shopify-review': 'reviewPublication', 'shopify-decision': 'decidePublication', 'shopify-execute': 'executePublication', 'shopify-reconcile': 'reconcilePublication' };
  if (req.method !== 'POST' || !methods[action]) supplierFail(405, 'SUPPLIER_PUBLICATION_METHOD_INVALID', 'Use the documented exact review, decision, execution or read-only reconciliation operation.');
  try { if (watcher && !watcher.valid()) supplierFail(401, 'SESSION_REQUIRED', 'The original session expired before admission.'); await respond(res, 200, await bound[methods[action]](cid, sid, body)); return true; }
  finally { watcher?.stop(); }
}
