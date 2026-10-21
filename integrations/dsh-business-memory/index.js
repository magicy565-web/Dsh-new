// DSH tools for the Workspace Business Memory.
//
// The memory itself lives in the Workspace Harness composition
// (`workspace-business-memory`). This bundle is a thin model-facing adapter:
// it reads memory and proposes candidates, and it deliberately exposes no
// approve/reject/revoke tool. A proposal becomes a business fact only when a
// human administrator reviews it in the memory area.
import { createHash } from 'node:crypto';

const TIMEOUT_MS = 5000;

function resolveBaseURL() {
  const raw = process.env.BUSINESS_MEMORY_BASE_URL?.trim() || 'http://127.0.0.1:8790';
  let url;
  try { url = new URL(raw); } catch { throw new Error('BUSINESS_MEMORY_BASE_URL must be an absolute HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash)
    throw new Error('BUSINESS_MEMORY_BASE_URL must be an exact HTTP(S) origin without a path.');
  return url.origin;
}

async function request(pathname, { method = 'GET', body, signal } = {}) {
  const url = resolveBaseURL() + pathname;
  let response;
  try {
    response = await fetch(url, {
      method,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean)),
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError')
      throw new Error('BUSINESS_MEMORY_TIMEOUT: the Workspace business memory did not answer in time.');
    throw new Error(`BUSINESS_MEMORY_UNAVAILABLE: cannot reach the Workspace business memory at ${url}. Start the harness composition first (see integrations/dsh-business-memory/README.md).`);
  }
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('BUSINESS_MEMORY_INVALID_RESPONSE: the Workspace business memory returned non-JSON.'); }
  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    const message = payload?.error?.message ?? 'The Workspace business memory refused the request.';
    throw new Error(`${code}: ${message}`);
  }
  return payload;
}

const output = {
  schema: { type: 'object' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/**
 * A deterministic idempotency key: an identical proposal retried after a
 * timeout replays the original candidate instead of duplicating it.
 */
export function proposalRequestId(args) {
  const hex = createHash('sha256').update(canonical(args)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function queryString(pairs) {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  return params.size ? `?${params}` : '';
}

const definitions = [
  {
    name: 'business_memory_status',
    description: 'Read this workspace\'s business memory status: counts of active, proposed, superseded and revoked memories, covered subject types and whether verified external sources are bound. `proposed` memories are candidates awaiting human review and are not business facts.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_args, exec) { return request('/api/business-memory/status', { signal: exec?.signal }); },
  },
  {
    name: 'business_memory_map',
    description: 'Read the business memory map: coverage per subject type (company, product, customer, market, channel, operation), active/proposed counts and recent activations. Coverage is a structural count, not a quality, revenue or readiness score.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_args, exec) { return request('/api/business-memory/map', { signal: exec?.signal }); },
  },
  {
    name: 'business_memory_brief',
    description: 'Read the deterministic growth brief computed from this workspace\'s confirmed memory: coverage gaps, pending reviews, expiring facts and unresolved decisions. Every signal cites existing memory ids; it contains no forecast, probability or causal claim and creates no Goal, approval or external action.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(_args, exec) { return request('/api/business-memory/brief', { signal: exec?.signal }); },
  },
  {
    name: 'business_memory_recall',
    description: 'Recall confirmed business memory (active, human-approved facts with a pinned source) about this enterprise. Filter by business subject, fact key, kind or free text. Use this before giving business advice so the answer is grounded in the enterprise\'s own stored facts instead of assumptions.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', maxLength: 200, description: 'Case-insensitive text over the statement, subject label, fact key and tags.' },
        subjectType: { type: 'string', enum: ['company', 'product', 'customer', 'market', 'channel', 'operation'] },
        subjectId: { type: 'string', maxLength: 128 },
        factKey: { type: 'string', maxLength: 128, description: 'Exact fact key, for example moq, lead-time or buyer-profile.' },
        kind: { type: 'string', enum: ['fact', 'observation', 'hypothesis', 'preference', 'decision', 'outcome'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum rows; defaults to 20.' },
      },
      additionalProperties: false,
    },
    async execute(args, exec) {
      const path = '/api/business-memory/records' + queryString([
        ['q', typeof args?.q === 'string' ? args.q.slice(0, 200) : undefined],
        ['subjectType', args?.subjectType],
        ['subjectId', typeof args?.subjectId === 'string' ? args.subjectId.slice(0, 128) : undefined],
        ['factKey', typeof args?.factKey === 'string' ? args.factKey.slice(0, 128) : undefined],
        ['kind', args?.kind],
        ['limit', Number.isInteger(args?.limit) ? args.limit : undefined],
      ]);
      return request(path, { signal: exec?.signal });
    },
  },
  {
    name: 'business_memory_read',
    description: 'Read one business memory with its exact source reference, attestation, revision history and related records for the same fact key. Proposals are visible too, but they are not facts until a human administrator approves them.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', description: 'Exact memory id.' } },
      required: ['id'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const id = String(args?.id ?? '');
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(id))
        throw new Error('BUSINESS_MEMORY_INPUT: use an exact memory id.');
      return request(`/api/business-memory/records/${encodeURIComponent(id)}`, { signal: exec?.signal });
    },
  },
  {
    name: 'business_memory_propose',
    description: 'Propose one new business memory candidate for this enterprise. The record is created as `proposed` and never becomes a fact automatically: a human administrator must review it in the business memory area. Use it for durable facts you learned from the conversation (customer preferences, product constraints, market observations, decisions) - not for predictions, prices you did not observe, or conclusions without a source. Operator sources require a basis; conversation sources pin the conversation reference and stay human-attested.',
    parameters: {
      type: 'object',
      properties: {
        subjectType: { type: 'string', enum: ['company', 'product', 'customer', 'market', 'channel', 'operation'] },
        subjectId: { type: 'string', maxLength: 128, description: 'Stable id of the subject, for example a Medusa product id or a customer key.' },
        subjectLabel: { type: 'string', maxLength: 200, description: 'Human-readable subject name.' },
        factKey: { type: 'string', maxLength: 128, description: 'Stable key of the fact, for example moq, lead-time, buyer-profile.' },
        kind: { type: 'string', enum: ['fact', 'observation', 'hypothesis', 'preference', 'decision', 'outcome'] },
        statement: { type: 'string', maxLength: 2000, description: 'One checkable statement in the enterprise\'s own words.' },
        detail: { type: 'string', maxLength: 8000 },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        source: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['operator', 'conversation'] },
            label: { type: 'string', maxLength: 200 },
            basis: { type: 'string', maxLength: 500, description: 'Required for operator sources: why this fact is believed.' },
            ref: { type: 'string', maxLength: 300, description: 'Required for conversation sources: the exact conversation or message reference.' },
          },
          required: ['kind'],
          additionalProperties: false,
        },
        tags: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 40 } },
        expiresAt: { type: 'string', maxLength: 40, description: 'Optional ISO-8601 expiry; the fact leaves the active set after it.' },
      },
      required: ['subjectType', 'subjectId', 'subjectLabel', 'factKey', 'statement', 'source'],
      additionalProperties: false,
    },
    async execute(args, exec) {
      const body = {
        requestId: proposalRequestId(args),
        subjectType: args?.subjectType,
        subjectId: args?.subjectId,
        subjectLabel: args?.subjectLabel,
        factKey: args?.factKey,
        kind: args?.kind ?? 'fact',
        statement: args?.statement,
        detail: args?.detail,
        confidence: args?.confidence,
        source: args?.source,
        tags: args?.tags,
        expiresAt: args?.expiresAt,
      };
      if (body.detail === undefined) delete body.detail;
      if (body.confidence === undefined) delete body.confidence;
      if (body.tags === undefined) delete body.tags;
      if (body.expiresAt === undefined) delete body.expiresAt;
      return request('/api/business-memory/records', { method: 'POST', body, signal: exec?.signal });
    },
  },
];

/** @param {object} ctx Cordis host context */
export const inject = ['tools'];

export function apply(ctx, _config = {}) {
  if (!ctx?.tools?.register) throw new Error('dsh-business-memory requires ctx.tools.');
  resolveBaseURL();
  for (const definition of definitions) {
    ctx.effect(() => ctx.tools.register({ ...definition, output }));
  }
}

export default { apply, inject };
