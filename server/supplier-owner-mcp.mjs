import { createSupplierOwnerMcpBinding } from './supplier-mcp.mjs';
import { SupplierServiceError, supplierFail } from './supplier-profile.mjs';
import { handleDotMcpHttp } from './dot-mcp-server.mjs';
import { ApiError } from './runtime.mjs';
import { CapabilityError } from './capabilities.mjs';
import { invokeSupplierOwnerOperation } from './supplier-owner-operation.mjs';
import { SUPPLIER_OWNER_MCP_OPERATIONS, SUPPLIER_OWNER_MCP_TOOLS, validateSupplierOwnerArguments } from './supplier-owner-tools.mjs';

/** Two isolated protocol facets of the original authenticated HTTP host.
 * External connectors still require their ORIGINAL live grant resolver.
 * The session facet uses only this request's existing HTTP authorization. */
export async function supplierOwnerMcpHttp({ req, res, pathname, context, access, readBody, guardBody, filterResult, service, publication, artifacts, store, binding, clock = Date.now }) {
  const match = pathname.match(/^\/api\/conversations\/([^/]+)\/(supplier-mcp|supplier-session-mcp)$/);
  if (!match) return false;
  const sessionRequest = match[2] === 'supplier-session-mcp';
  if (!sessionRequest && (!binding || typeof binding.readReviewedScope !== 'function')) supplierFail(409, 'SUPPLIER_OWNER_BINDING_REQUIRED', 'The original authenticated owner host has no reviewed supplier grant resolver.');
  if (access.mode !== 'enterprise' || !context.session || !['admin', 'operator'].includes(context.role)) supplierFail(403, 'SUPPLIER_OWNER_AUTH_REQUIRED', 'Use the original signed enterprise owner session. External connectors also require their reviewed binding.');
  let conversationId;
  try { conversationId = decodeURIComponent(match[1]); } catch { supplierFail(400, 'INVALID_PATH', 'Encode the original conversation identifier once.'); }
  service.forActor(context).list(conversationId);
  // Perform the original body signature check outside the MCP parser so access
  // failures keep their original HTTP status and never become tool execution.
  const message = req.method === 'POST' ? await readBody(req, 1_600_000) : null;
  if (message) { access.verifyBody(context, req.bodyBytes); guardBody?.(message); }
  const controller = new AbortController();
  const watcher = access.watchStream(context, () => controller.abort('SESSION_REVOKED'));
  const assertActive = () => {
    if (!watcher.valid() || controller.signal.aborted) supplierFail(401, 'SESSION_REQUIRED', 'The original owner session expired or was revoked.');
  };
  try {
    assertActive();
    // This facet represents the same original, fully authenticated HTTP request.
    // It never converts a session into a grant or calls the external resolver.
    const actor = Object.freeze({ subject: context.subject, workspaceId: context.workspaceId, role: context.role });
    const owner = sessionRequest ? { tools: SUPPLIER_OWNER_MCP_TOOLS, async callTool(name, args) {
      const operation = Object.keys(SUPPLIER_OWNER_MCP_OPERATIONS).find(key => SUPPLIER_OWNER_MCP_OPERATIONS[key].tool.name === name);
      validateSupplierOwnerArguments(operation, args);
      return invokeSupplierOwnerOperation({ service, publication, artifacts, store, actor, conversationId, operation,
        serviceId: args.serviceId, input: structuredClone(args.input || {}), assertCurrent: assertActive, signal: controller.signal });
    } } : createSupplierOwnerMcpBinding({ service, publication, artifacts, store, actor, conversationId, clock,
      readReviewedScope: binding.readReviewedScope, assertActive, signal: controller.signal });
    await handleDotMcpHttp(req, res, { bridge: owner, readBody: async () => message, extensionOnly: true,
      serverInfo: { name: sessionRequest ? 'workspace-supplier-owner-session' : 'workspace-supplier-owner', version: '1.0.0' },
      instructions: (sessionRequest ? 'This is the original signed Workspace owner HTTP session, not a worker or external connector grant. Each request must retain the original method, target, body, CSRF and owner/conversation authorization. ' : 'Use only the original authenticated owner and exact reviewed resource/input scope. ') + 'Preserve private supplier facts, original approvals, request IDs, revisions and uncertain receipts. Tools cannot approve publication, activate schedules or subscribe/send notifications. A configured adapter is not a verified source connection.',
      extension: { tools: owner.tools, async call(name, args) {
        try { const result = await owner.callTool(name, args); return filterResult ? filterResult(result) : result; }
        catch (error) {
          if (error instanceof SupplierServiceError) throw error;
          if (error instanceof ApiError || error instanceof CapabilityError) throw new SupplierServiceError(error.status, error.code, error.message);
          supplierFail(500, 'SUPPLIER_OWNER_TOOL_FAILED', 'The original operation may be incomplete. Read its existing status and reconcile the same request before retrying.');
        }
      } },
    });
  } finally { watcher.stop(); }
  return true;
}
