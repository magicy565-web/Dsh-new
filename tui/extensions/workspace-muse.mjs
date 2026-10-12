import { randomUUID } from 'node:crypto';
import { createWorkspaceClient, loadOwnerTransport } from '../workspace-client.mjs';
import { createRequestJournal } from '../request-journal.mjs';

// Untrusted task/result text must not send terminal control sequences.
const plain = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
const show = (ctx, value) => ctx.ui.notify(plain(JSON.stringify(value)), 'info');
const help = 'Commands: /workspace-muse connect | new | retry | list | status ID | approve ID | dispatch ID | refresh ID | cancel ID | accept ID. Approval and dispatch are separate human confirmations. Queued does not mean Muse claimed.';

export function registerWorkspaceMuse(pi, { transport = loadOwnerTransport, journal = createRequestJournal() } = {}) {
  let client, busy = false;
  const getClient = async () => client ||= createWorkspaceClient(await transport());
  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.setStatus('workspace-muse', 'Workspace → original Muse • /workspace-muse');
    ctx.ui.notify(help, 'info');
  });
  // This focused TUI entry uses deterministic commands, without model spending.
  pi.on('input', async (_event, ctx) => { ctx.ui.notify(help, 'info'); return { action: 'handled' }; });
  pi.on('user_bash', async () => ({ result: { output: 'Use /workspace-muse for reviewed Workspace actions.', exitCode: 1, cancelled: false, truncated: false } }));
  pi.registerCommand('workspace-muse', {
    description: 'Prepare, separately approve/dispatch, and read original Muse tasks through the existing owner session.',
    handler: async (args, ctx) => {
      if (ctx.mode !== 'tui' || !ctx.hasUI) throw new Error('INTERACTIVE_TUI_REQUIRED');
      if (busy) { ctx.ui.notify('A Workspace command is still pending.', 'warning'); return; }
      busy = true;
      try {
        const [operation = 'help', orderId, extra] = args.trim().split(/\s+/);
        if (!operation || operation === 'help') { ctx.ui.notify(help, 'info'); return; }
        if (extra || !['connect', 'new', 'retry', 'list', 'status', 'approve', 'dispatch', 'refresh', 'cancel', 'accept'].includes(operation)) throw new Error('COMMAND_INVALID');
        const api = await getClient();
        if (operation === 'connect') { show(ctx, await api.connect()); return; }
        if (operation === 'list') { show(ctx, await api.list()); return; }
        if (operation === 'new') {
          const scope = await api.connect();
          const order = {};
          for (const [field, label] of [
            ['serviceId', 'Existing service ID (for example channel-validation)'],
            ['product', 'Public product description'], ['market', 'Target market'],
            ['objective', 'Task objective and required deliverables'],
            ['budgetCredits', 'Exact maximum credits'], ['deadlineAt', 'Deadline with timezone (ISO 8601)'],
          ]) {
            const answer = await ctx.ui.input(label);
            if (answer === undefined) return;
            order[field] = answer.trim();
          }
          order.budgetCredits = Number(order.budgetCredits);
          if (!Number.isFinite(order.budgetCredits) || order.budgetCredits <= 0 || !Number.isFinite(Date.parse(order.deadlineAt)) || !/(Z|[+-]\d\d:\d\d)$/.test(order.deadlineAt)) throw new Error('EXPLICIT_BUDGET_AND_DEADLINE_REQUIRED');
          if (!await ctx.ui.confirm('Save this public task for review?', plain(JSON.stringify(order)) + '\nConfirm these fields may be shared with your existing Muse. This does not approve or dispatch it.')) return;
          order.publicDataConfirmed = true;
          const pending = { scope, input: { provider: 'muse', conversationId: scope.conversationId, requestId: randomUUID(), content: order.objective, order } };
          // Journal before the request. Retry always uses this exact body/UUID.
          await journal.save(pending);
          show(ctx, await api.prepare(pending));
          return;
        }
        if (operation === 'retry') {
          const pending = await journal.read(await api.connect());
          if (!pending) throw new Error('NO_ORIGINAL_PENDING_REQUEST');
          if (!await ctx.ui.confirm('Retry the same saved task request?', plain(JSON.stringify(pending.input)))) return;
          show(ctx, await api.prepare(pending)); return;
        }
        if (!orderId || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(orderId)) throw new Error('ORIGINAL_ORDER_ID_REQUIRED');
        const current = await api.get(orderId);
        if (operation === 'status') { show(ctx, current); return; }
        if (operation === 'refresh') { show(ctx, await api.act(operation, orderId)); return; }
        const { delegation } = current;
        if (!delegation?.reviewHash || delegation.orderId !== orderId) throw new Error('ORIGINAL_REVIEW_REQUIRED');
        if (!await ctx.ui.confirm(`${operation.toUpperCase()} this exact original task?`, plain(JSON.stringify(delegation)))) {
          ctx.ui.notify('Action cancelled.', 'info'); return;
        }
        show(ctx, await api.act(operation, orderId, { confirmed: true, expectedReviewHash: delegation.reviewHash,
          ...(operation === 'accept' ? { receiptHash: delegation.receiptHash } : {}) }));
      } catch (error) {
        const code = error?.code || error?.message;
        ctx.ui.notify(/^[A-Z0-9_]{1,100}$/.test(code) ? code : 'WORKSPACE_COMMAND_FAILED', 'error');
      } finally { busy = false; }
    },
  });
}

export default registerWorkspaceMuse;
