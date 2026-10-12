import { randomUUID } from 'node:crypto';
import { createWorkspaceClient } from './workspace-client.mjs';

export const SUPPLIER_TOOLS = Object.freeze(['get', 'intake', 'profile', 'image_upload', 'preview', 'save_product',
  'shopify_observation', 'publication', 'publication_review', 'publication_execute', 'publication_reconcile',
  'monitors', 'monitor_create', 'monitor_check', 'monitor_stop']);
export const supplierReadOnly = operation => ['get', 'publication', 'monitors'].includes(operation);
export const supplierReplayable = operation => ['intake', 'profile', 'image_upload', 'preview', 'save_product'].includes(operation);
export const supplierToolName = operation => `workspace_supplier_owner_${operation}`;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const codeOf = (value, fallback) => /^[A-Z0-9_]{1,100}$/.test(value || '') ? value : fallback;
const same = (a, b) => a?.workspaceId === b?.workspaceId && a?.subject === b?.subject && a?.conversationId === b?.conversationId;

// No direct services, signer, token, permission resolver or external-MCP fallback.
// The same Host transport signs the actual original MCP path/body on every POST.
export function createSupplierMcpClient(request) {
  const owner = createWorkspaceClient(request);
  let scope, catalog;
  async function current(expected) {
    const actual = await owner.connect();
    if (scope && !same(actual, scope) || expected && !same(actual, expected)) fail('OWNER_SCOPE_CHANGED');
    return scope ||= actual;
  }
  async function rpc(method, params = {}, notification = false, expected) {
    const live = await current(expected);
    const id = randomUUID();
    const body = { jsonrpc: '2.0', ...(!notification ? { id } : {}), method, params };
    if (Buffer.byteLength(JSON.stringify(body)) > 1_600_000) fail('SUPPLIER_MCP_REQUEST_TOO_LARGE');
    let result;
    try { result = await request({ method: 'POST', path: `/api/conversations/${encodeURIComponent(live.conversationId)}/supplier-session-mcp`, body, signal: AbortSignal.timeout(15000) }); }
    catch (error) { fail(codeOf(error?.code, method === 'tools/call' ? 'SUPPLIER_RESULT_UNKNOWN_READ_FIRST' : 'SUPPLIER_MCP_TRANSPORT_UNAVAILABLE')); }
    if (notification && result?.status === 202) return;
    if (result?.status !== 200) fail(codeOf(result?.body?.error?.code, 'SUPPLIER_MCP_HTTP_REJECTED'));
    if (result.body?.jsonrpc !== '2.0' || result.body.id !== id) fail('SUPPLIER_MCP_RESPONSE_MISMATCH');
    if (result.body.error) fail(codeOf(result.body.error.code, 'SUPPLIER_MCP_REQUEST_REJECTED'));
    if (!object(result.body.result)) fail('SUPPLIER_MCP_RESULT_INVALID');
    return result.body.result;
  }
  async function connect() {
    const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'workspace-pi-tui', version: '0.1.0' } });
    if (initialized.protocolVersion !== '2025-11-25' || initialized.serverInfo?.name !== 'workspace-supplier-owner-session') fail('SUPPLIER_MCP_SERVER_MISMATCH');
    await rpc('notifications/initialized', {}, true);
    const listed = await rpc('tools/list');
    if (!Array.isArray(listed.tools) || listed.nextCursor || listed.tools.length !== SUPPLIER_TOOLS.length ||
        SUPPLIER_TOOLS.some(operation => listed.tools.filter(tool => tool.name === supplierToolName(operation) && object(tool.inputSchema) && tool.inputSchema.type === 'object').length !== 1)) fail('SUPPLIER_MCP_CATALOG_MISMATCH');
    catalog = structuredClone(listed.tools);
    return { ...scope, protocolVersion: initialized.protocolVersion, toolCount: catalog.length, mode: 'interactive_commands', modelToolsRegistered: false, realShopifyVerified: false };
  }
  return {
    connect,
    async scope() { return current(); },
    async tools() { if (!catalog) await connect(); else await current(); return structuredClone(catalog); },
    async call(operation, args, expected) {
      if (!SUPPLIER_TOOLS.includes(operation) || !object(args)) fail('SUPPLIER_MCP_ARGUMENTS_INVALID');
      if (!catalog) await connect();
      const result = await rpc('tools/call', { name: supplierToolName(operation), arguments: structuredClone(args) }, false, expected);
      if (result.isError) {
        let error;
        try { error = JSON.parse(result.content?.find(item => item.type === 'text')?.text); } catch {}
        fail(codeOf(error?.code, 'SUPPLIER_MCP_TOOL_FAILED'));
      }
      if (!object(result.structuredContent)) fail('SUPPLIER_MCP_RESULT_INVALID');
      return result.structuredContent;
    },
  };
}
