import { randomUUID, createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupplierMcpClient, SUPPLIER_TOOLS, supplierToolName, supplierReadOnly, supplierReplayable } from '../supplier-mcp-client.mjs';
import { createRequestJournal } from '../request-journal.mjs';

const plain = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
const show = (ctx, value) => ctx.ui.notify(plain(JSON.stringify(value)), 'info');
const fail = code => { throw Object.assign(new Error(code), { code }); };
export const supplierHelp = 'Supplier commands in this same Pi TUI: /workspace-supplier connect | tools | schema TOOL | call TOOL | file TOOL | retry. TOOL is a listed suffix. Every write asks confirmation; original publication/schedule approvals still apply. Plain language/model tools are disabled.';
const directory = path.join(process.env.WORKSPACE_PI_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '../.data'), 'supplier-requests');

async function readArguments(filename) {
  if (!path.isAbsolute(filename)) fail('SUPPLIER_ARGUMENT_FILE_ABSOLUTE_REQUIRED');
  const file = await open(filename, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1_500_000) fail('SUPPLIER_ARGUMENT_FILE_INVALID');
    // Limit the read even if the file grows after stat.
    const bytes = Buffer.alloc(1_500_001);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const read = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > 1_500_000) fail('SUPPLIER_ARGUMENT_FILE_INVALID');
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}
function reviewedArguments(args) {
  const copy = structuredClone(args);
  if (typeof copy.input?.base64 === 'string') {
    const original = Buffer.from(copy.input.base64, 'base64');
    copy.input.base64 = { bytes: original.length, sha256: createHash('sha256').update(original).digest('hex') };
  }
  return copy;
}

// Called by the one existing extension with its one shared Host RPC transport.
export function registerWorkspaceSupplier(pi, { getRequest, enter, leave, journal = createRequestJournal(directory) }) {
  let api;
  const client = async () => api ||= createSupplierMcpClient(await getRequest());
  pi.registerCommand('workspace-supplier', {
    description: 'Call the 15 original owner-session supplier MCP tools; preserves original approvals.',
    handler: async (args, ctx) => {
      if (ctx.mode !== 'tui' || !ctx.hasUI) fail('INTERACTIVE_TUI_REQUIRED');
      if (!enter()) { ctx.ui.notify('A Workspace command is still pending.', 'warning'); return; }
      try {
        const [action = 'help', operation, extra] = args.trim().split(/\s+/);
        if (!action || action === 'help') { ctx.ui.notify(supplierHelp, 'info'); return; }
        if (extra || !['connect', 'tools', 'schema', 'call', 'file', 'retry'].includes(action)) fail('SUPPLIER_COMMAND_INVALID');
        const service = await client();
        if (action === 'connect') { show(ctx, await service.connect()); return; }
        if (action === 'tools') { show(ctx, (await service.tools()).map(tool => ({ name: tool.name, description: tool.description }))); return; }
        let pending;
        if (action === 'retry') {
          pending = await journal.read(await service.scope());
          if (!pending || !supplierReplayable(pending.operation)) fail('SUPPLIER_READ_OR_RECONCILE_REQUIRED');
        } else {
          if (!SUPPLIER_TOOLS.includes(operation)) fail('SUPPLIER_TOOL_REQUIRED');
          const tool = (await service.tools()).find(item => item.name === supplierToolName(operation));
          if (action === 'schema') { show(ctx, tool.inputSchema); return; }
          const value = await ctx.ui.input(action === 'file' ? 'Absolute path to exact supplier arguments JSON file' : `Arguments JSON for ${operation} (see schema; no identity or credentials)`);
          if (value === undefined) return;
          let input;
          try { input = JSON.parse(action === 'file' ? await readArguments(value.trim()) : value); }
          catch (error) { if (error.code) throw error; fail('SUPPLIER_ARGUMENTS_JSON_REQUIRED'); }
          if (!input || typeof input !== 'object' || Array.isArray(input)) fail('SUPPLIER_ARGUMENTS_JSON_REQUIRED');
          if (tool.inputSchema.properties.input?.required?.includes('requestId') && input.input && !Object.hasOwn(input.input, 'requestId')) input.input.requestId = randomUUID();
          pending = { scope: await service.scope(), operation, args: input };
        }
        if (!supplierReadOnly(pending.operation)) {
          const review = plain(JSON.stringify(reviewedArguments(pending.args)));
          if (!await ctx.ui.confirm(`${action === 'retry' ? 'RETRY SAME' : 'CALL'} ${pending.operation} through the original owner MCP?`, review + '\nThis confirmation does not grant publication/schedule approval. Unknown results require original read/reconcile; no automatic retry.')) {
            ctx.ui.notify('Action cancelled.', 'info'); return;
          }
          if (action !== 'retry') await journal.save(pending);
        }
        show(ctx, { tool: supplierToolName(pending.operation), result: await service.call(pending.operation, pending.args, pending.scope) });
      } catch (error) {
        const code = error?.code || error?.message;
        ctx.ui.notify(/^[A-Z0-9_]{1,100}$/.test(code) ? code : 'SUPPLIER_COMMAND_FAILED', 'error');
      } finally { leave(); }
    },
  });
}
