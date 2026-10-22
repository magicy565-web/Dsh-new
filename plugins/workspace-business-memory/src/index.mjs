// Harness plugin: one independent, source-pinned business memory per workspace.
//
// The plugin owns storage, HTTP routes, model tools and health only. It has no
// credential discovery, no model access and no external write path. A model may
// recall memory and propose new candidates; a human administrator decides what
// becomes active. Verified upstream sources are read through a reviewed HTTP
// adapter (the Workspace Product Library is the first configured one).
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { isAbsolute } from 'node:path';
import {
  BusinessMemoryError, CONFIDENCE, KINDS, SOURCE_KINDS, SUBJECT_LABELS, SUBJECT_TYPES,
  createBusinessMemoryService,
} from './domain.mjs';
import { AREA_PATH, renderAreaPage } from './area.mjs';
import { authorizeService } from './service-auth.mjs';

export const PLUGIN_ID = 'workspace-business-memory';
const BASE = '/api/business-memory';
export const ROUTES = Object.freeze([
  ['GET', `${BASE}/status`],
  ['GET', `${BASE}/map`],
  ['GET', `${BASE}/brief`],
  ['POST', `${BASE}/context`],
  ['POST', `${BASE}/service/context`],
  ['POST', `${BASE}/service/verify`],
  ['GET', `${BASE}/injections`],
  ['GET', `${BASE}/records`],
  ['GET', `${BASE}/records/:id`],
  ['POST', `${BASE}/records`],
  ['POST', `${BASE}/records/:id/review`],
  ['POST', `${BASE}/records/:id/revoke`],
  ['GET', AREA_PATH],
]);
export const TOOL_NAMES = Object.freeze([
  'business_memory_status', 'business_memory_recall', 'business_memory_read',
  'business_memory_map', 'business_memory_brief', 'business_memory_propose',
  'business_memory_review', 'business_memory_revoke',
]);
const CONFIG_KEYS = Object.freeze(['workspaceId', 'productLibraryBaseURL', 'allowLoopbackHTTP', 'allowConversationSources', 'serviceTokenFile', 'timeoutMs']);
const MAX_RESPONSE_BYTES = 1024 * 1024;

const manifestError = message => new HarnessError(ERROR.manifestInvalid, message);
const missing = service => new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`);

function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof BusinessMemoryError) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

function validateConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw manifestError(`${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).some(key => !CONFIG_KEYS.includes(key)))
    throw manifestError(`${PLUGIN_ID} config has an unsupported field.`);
  if (config.workspaceId !== undefined && (typeof config.workspaceId !== 'string' || !config.workspaceId))
    throw manifestError('config.workspaceId must be a non-empty string.');
  if (config.productLibraryBaseURL !== undefined) {
    let url;
    try { url = new URL(config.productLibraryBaseURL); } catch { throw manifestError('config.productLibraryBaseURL must be an absolute HTTP(S) origin.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password)
      throw manifestError('config.productLibraryBaseURL must be an exact HTTP(S) origin without credentials, path, query or fragment.');
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname) && config.allowLoopbackHTTP !== true)
      throw manifestError('Plain HTTP product library URLs are only allowed on loopback; set allowLoopbackHTTP for an explicitly reviewed host.');
  }
  if (config.allowLoopbackHTTP !== undefined && typeof config.allowLoopbackHTTP !== 'boolean')
    throw manifestError('config.allowLoopbackHTTP must be a boolean.');
  if (config.allowConversationSources !== undefined && typeof config.allowConversationSources !== 'boolean')
    throw manifestError('config.allowConversationSources must be a boolean.');
  if (config.serviceTokenFile !== undefined
    && (typeof config.serviceTokenFile !== 'string' || !isAbsolute(config.serviceTokenFile)))
    throw manifestError('config.serviceTokenFile must be an absolute path to a private token file.');
  if (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 50 || config.timeoutMs > 10000))
    throw manifestError('config.timeoutMs must be an integer between 50 and 10000.');
  return config;
}

/**
 * Read one pinned product-library page and prove the exact version and SHA.
 * The product library remains the authority; this adapter stores no product
 * facts and never writes to the product room.
 */
async function productPageProof(source, config, signal) {
  if (!config.productLibraryBaseURL)
    throw new BusinessMemoryError(503, 'BUSINESS_MEMORY_SOURCE_UNCONFIGURED',
      'No reviewed product library is bound; product-page memory sources stay unavailable.');
  const base = config.productLibraryBaseURL;
  const url = `${base}/api/product-library/products/${encodeURIComponent(source.productId)}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs ?? 5000)].filter(Boolean)),
    });
  } catch {
    throw new BusinessMemoryError(503, 'BUSINESS_MEMORY_SOURCE_UNAVAILABLE',
      'The reviewed product library could not be reached; no memory was written.');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES)
    throw new BusinessMemoryError(502, 'BUSINESS_MEMORY_SOURCE_INVALID', 'The product library returned an oversized response.');
  if (!response.ok) {
    if (response.status === 404)
      throw new BusinessMemoryError(409, 'BUSINESS_MEMORY_SOURCE_NOT_FOUND',
        'The pinned product page does not exist in the product library.');
    throw new BusinessMemoryError(503, 'BUSINESS_MEMORY_SOURCE_UNAVAILABLE',
      'The product library refused the source check; no memory was written.');
  }
  let payload;
  try { payload = JSON.parse(text); } catch {
    throw new BusinessMemoryError(502, 'BUSINESS_MEMORY_SOURCE_INVALID', 'The product library returned non-JSON data.');
  }
  const page = Array.isArray(payload?.pages) ? payload.pages.find(item => item?.id === source.pageId) : null;
  if (!page) throw new BusinessMemoryError(409, 'BUSINESS_MEMORY_SOURCE_NOT_FOUND', 'The pinned product page no longer exists.');
  if (page.version !== source.version)
    throw new BusinessMemoryError(409, 'BUSINESS_MEMORY_SOURCE_STALE', 'The product page moved to another version; re-read and pin the current one.');
  const version = Array.isArray(page.history) ? page.history.find(item => item?.version === source.version) : null;
  if (!version || typeof version.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(version.sha256))
    throw new BusinessMemoryError(409, 'BUSINESS_MEMORY_SOURCE_UNVERIFIED', 'The product page version hash is unavailable.');
  if (source.sha256 !== null && source.sha256 !== version.sha256)
    throw new BusinessMemoryError(409, 'BUSINESS_MEMORY_SOURCE_MISMATCH', 'The pinned product page bytes no longer match the requested SHA-256.');
  const title = typeof payload?.pin?.product?.title === 'string' ? payload.pin.product.title : '产品资料';
  const pageTitle = typeof page.title === 'string' ? page.title : '页面';
  return { verified: true, sha256: version.sha256, label: `产品资料 · ${title} · ${pageTitle}`.slice(0, 200) };
}

function createSourceVerifier(config) {
  return async function verifySource(source, { signal } = {}) {
    if (source.kind === 'product-page') return productPageProof(source, config, signal);
    if (source.kind === 'document')
      throw new BusinessMemoryError(503, 'BUSINESS_MEMORY_SOURCE_UNCONFIGURED',
        'No reviewed enterprise document source is bound; document memory sources stay unavailable.');
    if (source.kind === 'conversation') {
      if (config.allowConversationSources === false)
        throw new BusinessMemoryError(503, 'BUSINESS_MEMORY_SOURCE_UNCONFIGURED', 'Conversation memory sources are disabled in this harness.');
      return { verified: false };
    }
    return { verified: false };
  };
}

/**
 * Mount the plugin on a kernel context.
 * @param {object} ctx Cordis context with storage/http/tools/health
 * @param {{workspaceId?: string, productLibraryBaseURL?: string, allowLoopbackHTTP?: boolean, allowConversationSources?: boolean, timeoutMs?: number}} [config]
 */
export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (!ctx?.storage?.read || !ctx?.storage?.update) throw missing('storage');
  if (!ctx?.tools?.register) throw missing('tools');
  const checked = validateConfig(config);
  const workspaceId = checked.workspaceId ?? 'local';
  const resolveWorkspace = typeof ctx.workspace?.resolve === 'function'
    ? actor => {
      const resolved = ctx.workspace.resolve(actor);
      return { workspaceId: resolved.workspaceId, subject: resolved.subject, role: resolved.role };
    }
    : null;
  const service = createBusinessMemoryService({
    storage: ctx.storage,
    workspaceId,
    resolveWorkspace,
    verifySource: createSourceVerifier(checked),
    allowConversationSources: checked.allowConversationSources !== false,
    audit: ctx.audit ?? null,
  });
  return applyService(ctx, service, { workspaceId, serviceTokenFile: checked.serviceTokenFile ?? null });
}

/** Mount with a test/embedder-supplied service; exported for verification. */
export async function applyService(ctx, service, options = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (!ctx?.tools?.register) throw missing('tools');
  if (!service || typeof service.recall !== 'function' || typeof service.propose !== 'function')
    throw new TypeError('A Business Memory service is required.');
  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };
  const tool = (args, execution, fn) => {
    try { return Promise.resolve(fn(execution ?? {})).catch(error => { throw asHarnessError(error); }); }
    catch (error) { throw asHarnessError(error); }
  };

  ctx.http.route({ method: 'GET', path: `${BASE}/status`, handler: call(context => ({ status: 200, body: service.status(context) })) });
  ctx.http.route({ method: 'GET', path: `${BASE}/map`, handler: call(context => ({ status: 200, body: service.map(context) })) });
  ctx.http.route({ method: 'GET', path: `${BASE}/brief`, handler: call(context => ({ status: 200, body: service.brief(context) })) });
  ctx.http.route({
    method: 'POST', path: `${BASE}/context`,
    handler: call(async context => ({ status: 200, body: await service.compileContext(context, context.body ?? {}) })),
  });
  ctx.http.route({
    method: 'GET', path: `${BASE}/injections`,
    handler: call(context => ({ status: 200, body: service.injections(context, context.query ?? {}) })),
  });
  ctx.http.route({
    method: 'GET', path: `${BASE}/records`,
    handler: call(context => ({ status: 200, body: service.recall(context, context.query ?? {}) })),
  });
  ctx.http.route({
    method: 'GET', path: `${BASE}/records/:id`,
    handler: call(context => ({ status: 200, body: service.read(context, context.params?.id) })),
  });
  ctx.http.route({
    method: 'POST', path: `${BASE}/records`,
    handler: call(context => service.propose(context, context.body ?? {}).then(result => ({ status: 201, body: result }))),
  });
  ctx.http.route({
    method: 'POST', path: `${BASE}/records/:id/review`,
    handler: call(context => service.review(context, context.params?.id, context.body ?? {}).then(result => ({ status: 200, body: result }))),
  });
  ctx.http.route({
    method: 'POST', path: `${BASE}/records/:id/revoke`,
    handler: call(context => service.revoke(context, context.params?.id, context.body ?? {}).then(result => ({ status: 200, body: result }))),
  });
  ctx.http.route({
    method: 'GET', path: AREA_PATH,
    handler: async (_req, _res, context) => {
      try {
        service.status(context ?? {}); // Fail closed for callers outside the workspace before serving the area.
        return renderAreaPage();
      } catch (error) { throw asHarnessError(error); }
    },
  });

  // Service bridge: the only path a separate host process may use. It is
  // authenticated by a dedicated token (never by the actor headers the kernel
  // derives from x-harness-*), and it is bound to this composition's workspace.
  const serviceOptions = {
    tokenFile: options.serviceTokenFile ?? null,
    workspaceId: options.workspaceId ?? 'local',
  };
  ctx.http.route({
    method: 'POST', path: `${BASE}/service/context`,
    handler: async (request, _res, context) => {
      try {
        const actor = await authorizeService(request, serviceOptions);
        return { status: 200, body: await service.compileContext({ actor, trustedService: true }, context?.body ?? {}) };
      } catch (error) { throw asHarnessError(error); }
    },
  });
  ctx.http.route({
    method: 'POST', path: `${BASE}/service/verify`,
    handler: async (request, _res, context) => {
      try {
        const actor = await authorizeService(request, serviceOptions);
        return { status: 200, body: service.assertFacts({ actor, trustedService: true }, context?.body ?? {}) };
      } catch (error) { throw asHarnessError(error); }
    },
  });

  const subjectProperty = { type: 'string', enum: [...SUBJECT_TYPES] };
  const sourceSchema = {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...SOURCE_KINDS] },
      label: { type: 'string', maxLength: 200 },
      basis: { type: 'string', maxLength: 500, description: 'Required for operator sources: why this fact is believed.' },
      ref: { type: 'string', maxLength: 300, description: 'Required for conversation sources: the exact conversation or message reference.' },
      productId: { type: 'string', maxLength: 128, description: 'Required for product-page sources.' },
      pageId: { type: 'string', maxLength: 64, description: 'Required for product-page sources.' },
      version: { type: 'integer', minimum: 1, description: 'Required for product-page/document sources.' },
      documentId: { type: 'string', maxLength: 64, description: 'Required for document sources.' },
      sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    },
    required: ['kind'],
    additionalProperties: false,
  };

  ctx.tools.register({
    name: 'business_memory_status',
    description: 'Read this workspace\'s business memory status: how many facts are active, proposed, superseded or revoked, which subject types are covered and whether external source verification is available. `proposed` memories are candidates only and are not business facts yet.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    approval: 'never', readOnly: true, authority: 'workspace',
    handler: async (_args, execution) => tool(_args, execution, context => service.status(context)),
  });

  ctx.tools.register({
    name: 'business_memory_recall',
    description: 'Recall confirmed business memory from this workspace, filtered by subject, fact key, kind or free text. Active memories are human-approved facts with a pinned source; proposed candidates are excluded unless `status` asks for them. Use this before giving business advice so the answer is grounded in stored facts instead of guesses.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', maxLength: 200, description: 'Case-insensitive text to find in the statement, subject label, fact key or tags.' },
        subjectType: subjectProperty,
        subjectId: { type: 'string', maxLength: 128 },
        factKey: { type: 'string', maxLength: 128 },
        kind: { type: 'string', enum: [...KINDS] },
        status: { type: 'string', enum: ['active', 'proposed', 'rejected', 'superseded', 'revoked', 'all'], description: 'Defaults to active.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum rows; defaults to 20.' },
      },
      additionalProperties: false,
    },
    approval: 'never', readOnly: true, authority: 'workspace',
    handler: async (args, execution) => tool(args, execution, context => service.recall(context, args ?? {})),
  });

  ctx.tools.register({
    name: 'business_memory_read',
    description: 'Read one business memory with its exact source, attestation, revision history and related records for the same fact key. Only active records are readable by viewers; proposals are visible to operators and administrators.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' } },
      required: ['id'], additionalProperties: false,
    },
    approval: 'never', readOnly: true, authority: 'workspace',
    handler: async (args, execution) => tool(args, execution, context => service.read(context, args?.id)),
  });

  ctx.tools.register({
    name: 'business_memory_map',
    description: 'Read the business memory map for this workspace: coverage per business subject (company, product, customer, market, channel, operation), active/proposed counts and recent activations. Coverage is a structural count, not a quality or revenue score.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    approval: 'never', readOnly: true, authority: 'workspace',
    handler: async (_args, execution) => tool(_args, execution, context => service.map(context)),
  });

  ctx.tools.register({
    name: 'business_memory_brief',
    description: 'Read the deterministic growth brief computed from this workspace\'s stored memory: coverage gaps, pending reviews, expiring facts and unresolved decisions. Every signal cites existing memory ids. It contains no forecast, probability, causal claim or fabricated metric, and creates no Goal, approval or external action.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    approval: 'never', readOnly: true, authority: 'workspace',
    handler: async (_args, execution) => tool(_args, execution, context => service.brief(context)),
  });

  ctx.tools.register({
    name: 'business_memory_propose',
    description: 'Propose one new business memory candidate. The record is created as `proposed`, never active: an administrator must review it before it enters business facts. Operator sources require a basis; conversation sources point at the exact conversation and stay human-attested. Product-page sources are verified against the reviewed product library at write and review time. Never propose predictions, prices or outcomes that were not observed.',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', description: 'Idempotency key for this exact proposal.' },
        subjectType: subjectProperty,
        subjectId: { type: 'string', maxLength: 128 },
        subjectLabel: { type: 'string', maxLength: 200 },
        factKey: { type: 'string', maxLength: 128, description: 'Stable key of the fact, for example moq, lead-time, buyer-profile.' },
        kind: { type: 'string', enum: [...KINDS] },
        statement: { type: 'string', maxLength: 2000 },
        detail: { type: 'string', maxLength: 8000 },
        confidence: { type: 'string', enum: [...CONFIDENCE] },
        source: sourceSchema,
        tags: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 40 } },
        expiresAt: { type: 'string', maxLength: 40 },
      },
      required: ['requestId', 'subjectType', 'subjectId', 'subjectLabel', 'factKey', 'statement', 'source'],
      additionalProperties: false,
    },
    approval: 'always', authority: 'workspace',
    handler: async (args, execution) => tool(args, execution, context => service.propose(context, args ?? {}).then(result => result.record)),
  });

  ctx.tools.register({
    name: 'business_memory_review',
    description: 'Administrator review of one proposed memory: approve it into active facts or reject it. Approval re-verifies an external source and supersedes the current active record for the same subject and fact key. Approval here is internal knowledge review; it does not approve spending, publish a product or grant model disclosure.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
        decision: { type: 'string', enum: ['approve', 'reject'] },
        note: { type: 'string', maxLength: 500 },
        requestId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
      },
      required: ['id', 'decision', 'requestId'], additionalProperties: false,
    },
    approval: 'always', authority: 'workspace',
    handler: async (args, execution) => tool(args, execution, context => service.review(context, args?.id, args ?? {}).then(result => result.record)),
  });

  ctx.tools.register({
    name: 'business_memory_revoke',
    description: 'Administrator revocation of one active or proposed business memory. Revocation removes it from active business facts while preserving its revision history and source. It cannot be undone; a corrected fact must be proposed and approved again.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
        reason: { type: 'string', maxLength: 500 },
        requestId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
      },
      required: ['id', 'requestId'], additionalProperties: false,
    },
    approval: 'always', authority: 'workspace',
    handler: async (args, execution) => tool(args, execution, context => service.revoke(context, args?.id, args ?? {}).then(result => result.record)),
  });

  let disposeService = null;
  if (typeof ctx.provide === 'function') disposeService = ctx.provide('businessMemory', service);
  if (ctx.health?.register) {
    ctx.health.register('business-memory', () => {
      const value = service.status({});
      return { status: 'ok', detail: { workspaceId: value.workspaceId, active: value.active, proposed: value.proposed, sourceKinds: value.sourceKinds } };
    });
  }
  return async () => { if (typeof disposeService === 'function') await disposeService(); };
}

export { BusinessMemoryError, SUBJECT_LABELS };
export default { apply };
