import { DotWorkerError } from './dot-worker-bridge.mjs';
import { DOT_MCP_TOOLS } from './dot-mcp-tools.mjs';
export { DOT_MCP_TOOLS } from './dot-mcp-tools.mjs';

/**
 * Stateless MCP Streamable HTTP facade for the existing Dot Worker bridge.
 * No new execution engine. Every tool maps to one existing, constrained
 * workspace_worker_* operation; the authenticated plugin pulls the work.
 *
 * This supports the current 2026-07-28 per-request transport and the
 * pre-2026 2025-11-25 initialize-based transport. It does not implement
 * server-push, prompts, tasks extension, or arbitrary REST forwarding.
 */
export const MODERN_MCP_VERSION = '2026-07-28';
export const LEGACY_MCP_VERSION = '2025-11-25';
export const EARLY_MCP_VERSION = '2025-06-18';
export const SUPPORTED_DOT_MCP_VERSIONS = Object.freeze([MODERN_MCP_VERSION, LEGACY_MCP_VERSION, EARLY_MCP_VERSION]);
const SERVER = Object.freeze({ name: 'workspace-dot-xy', version: '1.0.0' });
const INSTRUCTIONS = 'This toolset is only for the owner-approved ChatGPT dot. Read publicly authorized tasks, claim one original attempt, retain its attemptId/fence, check status and cancellation, upload original generated files and tool receipts, and submit results for separate enterprise acceptance. Never fabricate tool evidence or send private enterprise files.';
const jsonObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const KNOWN_TOOLS = new Set(DOT_MCP_TOOLS.map(tool => tool.name));

function toolArguments(name, supplied) {
  const tool = DOT_MCP_TOOLS.find(item => item.name === name);
  if (!tool) return null;
  if (!jsonObject(supplied)) throw new DotWorkerError(400, 'MCP_ARGUMENTS_INVALID', 'Tool arguments must be a JSON object.');
  if (Object.keys(supplied).some(x => !Object.hasOwn(tool.inputSchema.properties, x))) {
    throw new DotWorkerError(400, 'MCP_ARGUMENTS_INVALID', 'This tool does not accept the supplied input fields.');
  }
  for (const field of tool.inputSchema.required) {
    if (!Object.hasOwn(supplied, field)) throw new DotWorkerError(400, 'MCP_ARGUMENTS_INVALID', 'Required tool argument is missing: ' + field);
  }
  return supplied;
}

export async function callDotMcpTool(bridge, name, input = {}) {
  const args = toolArguments(name, input);
  if (!args) throw new DotWorkerError(404, 'MCP_TOOL_NOT_FOUND', 'This tool is not part of the reviewed Dot plugin.');
  // Explicit closed mapping. No URLs, arbitrary tool names, or executable code.
  switch (name) {
    case 'workspace_worker_identity': return bridge.identity();
    case 'workspace_worker_inbox': return bridge.inbox();
    case 'workspace_worker_read_task': return bridge.readTask(args.taskRef);
    case 'workspace_worker_claim_task': return bridge.claimTask(args);
    case 'workspace_worker_status': return bridge.status(args.taskRef);
    case 'workspace_worker_heartbeat': return bridge.heartbeat(args);
    case 'workspace_worker_upload_file': return bridge.uploadFile(args);
    case 'workspace_worker_submit_result': return bridge.submitResult(args);
    case 'workspace_worker_report_blocked': return bridge.reportBlocked(args);
    case 'workspace_worker_confirm_stop': return bridge.confirmStop(args);
    case 'workspace_worker_ack_event': return bridge.ackEvent(args);
    default: throw new DotWorkerError(404, 'MCP_TOOL_NOT_FOUND', 'Tool not enabled.');
  }
}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message, data) => ({
  jsonrpc: '2.0', id, error: {
    code, message,
    ...(data ? { data } : {}),
  },
});
const response = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...(status === 405 ? { Allow: 'POST' } : {}),
  });
  res.end(status === 202 ? undefined : JSON.stringify(body));
};

function transportVersion(req, message) {
  const meta = message.params?._meta;
  const advertised = meta?.['io.modelcontextprotocol/protocolVersion'];
  const headerVersion = req.headers['mcp-protocol-version'];
  const requested = headerVersion || advertised;
  if (requested && !SUPPORTED_DOT_MCP_VERSIONS.includes(requested)) {
    return { error: err(message.id ?? null, -32022, 'Unsupported protocol version', {
      supported: SUPPORTED_DOT_MCP_VERSIONS, requested,
    }) };
  }
  const modern = advertised === MODERN_MCP_VERSION || headerVersion === MODERN_MCP_VERSION;
  if (!modern) {
    if (advertised && headerVersion && advertised !== headerVersion)
      return { error: err(message.id ?? null, -32020, 'MCP version header differs from the request metadata.') };
    return { version: LEGACY_MCP_VERSION };
  }
  const version = req.headers['mcp-protocol-version'];
  const mirrored = req.headers['mcp-method'];
  const name = req.headers['mcp-name'];
  if (version !== MODERN_MCP_VERSION ||
      meta?.['io.modelcontextprotocol/protocolVersion'] !== MODERN_MCP_VERSION ||
      !jsonObject(meta?.['io.modelcontextprotocol/clientInfo']) ||
      !jsonObject(meta?.['io.modelcontextprotocol/clientCapabilities']) ||
      mirrored !== message.method ||
      (message.method === 'tools/call' ? name !== message.params?.name : name !== undefined)) {
    return { error: err(message.id ?? null, -32020,
      'Required MCP 2026-07-28 headers and per-request metadata do not match the request body.') };
  }
  return { version: MODERN_MCP_VERSION };
}

const resultTool = (value, version, isError = false) => ({
  ...(version === MODERN_MCP_VERSION ? { resultType: 'complete' } : {}),
  content: [{ type: 'text', text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : { structuredContent: value }),
});

export async function handleDotMcpHttp(req, res, { bridge, readBody } = {}) {
  if (!bridge || typeof readBody !== 'function') throw new TypeError('Dot MCP requires the existing authenticated Workspace bridge.');
  if (req.method !== 'POST') return response(res, 405,
    err(null, -32601, 'MCP Streamable HTTP only accepts POST.'));
  let message;
  try {
    message = await readBody(req, 1_600_000);
  } catch {
    return response(res, 400, err(null, -32700, 'Malformed or oversized JSON-RPC message.'));
  }
  const id = typeof message?.id === 'string' || Number.isSafeInteger(message?.id) ? message.id : null;
  if (!jsonObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
      message.method.length > 128 || (message.id !== undefined && id === null))
    return response(res, 400, err(id, -32600, 'Invalid JSON-RPC 2.0 request.'));
  const { version, error } = transportVersion(req, message);
  if (error) return response(res, 400, error);

  if (message.method === 'notifications/initialized') {
    return response(res, 202);
  }
  if (id === null) return response(res, 400, err(null, -32600, 'An MCP request ID is required.'));
  if (message.method === 'initialize') {
    if (version === MODERN_MCP_VERSION)
      return response(res, 400, err(id, -32601, 'Modern MCP uses server/discover, not initialize.'));
    const selected = message.params?.protocolVersion;
    if (selected !== LEGACY_MCP_VERSION && selected !== EARLY_MCP_VERSION) {
      return response(res, 400, err(id, -32022, 'Unsupported MCP initialization version.', {
        requested: selected || null, supported: [LEGACY_MCP_VERSION, EARLY_MCP_VERSION],
      }));
    }
    return response(res, 200, ok(id, {
      protocolVersion: selected,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER, instructions: INSTRUCTIONS,
    }));
  }
  if (message.method === 'server/discover') {
    if (version !== MODERN_MCP_VERSION) return response(res, 404,
      err(id, -32601, 'server/discover requires modern MCP.'));
    return response(res, 200, ok(id, {
      resultType: 'complete', supportedVersions: SUPPORTED_DOT_MCP_VERSIONS,
      capabilities: { tools: { listChanged: false } },
      _meta: { 'io.modelcontextprotocol/serverInfo': SERVER },
      instructions: INSTRUCTIONS, ttlMs: 60_000, cacheScope: 'private',
    }));
  }
  if (message.method === 'ping') return response(res, 200, ok(id, {}));
  if (message.method === 'tools/list') {
    if (message.params?.cursor) return response(res, 400,
      err(id, -32602, 'Dot Worker tools/list has exactly one page.'));
    return response(res, 200, ok(id, {
      ...(version === MODERN_MCP_VERSION ? { resultType: 'complete' } : {}),
      tools: DOT_MCP_TOOLS,
      ...(version === MODERN_MCP_VERSION ? { ttlMs: 60_000, cacheScope: 'private' } : {}),
    }));
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    if (typeof name !== 'string' || !KNOWN_TOOLS.has(name))
      return response(res, 404, err(id, -32601, 'Unregistered Dot Worker tool.'));
    try {
      const value = await callDotMcpTool(bridge, name, message.params?.arguments || {});
      return response(res, 200, ok(id, resultTool(value, version)));
    } catch (cause) {
      const safe = cause instanceof DotWorkerError ?
        { code: cause.code, message: cause.message } :
        { code: 'DOT_TOOL_FAILED', message: 'This attempt may be uncertain. Query its original task reference before retrying.' };
      return response(res, 200, ok(id, resultTool(safe, version, true)));
    }
  }
  return response(res, 404, err(id, -32601, 'Unsupported MCP method.'));
}
