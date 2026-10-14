import { matchesKey } from '@earendil-works/pi-tui';
import { workspaceTerminalInputPolicy, validatePublicBusinessInput } from '../packages/workspace-procurement/src/workspace.mjs';

const commands = new Set(['ws-task', 'ws-status', 'ws-business-status', 'ws-cancel', 'ws-resume', 'ws-approve',
  'ws-continue', 'ws-business-cancel', 'ws-business-resume', 'quit']);
export function workspaceOmpPublicInputReason(text, images = []) {
  if (images.length || /(?:^|\s)@\S+/.test(text)) return 'Use explicitly supplied public text; file and image attachments are unavailable.';
  if (/^(?:!|\$\$?\s)/.test(text.trimStart())) return 'Shell and Python execution are unavailable in this controlled Workspace profile.';
  if (text.trimStart().startsWith('/') && !commands.has(text.trim().split(/\s+/)[0].slice(1))) return 'Only the original human task commands and /quit are available.';
  try { validatePublicBusinessInput(text); } catch { return 'Use bounded public text without credentials.'; }
}

// Keep the official editor/agent loop. Reuse the original explicit-text input
// contract through official OMP hooks; never install the old Library extension.
export function workspaceOmpPublicProfile(activeTools) {
  return pi => {
    let remove = () => {};
    pi.on('session_start', (_event, ctx) => {
      remove();
      remove = ctx.ui.onTerminalInput(data => {
        const text = ctx.ui.getEditorText();
        const reason = workspaceTerminalInputPolicy(data, text)
          || (matchesKey(data, 'enter') ? workspaceOmpPublicInputReason(text) : undefined);
        if (reason) { ctx.ui.notify(reason, 'warning'); return { consume: true }; }
      });
      pi.setActiveTools(activeTools);
      ctx.ui.setStatus('workspace', 'Workspace · OMP · public text · original task authority');
    });
    pi.on('session_shutdown', () => remove());
    pi.on('input', (event, ctx) => {
      const reason = workspaceOmpPublicInputReason(event.text, event.images);
      if (reason) { ctx.ui.notify(reason, 'warning'); return { handled: true, images: [] }; }
    });
    pi.on('tool_call', event => activeTools.includes(event.toolName) ? undefined : { block: true, reason: 'Only admitted factory tools are available.' });
    pi.on('user_bash', () => ({ result: { output: 'Shell execution is unavailable.', exitCode: 1, cancelled: false, truncated: false } }));
    pi.on('session_before_switch', () => ({ cancel: true }));
    pi.on('session_before_branch', () => ({ cancel: true }));
    pi.on('session_before_tree', () => ({ cancel: true }));
    pi.on('session_before_compact', () => ({ cancel: true }));
  };
}
