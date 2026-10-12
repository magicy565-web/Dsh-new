import { supplierFail, supplierHash } from './supplier-profile.mjs';
import { supplierOwned, supplierRequest } from './supplier-draft.mjs';
import { SUPPLIER_OWNER_MCP_OPERATIONS } from './supplier-owner-tools.mjs';

/** Shared service dispatch after the caller's original authorization checks.
 * This function creates no authority, grant, session or transport. */
export async function invokeSupplierOwnerOperation({ service, publication, artifacts, store, actor, conversationId, operation, serviceId, input, assertCurrent, signal }) {
  assertCurrent();
  const definition = SUPPLIER_OWNER_MCP_OPERATIONS[operation], bound = service.forActor(actor);
  if (serviceId) bound.get(conversationId, serviceId); else bound.list(conversationId);
  if (operation === 'image_upload') {
    if (!artifacts || !store) supplierFail(409, 'SUPPLIER_IMAGE_STORE_REQUIRED', 'Use the original Workspace artifact store.');
    supplierRequest(input, ['filename', 'base64', 'sourceNote']);
    if (typeof input.filename !== 'string' || !/\.(png|jpg|jpeg|webp)$/.test(input.filename) || typeof input.base64 !== 'string' || input.base64.length > 1_300_000 || typeof input.sourceNote !== 'string' || !input.sourceNote.trim() || input.sourceNote.length > 500) supplierFail(400, 'SUPPLIER_IMAGE_SOURCE_REQUIRED', 'Supply a bounded original PNG/JPEG/WebP image and provenance note.');
    const result = await artifacts.create({ requestId: `supplier-image-${supplierHash([actor.subject, actor.workspaceId, conversationId, input.requestId])}`, filename: input.filename, base64: input.base64, description: input.sourceNote, sourceConversationId: conversationId, metadata: { businessLibrary: { visibility: 'internal' } } }, { check(state) { assertCurrent(); supplierOwned(state, actor, conversationId); } });
    assertCurrent(); return result;
  }
  if (operation.startsWith('publication')) {
    if (!publication) supplierFail(409, 'SUPPLIER_PUBLICATION_BINDING_REQUIRED', 'Use the original supplier publication service and approvals.');
    const result = await publication.forActor(actor, { get: bound.get, signal })[definition.method](conversationId, serviceId, input);
    assertCurrent(); return result;
  }
  const result = await (operation === 'intake' ? bound.request(conversationId, input, serviceId) : bound[definition.method](conversationId, serviceId, input));
  assertCurrent(); return operation === 'monitors' ? { monitors: result } : result;
}
