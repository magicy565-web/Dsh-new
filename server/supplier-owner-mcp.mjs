import { createSupplierOwnerMcpBinding } from './supplier-mcp.mjs';
import { SupplierServiceError, supplierFail } from './supplier-profile.mjs';
import { handleDotMcpHttp } from './dot-mcp-server.mjs';
import { ApiError } from './runtime.mjs';
import { CapabilityError } from './capabilities.mjs';

/** Optional facet of an existing authenticated owner host, never a worker
 * credential adapter. The host must supply its ORIGINAL live grant resolver;
 * Workspace membership alone does not manufacture a connector grant. */
export async function supplierOwnerMcpHttp({ req, res, pathname, context, access, readBody, service, publication, artifacts, store, binding, clock = Date.now }) {
  const match = pathname.match(/^\/api\/conversations\/([^/]+)\/supplier-mcp$/);
  if (!match) return false;
  if (!binding || typeof binding.readReviewedScope !== 'function') supplierFail(409, 'SUPPLIER_OWNER_BINDING_REQUIRED', 'The original authenticated owner host has no reviewed supplier grant resolver.');
  if (access.mode !== 'enterprise' || !context.session || !['admin', 'operator'].includes(context.role)) supplierFail(403, 'SUPPLIER_OWNER_AUTH_REQUIRED', 'Use the original authenticated enterprise owner session and reviewed connector binding.');
  let conversationId;
  try { conversationId = decodeURIComponent(match[1]); } catch { supplierFail(400, 'INVALID_PATH', 'Encode the original conversation identifier once.'); }
  service.forActor(context).list(conversationId);
  // Perform the original body signature check outside the MCP parser so access
  // failures keep their original HTTP status and never become tool execution.
  const message = req.method === 'POST' ? await readBody(req, 1_600_000) : null;
  if (message) access.verifyBody(context, req.bodyBytes);
  const controller = new AbortController();
  const watcher = access.watchStream(context, () => controller.abort('SESSION_REVOKED'));
  const assertActive = () => {
    if (!watcher.valid() || controller.signal.aborted) supplierFail(401, 'SESSION_REQUIRED', 'The original owner session expired or was revoked.');
  };
  try {
    assertActive();
    const owner = createSupplierOwnerMcpBinding({ service, publication, artifacts, store, actor: context, conversationId, clock,
      readReviewedScope: binding.readReviewedScope, assertActive, signal: controller.signal });
    await handleDotMcpHttp(req, res, { bridge: owner, readBody: async () => message, extensionOnly: true,
      serverInfo: { name: 'workspace-supplier-owner', version: '1.0.0' },
      instructions: 'Use only the original authenticated owner and exact reviewed resource/input scope. Preserve private supplier facts, original approvals, request IDs, revisions and uncertain receipts. Tools cannot approve publication, activate schedules or subscribe/send notifications. A configured adapter is not a verified source connection.',
      extension: { tools: owner.tools, async call(name, args) {
        try { return await owner.callTool(name, args); }
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
