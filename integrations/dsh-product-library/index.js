// Read-only DSH tools for the Workspace Product Library.
//
// The library itself lives in the Workspace Harness composition
// (`workspace-product-library`). This bundle is a thin model-facing adapter:
// it calls the harness HTTP surface and never stores product facts, approves
// context or writes to Medusa.
const TIMEOUT_MS = 5000;

function resolveBaseURL() {
  const raw = process.env.PRODUCT_LIBRARY_BASE_URL?.trim() || 'http://127.0.0.1:8790';
  let url;
  try { url = new URL(raw); } catch { throw new Error('PRODUCT_LIBRARY_BASE_URL must be an absolute HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash)
    throw new Error('PRODUCT_LIBRARY_BASE_URL must be an exact HTTP(S) origin without a path.');
  return url.origin;
}

async function request(pathname, signal) {
  const url = resolveBaseURL() + pathname;
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean)),
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new Error('PRODUCT_LIBRARY_TIMEOUT: the Workspace product library did not answer in time.');
    throw new Error(`PRODUCT_LIBRARY_UNAVAILABLE: cannot reach the Workspace product library at ${url}. Start the harness composition first (see integrations/dsh-product-library/README.md).`);
  }
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('PRODUCT_LIBRARY_INVALID_RESPONSE: the Workspace product library returned non-JSON.'); }
  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    const message = payload?.error?.message ?? 'The Workspace product library refused the read.';
    throw new Error(`${code}: ${message}`);
  }
  return payload;
}

const text = (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }];
const output = { schema: { type: 'object' }, render: text };

const definitions = [
  {
    name: 'product_library_status',
    description: 'Read the Workspace Product Library status: whether a reviewed Medusa Product Context source is configured, and how many rooms, pages and approved pages exist. `configured:false` means the library has no live product facts yet; never claim it is connected.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_args, exec) {
      return request('/api/product-library/status', exec?.signal);
    },
  },
  {
    name: 'product_library_list',
    description: 'List products that have an approved Medusa Product Context and whether each already has a Product Library room. Returns only real source rows; when the source is unconfigured it returns stored rooms with a warning code instead of inventing products.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', maxLength: 200, description: 'Optional substring over the product title.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum rows; defaults to 20.' },
      },
      additionalProperties: false,
    },
    async execute(args, exec) {
      const query = new URLSearchParams();
      if (typeof args?.q === 'string' && args.q.trim()) query.set('q', args.q.slice(0, 200));
      if (Number.isInteger(args?.limit)) query.set('limit', String(args.limit));
      return request(`/api/product-library/products${query.size ? `?${query}` : ''}`, exec?.signal);
    },
  },
  {
    name: 'product_library_search',
    description: 'Search inside opened Product Library rooms: product titles, page titles and bodies, and document labels/filenames. Returns bounded snippets with product/page/document ids; it does not invent products without a room or return document bytes.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', minLength: 1, maxLength: 200, description: 'Case-insensitive substring to find.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum hits; defaults to 20.' },
      },
      required: ['q'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const query = new URLSearchParams({ q: String(args?.q ?? '').slice(0, 200) });
      if (Number.isInteger(args?.limit)) query.set('limit', String(args.limit));
      return request(`/api/product-library/search?${query}`, exec?.signal);
    },
  },
  {
    name: 'product_library_read',
    description: 'Read one Product Library room: the exact pinned Medusa product and approved Product Context, its versioned pages, citation status (current/stale/missing), attached document metadata, comments and approval state. This is a read-only projection; it does not grant model disclosure, approve context, publish a product or return file bytes.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', pattern: '^prod_[A-Za-z0-9_-]{1,123}$', description: 'Exact Medusa product id, for example prod_01J...' },
      },
      required: ['productId'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const productId = String(args?.productId ?? '');
      if (!/^prod_[A-Za-z0-9_-]{1,123}$/u.test(productId)) throw new Error('PRODUCT_LIBRARY_INPUT: use an exact Medusa product id.');
      return request(`/api/product-library/products/${encodeURIComponent(productId)}`, exec?.signal);
    },
  },
];

/** @param {object} ctx Cordis host context */
export const inject = ['tools'];

export function apply(ctx, _config = {}) {
  if (!ctx?.tools?.register) throw new Error('dsh-product-library requires ctx.tools.');
  resolveBaseURL();
  for (const definition of definitions) {
    ctx.effect(() => ctx.tools.register({ ...definition, output }));
  }
}

export default { apply, inject };
