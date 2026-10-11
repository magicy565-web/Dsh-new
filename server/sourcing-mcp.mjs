import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from './runtime.mjs';

// A read-only, private-pilot MCP transport. Not a public ChatGPT OAuth 2.1 app.
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

export function createSourcingMcpAuth({ enabled = false, tokenDigest = '' } = {}) {
  if (enabled && !/^[a-f0-9]{64}$/u.test(tokenDigest)) throw new Error('A reviewed, separate SHA-256 MCP token digest is required.');
  return req => {
    if (req.headers.origin || req.headers.cookie || req.headers.referer) throw new ApiError(403, 'SOURCING_MCP_BROWSER_FORBIDDEN', 'Only private server-to-server requests are accepted.');
    if (!enabled) throw new ApiError(404, 'SOURCING_MCP_DISABLED', 'Sourcing MCP is disabled.');
    const header = req.headers.authorization || '';
    const token = /^Bearer ([A-Za-z0-9._~+\/-]{24,512})$/u.exec(header)?.[1];
    const actual = createHash('sha256').update(token || '').digest();
    const expected = Buffer.from(tokenDigest, 'hex');
    if (!token || expected.length !== actual.length || !timingSafeEqual(actual, expected)) throw new ApiError(401, 'SOURCING_MCP_UNAUTHORIZED', 'The private sourcing connector requires a valid credential.');
  };
}

export async function handleSourcingMcpHttp(req, res, { supply, readBody } = {}) {
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
  if (method === 'tools/list') return send(200, reply(id, { tools: SOURCING_TOOLS }));
  if (method !== 'tools/call') return send(200, errorReply(id, -32601, 'Unknown MCP method.'));
  const { name, arguments: args = {} } = message.params || {};
  const tool = SOURCING_TOOLS.find(x => x.name === name);
  if (!tool || !isObject(args) || Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties, key)) || (tool.inputSchema.required || []).some(key => !Object.hasOwn(args, key))) return send(200, errorReply(id, -32602, 'Unknown tool or invalid arguments.'));
  try {
    const value = name === 'workspace_supply_search' ? supply.searchPublic(args) : name === 'workspace_supplier_profile' ? supply.getPublicSupplier(args.supplierId) : supply.publicChanges(args);
    return send(200, reply(id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }));
  } catch (cause) {
    return send(200, reply(id, { isError: true, content: [{ type: 'text', text: cause instanceof ApiError ? cause.message : 'Supply lookup failed.' }] }));
  }
}
