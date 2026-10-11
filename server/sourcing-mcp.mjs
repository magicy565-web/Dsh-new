import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from './runtime.mjs';

// Existing private-pilot MCP: legacy credentials stay read-only; host-reviewed
// buyer bindings can persist private requests and explicit sharing consent.
// Do not expose on an unrestricted internet ingress or reuse Dot/Muse credentials.
export const SOURCING_MCP_VERSION = '2025-11-25';
const SCHEMA = { type: 'object', additionalProperties: false };
export const SOURCING_TOOLS = Object.freeze([
  { name: 'workspace_supply_search', description: 'Find explicitly published supplier offers. Prices are indicative merchant declarations, never binding quotations.', inputSchema: { ...SCHEMA, properties: { query: { type: 'string', maxLength: 120 }, limit: { type: 'integer', minimum: 1, maximum: 50 } } } },
  { name: 'workspace_supplier_profile', description: 'Read one published supplier and its published offers with their evidence level.', inputSchema: { ...SCHEMA, properties: { supplierId: { type: 'string', format: 'uuid' } }, required: ['supplierId'] } },
  { name: 'workspace_supply_changes', description: 'Read publication change metadata for the latest published offers. Does not reveal private sales or buyer data.', inputSchema: { ...SCHEMA, properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } } },
]);
const errorReply = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export const PROCUREMENT_TOOLS = Object.freeze([
  { name: 'workspace_procurement_draft', description: 'Persist a private purchase request for a published offer. Does not share it with a merchant.', inputSchema: { ...SCHEMA, properties: { requestId: { type: 'string', format: 'uuid' }, listingId: { type: 'string', format: 'uuid' }, quantity: { type: 'integer', minimum: 1, maximum: 10000000 }, destination: { type: 'string', maxLength: 120 }, notes: { type: 'string', maxLength: 1200 } }, required: ['requestId', 'listingId', 'quantity', 'destination'] } },
  { name: 'workspace_procurement_get', description: 'Read only this authenticated buyer\'s saved request, its sharing consent and actual merchant replies.', inputSchema: { ...SCHEMA, properties: { inquiryId: { type: 'string', format: 'uuid' } }, required: ['inquiryId'] } },
  { name: 'workspace_procurement_review', description: 'Review the exact request, SKU and specified merchant. Return the consent hash; review alone shares nothing.', inputSchema: { ...SCHEMA, properties: { inquiryId: { type: 'string', format: 'uuid' } }, required: ['inquiryId'] } },
  { name: 'workspace_procurement_share', description: 'Share the exact reviewed request only after explicit buyer consent. Preserve requestId on retry; never infer consent from a draft.', inputSchema: { ...SCHEMA, properties: { inquiryId: { type: 'string', format: 'uuid' }, requestId: { type: 'string', format: 'uuid' }, expectedRevision: { type: 'integer', minimum: 1 }, expectedReviewHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, confirmed: { type: 'boolean', const: true } }, required: ['inquiryId', 'requestId', 'expectedRevision', 'expectedReviewHash', 'confirmed'] } },
  { name: 'workspace_procurement_revoke', description: 'Revoke merchant access to this buyer\'s shared request. Earlier recipients may retain information already read.', inputSchema: { ...SCHEMA, properties: { inquiryId: { type: 'string', format: 'uuid' }, requestId: { type: 'string', format: 'uuid' }, expectedRevision: { type: 'integer', minimum: 1 }, confirmed: { type: 'boolean', const: true } }, required: ['inquiryId', 'requestId', 'expectedRevision', 'confirmed'] } },
]);

export function createSourcingMcpAuth({ enabled = false, tokenDigest = '', principals = [] } = {}) {
  if (!Array.isArray(principals) || principals.length > 50) throw new Error('Bounded reviewed MCP principal bindings are required.');
  const bindings = principals.map(binding => {
    if (!binding || Object.keys(binding).some(key => !['subject', 'workspaceId', 'tokenDigest'].includes(key)) || !/^[A-Za-z0-9._@:+|/-]{1,128}$/u.test(binding.subject ?? '') || !/^[A-Za-z0-9._:-]{1,128}$/u.test(binding.workspaceId ?? '') || !/^[a-f0-9]{64}$/u.test(binding.tokenDigest ?? '')) throw new Error('MCP procurement identity must be configured by the trusted host.');
    return Object.freeze({ ...binding, role: 'buyer' });
  });
  const digests = [...bindings.map(x => x.tokenDigest), ...(tokenDigest ? [tokenDigest] : [])];
  if (new Set(digests).size !== digests.length || enabled && (!digests.length || digests.some(value => !/^[a-f0-9]{64}$/u.test(value)))) throw new Error('Separate, unique reviewed MCP credential digests are required.');
  return req => {
    const headers = req.rawHeaders || [];
    if (headers.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'authorization').length > 1)
      throw new ApiError(401, 'SOURCING_MCP_UNAUTHORIZED', 'One unambiguous credential is required.');
    if (req.headers.origin || req.headers.cookie || req.headers.referer) throw new ApiError(403, 'SOURCING_MCP_BROWSER_FORBIDDEN', 'Only private server-to-server requests are accepted.');
    if (!enabled) throw new ApiError(404, 'SOURCING_MCP_DISABLED', 'Sourcing MCP is disabled.');
    const header = req.headers.authorization || '';
    const token = /^Bearer ([A-Za-z0-9._~+\/-]{24,512})$/u.exec(header)?.[1];
    const actual = createHash('sha256').update(token || '').digest();
    const matched = digests.filter(value => timingSafeEqual(actual, Buffer.from(value, 'hex')));
    if (!token || matched.length !== 1) throw new ApiError(401, 'SOURCING_MCP_UNAUTHORIZED', 'The private sourcing connector requires a valid credential.');
    const principal = bindings.find(x => x.tokenDigest === matched[0]);
    return principal ? Object.freeze({ subject: principal.subject, workspaceId: principal.workspaceId, role: 'buyer' }) : null;
  };
}

export async function handleSourcingMcpHttp(req, res, { supply, readBody, actor = null } = {}) {
  if (!supply || typeof readBody !== 'function') throw new TypeError('Sourcing MCP requires the authorized supply network.');
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Referrer-Policy': 'no-referrer' });
    res.end(data === undefined ? undefined : JSON.stringify(data));
  };
  if (req.method !== 'POST') return send(405, errorReply(null, -32601, 'Only POST is allowed.'));
  let message;
  try { message = await readBody(req, 8192); }
  catch { return send(400, errorReply(null, -32700, 'Invalid MCP JSON request.')); }
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || message.method.length > 60 || (message.id !== undefined && typeof message.id !== 'string' && typeof message.id !== 'number')) return send(400, errorReply(null, -32600, 'Invalid JSON-RPC envelope.'));
  const id = message.id ?? null, method = message.method;
  const requestedVersion = req.headers['mcp-protocol-version'];
  if (requestedVersion && !['2025-11-25', '2025-06-18'].includes(requestedVersion)) return send(400, errorReply(id, -32600, 'Unsupported MCP protocol version.'));
  if (method === 'notifications/initialized' && message.id === undefined) return send(202);
  if (id === null) return send(400, errorReply(null, -32600, 'Request ID is required.'));
  if (method === 'initialize') {
    const version = message.params?.protocolVersion;
    if (version && typeof version !== 'string') return send(400, errorReply(id, -32602, 'Invalid protocolVersion.'));
    return send(200, reply(id, { protocolVersion: SOURCING_MCP_VERSION, serverInfo: { name: 'workspace-sourcing-pilot', version: '0.1.0' }, capabilities: { tools: {} }, instructions: 'Published offers are indicative merchant declarations, not verified inventory, accepted orders or binding supplier quotes. Never represent search results as independent certification.' }));
  }
  if (method === 'ping') return send(200, reply(id, {}));
  const tools = actor ? [...SOURCING_TOOLS, ...PROCUREMENT_TOOLS] : SOURCING_TOOLS;
  if (method === 'tools/list') return send(200, reply(id, { tools }));
  if (method !== 'tools/call') return send(200, errorReply(id, -32601, 'Unknown MCP method.'));
  const { name, arguments: args = {} } = message.params || {};
  const tool = tools.find(x => x.name === name);
  if (!tool || !isObject(args) || Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties, key)) || (tool.inputSchema.required || []).some(key => !Object.hasOwn(args, key))) return send(200, errorReply(id, -32602, 'Unknown tool or invalid arguments.'));
  try {
    let value;
    if (name === 'workspace_supply_search') value = await supply.searchPublic(args);
    else if (name === 'workspace_supplier_profile') value = await supply.getPublicSupplier(args.supplierId);
    else if (name === 'workspace_supply_changes') value = await supply.publicChanges(args);
    else if (name === 'workspace_procurement_draft') value = await supply.createInquiry(args, actor);
    else if (name === 'workspace_procurement_get') value = await supply.inquiry(args.inquiryId, actor);
    else if (name === 'workspace_procurement_review') value = await supply.reviewInquiry(args.inquiryId, actor);
    else { const { inquiryId, ...body } = args; value = await supply[name === 'workspace_procurement_share' ? 'shareInquiry' : 'revokeInquiry'](inquiryId, body, actor); }
    return send(200, reply(id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }));
  } catch (cause) {
    return send(200, reply(id, { isError: true, content: [{ type: 'text', text: cause instanceof ApiError ? cause.message : 'Supply operation failed.' }], structuredContent: { error: { code: cause instanceof ApiError ? cause.code : 'SUPPLY_OPERATION_FAILED' } } }));
  }
}
