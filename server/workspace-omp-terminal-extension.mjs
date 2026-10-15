import { workspaceOmpPublicInputReason } from './workspace-omp-public-profile.mjs';

// Official input and UI hooks only: never prompts the UI AgentSession and
// never implements a second model/tool/execution loop.
export function workspaceOmpTerminalExtension(transport) {
  return pi => {
    let submitting = false;
    const show = (kind, value) => pi.sendMessage({ customType: kind, content: JSON.stringify(value, null, 2), display: true }, { triggerTurn: false });
    pi.on('session_start', (_event, ctx) => {
      ctx.ui.setStatus('workspace', 'Workspace · official OMP UI · original Run authority · terminal model disabled');
      ctx.ui.notify('Natural input is read-only. /ws-execute TEXT requires human confirmation before original business submission. /ws-stop confirms frontend stop; admitted business tasks retain separate original controls.', 'info');
    });
    const submit = async (text, ctx, workspaceExecution = false) => {
      if (submitting) { ctx.ui.notify('The original Run is active; use /ws-stop or wait for its exact receipt.', 'warning'); return { handled: true }; }
      submitting = true;
      try {
        const admitted = await transport.submit(text, { workspaceExecution }); show('workspace-original-admission', { conversationId: admitted.conversationId, runId: admitted.run.id, status: admitted.run.status, workspaceExecution });
        let eventCount = 0;
        const completed = await transport.wait(admitted.run.id, receipt => {
          if ((receipt.run?.events?.length || 0) > eventCount) {
            show('workspace-original-events', { runId: admitted.run.id, events: receipt.run.events.slice(eventCount) }); eventCount = receipt.run.events.length;
          }
        });
        show('workspace-original-result', completed);
      } catch (error) { ctx.ui.notify(error.message, 'error'); }
      finally { submitting = false; }
      return { handled: true };
    };
    pi.on('input', async (event, ctx) => {
      const reason = workspaceOmpPublicInputReason(event.text, event.images);
      if (reason) { ctx.ui.notify(reason, 'warning'); return { handled: true }; }
      if (event.text.trim().startsWith('/')) return;
      return submit(event.text, ctx);
    });
    pi.registerCommand('ws-execute', { description: 'Explicitly submit public text with original business execution intent: /ws-execute TEXT', handler: async (text, ctx) => {
      const reason = workspaceOmpPublicInputReason(text);
      if (reason || !text.trim() || text.trimStart().startsWith('/')) { ctx.ui.notify(reason || 'Supply explicit public execution text.', 'warning'); return; }
      if (!ctx.hasUI || await ctx.ui.confirm('Allow original business submission for this exact public input?', text) !== true) {
        show('workspace-original-execution-declined', { submitted: false, reason: 'HUMAN_CONFIRMATION_DECLINED' }); return;
      }
      return submit(text, ctx, true);
    } });
    pi.registerCommand('ws-stop', { description: 'Stop only the current original frontend answer after human confirmation.', handler: async (_args, ctx) => {
      try {
        const receipt = await transport.status();
        if (!receipt.run || !['queued', 'running'].includes(receipt.run.status)) { show('workspace-original-status', receipt); return; }
        if (ctx.hasUI && await ctx.ui.confirm('Stop this original Workspace frontend Run?', JSON.stringify({ runId: receipt.run.id, status: receipt.run.status, backendTasksCancelled: false })) === true)
          show('workspace-original-stopped', await transport.stop());
        else show('workspace-original-stop-declined', { runId: receipt.run.id, stopped: false, reason: 'HUMAN_CONFIRMATION_DECLINED' });
      } catch (error) { ctx.ui.notify(error.message, 'error'); }
    } });
    pi.registerCommand('ws-front-status', { description: 'Read the exact current original frontend Run and reply.', handler: async (_args, ctx) => {
      try { show('workspace-original-status', await transport.status()); } catch (error) { ctx.ui.notify(error.message, 'error'); }
    } });
  };
}
