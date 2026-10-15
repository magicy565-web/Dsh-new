import { object, validate } from './plan.mjs';
const ref = { type: 'string', minLength: 1, maxLength: 256, pattern: '^\\S(?:[^\\u0000-\\u001f\\u007f]*\\S)?$' };
const id = { ...ref, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' };
export const MONITOR_REQUEST_SCHEMA = object({ requestId: id, planId: ref,
  planRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, launchReceiptId: ref });
export const MONITOR_STATUS_SCHEMA = object({ goalId: id });
export const MONITOR_CONTROL_SCHEMA = object({ goalId: id, action: { type: 'string', enum: ['pause', 'cancel', 'resume'] } });
export const MARKET_MONITOR_TOOLS = Object.freeze(['workspace_market_monitor_request', 'workspace_market_monitor_status', 'workspace_market_monitor_control_request']);
export function marketValidationMonitorExtension({ client, authorize } = {}) {
  return pi => {
    for (const [i, method, schema, description] of [
      [0, 'request', MONITOR_REQUEST_SCHEMA, 'Propose one original draft Goal and disabled seven-day Schedule from an actual approved acquisition receipt. Request original schedule approval; never decide it, enable it, collect data or start acquisition. Saving/publishing a product is not acquisition. Repeated launch references reuse the original task.'],
      [1, 'status', MONITOR_STATUS_SCHEMA, 'Read current original owned monitor progress, schedule approval and retained evidence. Missing counts remain null. Seven-day completion and benchmark assessment never verify the original Goal.'],
      [2, 'control', MONITOR_CONTROL_SCHEMA, 'Persist a pending pause/cancel/resume request in the original approval ledger, bound to the exact task state and schedule revision. A human must approve then execute through original Session/CSRF controls. Never decide, apply or self-confirm. Resume retains the launch window and requires fresh schedule approval.'],
    ]) pi.registerTool({ name: MARKET_MONITOR_TOOLS[i], label: MARKET_MONITOR_TOOLS[i], description, parameters: schema,
      approval: method === 'status' ? 'read' : 'write',
      async execute(_id, input, signal, _update, ctx) {
        let receipt, phase = 'input';
        try {
          signal?.throwIfAborted(); validate(input, schema);
          if (typeof client?.[method] !== 'function' || typeof authorize !== 'function') receipt = { status: 'unconfigured', reason: 'ORIGINAL_MONITOR_HOST_REQUIRED', sources: [] };
          else {
            phase = 'authorization'; if (!ctx?.model) throw Error('Exact receiver required.');
            await authorize(signal, ctx.model); signal?.throwIfAborted(); phase = 'operation';
            receipt = await client[method](input, signal, ctx.model);
            if (receipt?.plugin !== 'workspace-market-monitor' || !['available', 'human_action_required'].includes(receipt.status)) throw Error('Original monitor receipt required.');
            phase = 'authorization'; signal?.throwIfAborted(); await authorize(signal, ctx.model); signal?.throwIfAborted();
          }
        } catch (e) {
          const codes = ['REAL_LAUNCH_RECEIPT_REQUIRED', 'MARKET_PLAN_RECEIPT_MISMATCH', 'MONITOR_NOT_FOUND', 'MONITOR_SOURCE_OWNER_REQUIRED', 'MONITOR_SCOPE_CHANGED', 'APPROVAL_REQUIRED', 'APPROVAL_MISMATCH', 'APPROVAL_EXPIRED', 'APPROVAL_USED', 'MONITOR_STOPPED', 'MONITOR_WINDOW_ENDED', 'MONITOR_CANCELLED', 'LAUNCH_SCOPE_CHANGED', 'MARKET_PLAN_SOURCE_CHANGED', 'BUSINESS_EXECUTION_INTENT_REQUIRED'];
          receipt = { status: 'blocked', sources: [], reason: signal?.aborted || e?.name === 'AbortError' ? 'ORIGINAL_OPERATION_CANCELLED' : phase === 'input' ? 'MARKET_MONITOR_INPUT_INVALID' : phase === 'authorization' ? 'ORIGINAL_AUTHORIZATION_REFUSED' : codes.includes(e?.code) ? e.code : [401, 403].includes(e?.status) ? 'ORIGINAL_AUTHORIZATION_REFUSED' : 'ORIGINAL_MONITOR_REFUSED' };
        }
        receipt = { ...receipt, plugin: 'workspace-market-monitor' };
        return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt, ...(['blocked', 'unconfigured'].includes(receipt.status) ? { isError: true } : {}) };
      } });
  };
}
