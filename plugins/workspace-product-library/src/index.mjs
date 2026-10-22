// Harness plugin: a ChatGPT-Space-shaped Product Library over Medusa products
// and their approved Product Context.
//
// The plugin owns storage, routes, tools and health only. It has no credential
// discovery, no model access and no Medusa write path: the Product Context
// review surface remains the only writer of product facts.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { createProductLibraryService, ProductLibraryError } from './library.mjs';
import { PRODUCTS_PAGE } from './area.mjs';
import { createSourceFromConfig, unconfiguredSource } from './source.mjs';

export const PLUGIN_ID = 'workspace-product-library';
const BASE = '/api/product-library';
const ROUTES = Object.freeze([
  ['GET', `${BASE}/status`],
  ['GET', `${BASE}/products`],
  ['GET', `${BASE}/search`],
  ['GET', `${BASE}/products/:productId`],
  ['POST', `${BASE}/products/:productId/open`],
  ['POST', `${BASE}/products/:productId/sync`],
  ['POST', `${BASE}/products/:productId/pages`],
  ['POST', `${BASE}/products/:productId/pages/:pageId/save`],
  ['POST', `${BASE}/products/:productId/pages/:pageId/comments`],
  ['POST', `${BASE}/products/:productId/pages/:pageId/approve`],
  ['POST', `${BASE}/products/:productId/documents`],
  ['GET', `${BASE}/products/:productId/documents/:documentId`],
  ['GET', '/products'],
]);
const TOOL_NAMES = Object.freeze([
  'product_library_status', 'product_library_list', 'product_library_search', 'product_library_read',
  'product_library_open', 'product_library_sync', 'product_library_create_page',
  'product_library_save_page', 'product_library_comment', 'product_library_approve_page',
]);
const SOURCE_KEYS = Object.freeze(['kind', 'baseURL', 'readTokenFile', 'allowLoopbackHTTP', 'timeoutMs']);

function manifestError(message) { return new HarnessError(ERROR.manifestInvalid, message); }
function missing(service) { return new HarnessError(ERROR.pluginMissingDependency, `${PLUGIN_ID} requires ctx.${service}.`); }
function asHarnessError(error) {
  if (error instanceof HarnessError) return error;
  if (error instanceof ProductLibraryError) {
    const wrapped = new HarnessError(error.code, error.message);
    wrapped.status = error.status;
    return wrapped;
  }
  return error;
}

function validateConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw manifestError('workspace-product-library config must be an object.');
  if (Object.keys(config).some(key => !['workspaceId', 'source'].includes(key)))
    throw manifestError('workspace-product-library config has an unsupported field.');
  if (config.workspaceId !== undefined && (typeof config.workspaceId !== 'string' || !config.workspaceId))
    throw manifestError('workspace-product-library config.workspaceId must be a non-empty string.');
  if (config.source !== undefined && (config.source === null || typeof config.source !== 'object' || Array.isArray(config.source)
    || Object.keys(config.source).some(key => !SOURCE_KEYS.includes(key))))
    throw manifestError('workspace-product-library config.source is invalid.');
  return config;
}

const citationSchema = {
  type: 'object',
  properties: {
    source: { type: 'string', enum: ['product', 'context', 'evidence'] },
    field: { type: 'string', maxLength: 120 },
    label: { type: 'string', maxLength: 240 },
  },
  required: ['source', 'field'],
  additionalProperties: false,
};

/**
 * Mount the plugin on a kernel context.
 * @param {object} ctx Cordis context with storage/http/tools/health
 * @param {{workspaceId?: string, source?: object}} [config]
 */
export async function apply(ctx, config = {}) {
  if (!ctx?.http?.route) throw missing('http');
  if (!ctx?.storage?.read || !ctx?.storage?.update) throw missing('storage');
  if (!ctx?.artifacts?.create || !ctx?.artifacts?.download) throw missing('artifacts');
  if (!ctx?.tools?.register) throw missing('tools');
  const checked = validateConfig(config);
  const workspaceId = checked.workspaceId ?? 'local';
  let source;
  try {
    source = await createSourceFromConfig(checked.source, {
      authorizeActor: actor => actor?.workspaceId === workspaceId && ['admin', 'operator', 'viewer'].includes(actor?.role),
    });
  } catch (error) {
    if (error instanceof ProductLibraryError) throw manifestError(error.message);
    throw manifestError(error.message);
  }
  const service = createProductLibraryService({ storage: ctx.storage, source, artifacts: ctx.artifacts, workspaceId });
  return applyService(ctx, service);
}

/** Mount with a test/embedder-supplied service; exported for verification. */
export async function applyService(ctx, service) {
  if (!ctx?.http?.route) throw missing('http');
  if (!ctx?.tools?.register) throw missing('tools');
  if (!service || typeof service.read !== 'function' || typeof service.list !== 'function')
    throw new TypeError('A Product Library service is required.');

  const status = () => service.status();
  const call = handler => async (_req, _res, context) => {
    try { return await handler(context ?? {}); }
    catch (error) { throw asHarnessError(error); }
  };

  ctx.http.route({
    method: 'GET', path: '/products',
    handler: () => new Response(PRODUCTS_PAGE, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    }),
  });

  ctx.http.route({ method: 'GET', path: `${BASE}/status`, handler: call(async () => ({ status: 200, body: status() })) });
  ctx.http.route({ method: 'GET', path: `${BASE}/products`, handler: call(async context => ({ status: 200, body: await service.list(context, context.query ?? {}) })) });
  ctx.http.route({ method: 'GET', path: `${BASE}/search`, handler: call(async context => ({ status: 200, body: await service.search(context, context.query ?? {}) })) });
  ctx.http.route({ method: 'GET', path: `${BASE}/products/:productId`, handler: call(async context => ({ status: 200, body: await service.read(context, context.params?.productId) })) });
  ctx.http.route({ method: 'POST', path: `${BASE}/products/:productId/open`, handler: call(context => service.open(context, context.params?.productId, context.body ?? {})) });
  ctx.http.route({ method: 'POST', path: `${BASE}/products/:productId/sync`, handler: call(context => service.sync(context, context.params?.productId, context.body ?? {})) });
  ctx.http.route({ method: 'POST', path: `${BASE}/products/:productId/pages`, handler: call(context => service.createPage(context, context.params?.productId, context.body ?? {})) });
  ctx.http.route({ method: 'POST', path: `${BASE}/products/:productId/pages/:pageId/save`, handler: call(context => service.savePage(context, context.params?.productId, context.params?.pageId, context.body ?? {})) });
  ctx.http.route({ method: 'POST', path: `${BASE}/products/:productId/pages/:pageId/comments`, handler: call(context => service.comment(context, context.params?.productId, context.params?.pageId, context.body ?? {})) });
  ctx.http.route({ method: 'POST', path: `${BASE}/products/:productId/pages/:pageId/approve`, handler: call(context => service.approve(context, context.params?.productId, context.params?.pageId, context.body ?? {})) });
  ctx.http.route({ method: 'POST', path: `${BASE}/products/:productId/documents`, handler: call(context => service.attachDocument(context, context.params?.productId, context.body ?? {})) });
  ctx.http.route({
    method: 'GET', path: `${BASE}/products/:productId/documents/:documentId`,
    handler: async (_req, _res, context) => {
      try {
        const result = await service.downloadDocument(context ?? {}, context?.params?.productId, context?.params?.documentId);
        const fallback = result.filename.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_');
        return new Response(result.bytes, {
          status: 200,
          headers: {
            'content-type': result.mimeType,
            'content-length': String(result.bytes.length),
            'content-disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        });
      } catch (error) { throw asHarnessError(error); }
    },
  });

  const toolContext = execution => ({ actor: execution?.actor });
  const tool = definition => ctx.tools.register(definition);

  tool({
    name: 'product_library_status',
    description: 'Read Product Library configuration and counts. `configured:false` means no reviewed Medusa Product Context source is bound; the library then has no live product facts and must not be described as connected.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    approval: 'never',
    readOnly: true,
    authority: 'workspace',
    handler: async () => status(),
  });

  tool({
    name: 'product_library_list',
    description: 'List products that have an approved Medusa Product Context, merged with whether each already has a Product Library room. When the reviewed source is not configured, only existing rooms are listed and a warning code is returned. No product facts are invented.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', maxLength: 200, description: 'Optional substring over the product title.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum rows; defaults to 20.' },
      },
      additionalProperties: false,
    },
    approval: 'never',
    readOnly: true,
    authority: 'workspace',
    handler: async (args, execution) => service.list(toolContext(execution), args ?? {}),
  });

  tool({
    name: 'product_library_search',
    description: 'Search inside opened Product Library rooms: product titles, page titles and bodies, and document labels/filenames. Returns bounded snippets with product/page/document ids. It does not invent Medusa products that have no room and does not return document bytes.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', minLength: 1, maxLength: 200, description: 'Case-insensitive substring to find.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum hits; defaults to 20.' },
      },
      required: ['q'],
      additionalProperties: false,
    },
    approval: 'never',
    readOnly: true,
    authority: 'workspace',
    handler: async (args, execution) => service.search(toolContext(execution), args ?? {}),
  });

  tool({
    name: 'product_library_read',
    description: 'Read one Product Library room: the pinned product and approved Product Context, its pages with citation status (current/stale/missing), comments and approval state. Citations are checked against the pinned source; `stale` means the page was written against an older revision and should be re-pinned before reuse.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string', pattern: '^prod_[A-Za-z0-9_-]{1,123}$', description: 'Exact Medusa product id.' } },
      required: ['productId'],
      additionalProperties: false,
    },
    approval: 'never',
    readOnly: true,
    authority: 'workspace',
    handler: async (args, execution) => service.read(toolContext(execution), args?.productId),
  });

  tool({
    name: 'product_library_open',
    description: 'Open (or return the existing) Product Library room for one approved product context. This pins the exact product and approved context by hash and is an internal library write, never a Medusa write or publication.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', pattern: '^prod_[A-Za-z0-9_-]{1,123}$' },
        requestId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', description: 'Idempotency key.' },
      },
      required: ['productId', 'requestId'],
      additionalProperties: false,
    },
    approval: 'always',
    authority: 'workspace',
    handler: async (args, execution) => (await service.open(toolContext(execution), args?.productId, args ?? {})).body,
  });

  tool({
    name: 'product_library_sync',
    description: 'Re-pin one room to the current approved Product Context and report changed fields plus pages whose citations became stale. It never approves context, edits Medusa or changes a page body.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', pattern: '^prod_[A-Za-z0-9_-]{1,123}$' },
        requestId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
      },
      required: ['productId', 'requestId'],
      additionalProperties: false,
    },
    approval: 'always',
    authority: 'workspace',
    handler: async (args, execution) => (await service.sync(toolContext(execution), args?.productId, args ?? {})).body,
  });

  tool({
    name: 'product_library_create_page',
    description: 'Create a versioned Product Library page for one room. Cite only fields that exist on the pinned product or approved context; unknown citations are refused. The page is an internal draft until an administrator approves it.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', pattern: '^prod_[A-Za-z0-9_-]{1,123}$' },
        requestId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
        title: { type: 'string', maxLength: 200 },
        body: { type: 'string', maxLength: 65536 },
        citations: { type: 'array', maxItems: 50, items: citationSchema },
      },
      required: ['productId', 'requestId', 'title'],
      additionalProperties: false,
    },
    approval: 'always',
    authority: 'workspace',
    handler: async (args, execution) => (await service.createPage(toolContext(execution), args?.productId, args ?? {})).body,
  });

  tool({
    name: 'product_library_save_page',
    description: 'Save a new version of an existing page using the exact current revision. Editing an approved page withdraws its approval. Citations are re-hashed against the pinned source; stale citations can be refreshed by saving them again with the same source/field.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', pattern: '^prod_[A-Za-z0-9_-]{1,123}$' },
        pageId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
        requestId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
        expectedRevision: { type: 'integer', minimum: 1 },
        title: { type: 'string', maxLength: 200 },
        body: { type: 'string', maxLength: 65536 },
        citations: { type: 'array', maxItems: 50, items: citationSchema },
      },
      required: ['productId', 'pageId', 'requestId', 'expectedRevision', 'title'],
      additionalProperties: false,
    },
    approval: 'always',
    authority: 'workspace',
    handler: async (args, execution) => (await service.savePage(toolContext(execution), args?.productId, args?.pageId, args ?? {})).body,
  });

  tool({
    name: 'product_library_comment',
    description: 'Add one comment to an exact page revision. Comments are internal collaboration only; they never change product facts, model disclosure or Medusa data.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', pattern: '^prod_[A-Za-z0-9_-]{1,123}$' },
        pageId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
        requestId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
        expectedRevision: { type: 'integer', minimum: 1 },
        version: { type: 'integer', minimum: 1, maximum: 50 },
        body: { type: 'string', maxLength: 4000 },
      },
      required: ['productId', 'pageId', 'requestId', 'expectedRevision', 'version', 'body'],
      additionalProperties: false,
    },
    approval: 'always',
    authority: 'workspace',
    handler: async (args, execution) => (await service.comment(toolContext(execution), args?.productId, args?.pageId, args ?? {})).body,
  });

  tool({
    name: 'product_library_approve_page',
    description: 'Administrator review of one page: approve it or withdraw approval at the exact current revision. Approval is internal to the Product Library and does not approve Medusa Product Context, publish a product or grant model access.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', pattern: '^prod_[A-Za-z0-9_-]{1,123}$' },
        pageId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
        requestId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
        expectedRevision: { type: 'integer', minimum: 1 },
        approved: { type: 'boolean' },
      },
      required: ['productId', 'pageId', 'requestId', 'expectedRevision', 'approved'],
      additionalProperties: false,
    },
    approval: 'always',
    authority: 'workspace',
    handler: async (args, execution) => (await service.approve(toolContext(execution), args?.productId, args?.pageId, args ?? {})).body,
  });

  if (ctx.health?.register) {
    ctx.health.register('product-library', () => {
      const value = status();
      return { status: 'ok', detail: { configured: value.configured, source: value.source, rooms: value.rooms, pages: value.pages, approvedPages: value.approvedPages } };
    });
  }

  return async () => {};
}

export { ROUTES, TOOL_NAMES, unconfiguredSource };
export default { apply };
