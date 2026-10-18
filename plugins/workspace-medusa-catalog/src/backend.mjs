// Optional Medusa v2 adapter. Existing Workspace Library remains the source of truth.
// Medusa receives only reviewed title/description for an unpublished internal draft.
// No Shopify operations, prices, MOQ, policies, images, inventory or sales channels.
import { createHash } from 'node:crypto';
export function createMedusaCatalogBackend({ ApiError } = {}) {
  if (typeof ApiError !== 'function') throw TypeError('Original Host ApiError contract required.');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const SHA = /^[a-f0-9]{64}$/u;
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function actorGate(actor, workspaceId, writing = false) {
  if (!actor || actor.workspaceId !== workspaceId || !['admin', 'operator'].includes(actor.role) || writing && actor.role !== 'admin')
    fail(403, 'MEDUSA_ROLE_REQUIRED', 'Use an authorized original Workspace administrator.');
}
function productId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail(400, 'MEDUSA_PRODUCT_ID_INVALID', 'Use an exact original product UUID.');
  return value.toLowerCase();
}
function sourceProjection(product) {
  return { productId: productId(product.id), revision: product.revision, title: product.name,
    description: product.description, category: product.category, status: product.status,
    sourceKind: product.source?.kind || 'user_provided' };
}
function medusaSourceHash(product) {
  const p = sourceProjection(product);
  return digest([p.productId, p.revision, p.title, p.description, p.category, p.status, p.sourceKind]);
}
function medusaDraftHandle(workspaceId, productIdValue) {
  return 'ws-' + digest(workspaceId).slice(0, 12) + '-' + productId(productIdValue).replaceAll('-', '');
}
function createMedusaCatalogConfiguration(environment = {}, workspaceId = 'local') {
  if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 128)
    throw new TypeError('Medusa must use the exact original Workspace ID.');
  const endpoint = environment.WORKSPACE_MEDUSA_BASE_URL, secret = environment.WORKSPACE_MEDUSA_SECRET_API_KEY;
  const acknowledgement = environment.WORKSPACE_MEDUSA_SINGLE_TENANT_ACK === '1';
  const configured = acknowledgement && environment.WORKSPACE_MEDUSA_WORKSPACE_ID === workspaceId
    && typeof endpoint === 'string' && !!endpoint && typeof secret === 'string' && !!secret;
  if (!configured) return { configured: false, reason: 'MEDUSA_EXPLICIT_SINGLE_TENANT_CONFIGURATION_REQUIRED', workspaceId };
  let url;
  try { url = new URL(endpoint); } catch { throw new TypeError('Medusa URL must be an explicitly configured HTTPS or loopback HTTP origin.'); }
  const local = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && (url.protocol !== 'https:' || !/^[a-z0-9.-]+$/iu.test(url.hostname)
    || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/iu.test(url.hostname)))
    throw new TypeError('Medusa must use HTTPS or exact loopback HTTP.');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || /[\r\n]/u.test(endpoint)
    || url.port && !/^\d{1,5}$/u.test(url.port) || secret.length > 512 || !/^[\x21-\x7e]+$/u.test(secret))
    throw new TypeError('Unsafe Medusa endpoint or API key configuration.');
  return { configured: true, baseURL: url.origin, secret, workspaceId };
}
function safeRemote(product) {
  return { id: /^prod_[a-zA-Z0-9]+$/.test(product.id || '') ? product.id : null,
    status: ['draft', 'published', 'proposed', 'rejected'].includes(product.status) ? product.status : 'unknown',
    sourceRevision: Number.isSafeInteger(product.metadata?.workspace_source_revision) ? product.metadata.workspace_source_revision : null };
}
function remoteState(remote, expected, workspaceId, handle) {
  if (!remote) return { status: 'missing', product: null };
  const metadata = remote.metadata;
  if (!isObject(metadata) || metadata.workspace_catalog_schema !== 'workspace-medusa-draft-v1'
    || metadata.workspace_id !== workspaceId || metadata.workspace_source_product_id !== expected.productId
    || remote.handle !== handle) return { status: 'foreign', product: null };
  if (remote.status !== 'draft') return { status: 'not_draft', product: safeRemote(remote) };
  if (metadata.workspace_source_revision !== expected.revision || metadata.workspace_source_hash !== expected.sourceHash
    || remote.title !== expected.title || remote.description !== expected.description)
    return { status: 'stale', product: safeRemote(remote) };
  return { status: 'linked', product: safeRemote(remote) };
}
function validateBody(body, expected) {
  if (!isObject(body) || Object.keys(body).some(key => !['expectedRevision', 'sourceHash', 'requestId', 'confirmed'].includes(key))
    || !UUID.test(body.requestId || '') || body.expectedRevision !== expected.revision
    || typeof body.sourceHash !== 'string' || !SHA.test(body.sourceHash) || body.sourceHash !== expected.sourceHash
    || body.confirmed !== true) fail(409, 'MEDUSA_SOURCE_REVIEW_REQUIRED', 'Review the current exact product revision and retry with a confirmed draft request.');
}
async function bodyLimited(response, limit = 262144) {
  const reader = response.body?.getReader();
  if (!reader) fail(502, 'MEDUSA_EMPTY_RESPONSE', 'Medusa returned no readable response.');
  const chunks = []; let size = 0;
  try {
    for (;;) { const row = await reader.read(); if (row.done) break; size += row.value.byteLength;
      if (size > limit) fail(502, 'MEDUSA_RESPONSE_LIMIT', 'Medusa response exceeded the accepted size.');
      chunks.push(row.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(502, 'MEDUSA_INVALID_RESPONSE', 'Medusa returned malformed JSON.'); }
}
function createMedusaCatalogService({ library, workspaceId = 'local', environment = {}, fetchImpl = globalThis.fetch } = {}) {
  if (!library || typeof library.getProduct !== 'function' || typeof fetchImpl !== 'function')
    throw new TypeError('Medusa needs the original Library and a bounded HTTP transport.');
  const config = createMedusaCatalogConfiguration(environment, workspaceId);
  const safeStatus = () => ({ provider: 'medusa-v2', configured: config.configured,
    connection: config.configured ? 'configured_unverified' : 'unconfigured',
    reason: config.configured ? null : config.reason,
    mode: 'internal_draft_only', authorizedBy: 'original_workspace', singleTenant: config.configured,
    publicListing: false, publicationEnabled: false, externalInventoryWrites: false });
  async function transport(method, path, payload = undefined, signal) {
    if (!config.configured) fail(409, 'MEDUSA_UNCONFIGURED', 'Medusa single-tenant connection is not configured.');
    signal?.throwIfAborted();
    const controller = AbortSignal.timeout(10000);
    const combined = signal ? AbortSignal.any([signal, controller]) : controller;
    let response;
    try { response = await fetchImpl(config.baseURL + path, { method, signal: combined,
      redirect: 'error', cache: 'no-store',
      headers: { Authorization: 'Basic ' + config.secret,
        Accept: 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); }
    catch (error) { if (signal?.aborted) throw error;
      fail(502, 'MEDUSA_TRANSPORT_UNCERTAIN', 'Medusa connection was interrupted. Reconcile the original product handle before retrying any draft write.'); }
    const result = await bodyLimited(response);
    if (!response.ok) fail(response.status === 401 || response.status === 403 ? 502 : response.status >= 500 ? 502 : 409,
      'MEDUSA_REMOTE_REFUSED', 'Medusa rejected the request. Inspect its administrator logs; no fallback operation was attempted.');
    return result;
  }
  const requireProduct = value => {
    const { product } = library.getProduct(productId(value));
    if (!product) fail(404, 'MEDUSA_PRODUCT_NOT_FOUND', 'Original product not found.');
    return product;
  };
  function projection(product) {
    const source = sourceProjection(product);
    return { ...source, sourceHash: medusaSourceHash(product), handle: medusaDraftHandle(workspaceId, source.productId),
      ignoredFields: ['skus', 'prices', 'moq', 'supply', 'documents', 'images', 'inventory', 'sales_channels'],
      eligible: product.status === 'draft' && product.source?.kind !== 'public_reference' };
  }
  function preview(id, actor) {
    actorGate(actor, workspaceId);
    return { medusa: safeStatus(), preview: projection(requireProduct(id)) };
  }
  async function remoteLookup(expected, signal) {
    const query = new URLSearchParams({ handle: expected.handle, limit: '3',
      fields: 'id,handle,title,description,status,+metadata' });
    const answer = await transport('GET', '/admin/products?' + query, undefined, signal);
    if (!Array.isArray(answer?.products) || answer.products.length > 3 || !Number.isSafeInteger(answer.count)
      || answer.count < 0 || answer.count > 3)
      fail(502, 'MEDUSA_INVALID_RESPONSE', 'Medusa product list shape is unsupported.');
    if (answer.count === 0 && answer.products.length === 0) return null;
    const matches = answer.products.filter(p => p?.handle === expected.handle);
    if (answer.count !== 1 || answer.products.length !== 1 || matches.length !== 1)
      fail(409, 'MEDUSA_HANDLE_AMBIGUOUS', 'Remote draft handle is ambiguous. Administrator reconciliation is required.');
    return matches[0];
  }
  async function reconcile(id, actor, signal) {
    actorGate(actor, workspaceId);
    const expected = projection(requireProduct(id));
    if (!config.configured) return { medusa: safeStatus(), preview: expected, remote: { status: 'unconfigured', product: null } };
    const remote = await remoteLookup(expected, signal);
    return { medusa: safeStatus(), preview: expected, remote: remoteState(remote, expected, workspaceId, expected.handle) };
  }
  async function saveDraft(id, body, actor, signal) {
    actorGate(actor, workspaceId, true);
    if (!config.configured) fail(409, 'MEDUSA_UNCONFIGURED', 'Configure a dedicated Medusa v2 instance before saving.');
    const expected = projection(requireProduct(id));
    validateBody(body, expected);
    if (!expected.eligible) fail(409, 'MEDUSA_NOT_ELIGIBLE', 'Only owned original product drafts can become internal Medusa drafts.');
    if (!expected.title?.trim() || typeof expected.description !== 'string'
      || expected.title.length > 200 || expected.description.length > 8000)
      fail(409, 'MEDUSA_SOURCE_INCOMPLETE', 'Original draft title and description must be reviewed and within limits.');
    const before = remoteState(await remoteLookup(expected, signal), expected, workspaceId, expected.handle);
    if (before.status === 'linked') return { medusa: safeStatus(), preview: expected, remote: before, created: false, requestId: body.requestId };
    if (before.status !== 'missing') fail(409, 'MEDUSA_REMOTE_CONFLICT', 'An existing draft differs from the reviewed original. No remote overwrite was attempted.');
    // Recheck original source immediately before the remote write.
    const current = projection(requireProduct(id));
    if (current.sourceHash !== expected.sourceHash)
      fail(409, 'MEDUSA_SOURCE_CHANGED', 'The original Library changed before the remote write.');
    const payload = { title: expected.title, description: expected.description, handle: expected.handle, status: 'draft',
      metadata: { workspace_catalog_schema: 'workspace-medusa-draft-v1', workspace_id: workspaceId,
        workspace_source_product_id: expected.productId, workspace_source_revision: expected.revision,
        workspace_source_hash: expected.sourceHash } };
    const answer = await transport('POST', '/admin/products', payload, signal);
    const result = remoteState(answer?.product, expected, workspaceId, expected.handle);
    if (result.status !== 'linked')
      fail(502, 'MEDUSA_WRITE_UNVERIFIED', 'Medusa did not confirm a matching draft. Reconcile before any further operation.');
    return { medusa: safeStatus(), preview: expected, remote: result, created: true, requestId: body.requestId };
  }
  return Object.freeze({ status: safeStatus, preview, reconcile, saveDraft });
}

return Object.freeze({ createMedusaCatalogConfiguration, createMedusaCatalogService, medusaSourceHash, medusaDraftHandle });
}
