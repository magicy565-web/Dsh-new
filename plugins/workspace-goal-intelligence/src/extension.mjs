import { INPUTS, PLUGIN, BrainError } from './contracts.mjs';

export const BRAIN_TOOLS = Object.freeze({
  workspace_brain_sources: 'sourceCatalog',
  workspace_brain_context: 'contextRead',
  workspace_brain_context_save: 'contextSave',
  workspace_brain_diagnose: 'diagnose',
  workspace_brain_decision: 'decisionRead',
  workspace_brain_decision_save: 'decisionSave',
  workspace_brain_review_save: 'reviewSave',
  workspace_brain_brief: 'brief',
});
const descriptions = {
  sourceCatalog: 'List exact original Host-reviewed company, product and metric references, including approved field masks, source versions and original Goal IDs. No arbitrary catalog search or budget grant.',
  contextRead: 'Read this enterprise\'s saved business context and current, explicitly authorized source projections and original goals. Facts are observations; model notes are not policy or causal truth.',
  diagnose: 'Inspect source-backed inquiry, product-completeness and commerce cohort measurements from this enterprise context. Keep unknown/pending outcomes, incomplete baselines and descriptive differences explicit. Never infer root cause or forecast conversion.',
  contextSave: 'Save a revised, unreviewed business context to original artifacts. Bind existing goals and exact selected source versions. Model summaries and preference claims never approve goals, budget, prices or permissions. Use expectedRevision and stable requestId. A blocked save with writeOutcome unknown may already be persisted; never retry with a new requestId.',
  decisionRead: 'Read an existing decision, current evidence and scenario arithmetic. Fails closed on changed enterprise context, revoked evidence or wrong model receiver.',
  decisionSave: 'Save a model-authored business decision with competing hypotheses, supporting/counter evidence, alternatives including investigation/wait, and a verification plan. Estimates are assumptions, not forecasts. No task, approval, payment or external action.',
  reviewSave: 'Save a source-backed outcome review. Read an actual metric observation for the declared metric and window. Missing coverage requires inconclusive. Neither a completed task nor a before/after difference verifies a business goal or causation.',
  brief: 'Read at most three realtime business action proposals derived from the current enterprise context and authorized observations. Cards expose evidence gaps or pending decisions; they are not forecasts, causal claims or execution approvals. Opening a card must use the original goal and its original approval/execution services.',
};
/** registerContextGuard is an original Host callback, not a model input.
 * The Host must retain dependencies across compaction/restore and MUST NOT
 * swallow a validator error before provider send/final delivery.
 */
export function businessBrainExtension({ brain, registerContextGuard } = {}) {
  return pi => {
    let configured = false;
    if (brain && typeof registerContextGuard === 'function') {
      const result = registerContextGuard({ plugin: PLUGIN, validateReceipt: brain.revalidateReceipt });
      if (result !== true) throw new BrainError('BRAIN_CONTEXT_GUARD_REQUIRED');
      configured = true;
    }
    pi.on?.('before_agent_start', async event => {
      if (event.messageType !== 'user') return;
      const guidance = [
        '[ENTERPRISE BUSINESS BRAIN]',
        'You are operating inside one enterprise\'s private Business Brain. It is the decision context layer, not a second task runner.',
        'Read the relevant loaded handbook with workspace_skill when needed. Choose tools according to the question: workspace_brain_context or workspace_brain_brief can recover useful context, and workspace_brain_sources lists approved sources. You may answer, clarify or stop without a tool or saved record; no mandatory first step or tool sequence is implied.',
        'Use workspace_brain_diagnose for measured observations. Treat missing, pending, stale or unknown data as gaps; never invent KPI values or infer causality from correlation.',
        'When enough evidence exists, compare at least one investigate/wait alternative before saving a decision with workspace_brain_decision_save. A saved decision is model-authored and unreviewed: it does not approve spending, pricing, external contact or worker execution.',
        'Do not create a second memory, queue, scheduler or database. Continue the same Goal/session and use the original Workspace execution tools for any actual action.'
      ].join('\n');
      return { systemPrompt: event.systemPrompt + '\n\n' + guidance };
    });
    for (const [name, method] of Object.entries(BRAIN_TOOLS)) {
      pi.registerTool({ name, label: name.replace('workspace_brain_', 'Business brain: '),
        description: descriptions[method], parameters: INPUTS[method],
        annotations: { readOnlyHint: !method.endsWith('Save'), destructiveHint: false, idempotentHint: !method.endsWith('Save'), openWorldHint: false },
        approval: method.endsWith('Save') ? 'write' : 'read',
        async execute(_toolCallId, input, signal, _onUpdate, ctx) {
          let result;
          try {
            if (!configured) result = { plugin: PLUGIN, status: 'unconfigured', reason: 'BRAIN_REVIEWED_HOST_AND_CONTEXT_GUARD_REQUIRED' };
            else if (!ctx?.model) throw new BrainError('BRAIN_RECEIVER_MISMATCH');
            else result = await brain[method](input, signal, ctx.model);
          } catch (error) {
            result = { plugin: PLUGIN, status: 'blocked',
              reason: signal?.aborted ? 'BRAIN_CANCELLED' : error instanceof BrainError && ['BRAIN_RECEIVER_MISMATCH','BRAIN_INPUT_INVALID','BRAIN_SOURCE_CHANGED','BRAIN_SOURCE_NOT_SELECTED'].includes(error.code) ? error.code : 'BRAIN_OPERATION_UNAVAILABLE',
              // An uncertain upstream commit may have persisted. Do not auto
              // retry a new request; reopen the exact original record first.
              retryWithNewRequest: false, ...(method.endsWith('Save') ? { writeOutcome: 'unknown' } : {}) };
          }
          const isError = ['blocked','unconfigured'].includes(result.status);
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result, ...(isError ? { isError: true } : {}) };
        },
      });
    }
  };
}
// Installing the package does NOT grant private enterprise/model access.
export default function extension(pi) {let host;pi.events?.emit('workspace:plugin-host',{accept:value=>{host=value;}});return businessBrainExtension({brain:host?.brain,registerContextGuard:host?.registerBrainContextGuard})(pi);}
