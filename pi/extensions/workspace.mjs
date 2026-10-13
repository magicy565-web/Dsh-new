import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Type } from '@earendil-works/pi-ai';
import { matchesKey } from '@earendil-works/pi-tui';

const API = '/api/agent/v1/pi/tasks';
export const WORKSPACE_TOOLS = Object.freeze(['workspace_task', 'workspace_status', 'workspace_delegate']);
const commands = new Set(['ws-task', 'ws-delegate', 'ws-status', 'ws-cancel', 'ws-resume', 'ws-approve', 'ws-continue', 'ws-quit', 'quit']);
const requestIdentifier = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(value)) throw new Error('Use a requestId of at most 96 letters, numbers, underscores or dashes.');
  return value;
};
const identifier = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) throw new Error('Use an original Workspace task or proposal ID.');
  return value;
};

// This is a transport adapter, not a task registry. The original authenticated
// Workspace service owns admission, identities, approvals, budgets and output.
export function createWorkspaceClient({ baseURL, token, fetchImpl = fetch } = {}) {
  let base;
  try { base = new URL(baseURL); } catch { throw new Error('Set WS_AGENT_URL to the original Workspace service origin.'); }
  const host = base.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '::1' || isIP(host) === 4 && host.startsWith('127.');
  if (!['http:', 'https:'].includes(base.protocol) || base.protocol === 'http:' && !loopback
    || base.username || base.password || base.search || base.hash || !['/', '/api/agent/v1', '/api/agent/v1/'].includes(base.pathname))
    throw new Error('Use HTTPS or a loopback HTTP Workspace origin, without credentials or query parameters.');
  if (typeof token !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(token)) throw new Error('Workspace access is blocked until the existing WS_AGENT_TOKEN is injected into memory.');
  const origin = base.origin;
  async function request(method, suffix = '', body, signal) {
    let response;
    try {
      response = await fetchImpl(origin + API + suffix, { method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new Error('Workspace request did not settle. Check the original task status before retrying.'); }
    // Bound the response while reading; do not expose arbitrary remote error text
    // or Authorization values through the TUI.
    let bytes = 0, text = '';
    const reader = response.body?.getReader(), decoder = new TextDecoder();
    if (!reader) throw new Error('Workspace returned no task receipt.');
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 2_000_000) { await reader.cancel(); throw new Error('Workspace task receipt exceeded its transport limit.'); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    if (!response.ok) throw new Error(`Workspace refused this operation (HTTP ${response.status}). No approval or task result is implied.`);
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('Workspace returned an invalid task receipt.'); }
    const redact = input => typeof input === 'string' ? input.replaceAll(token, '[REDACTED]')
      : Array.isArray(input) ? input.map(redact)
        : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).map(([key, item]) => [key.replaceAll(token, '[REDACTED]'), redact(item)])) : input;
    return redact(value);
  }
  return Object.freeze({
    submit: (input, signal) => request('POST', '', input, signal),
    status: (runId, signal) => request('GET', '/' + encodeURIComponent(identifier(runId)), undefined, signal),
    cancel: (runId, signal) => request('POST', '/' + encodeURIComponent(identifier(runId)) + '/cancel', {}, signal),
    resume: (runId, requestId = randomUUID(), signal) => request('POST', '/' + encodeURIComponent(identifier(runId)) + '/resume', { requestId: requestIdentifier(requestId) }, signal),
    decision: (runId, proposalId, decision, signal) => request('POST', '/' + encodeURIComponent(identifier(runId)) + '/decision', { proposalId: identifier(proposalId), decision, confirmed: true }, signal),
    continue: (runId, proposalId, requestId = randomUUID(), signal) => request('POST', '/' + encodeURIComponent(identifier(runId)) + '/continue', { proposalId: identifier(proposalId), requestId: requestIdentifier(requestId) }, signal),
  });
}

function taskInput(input, delegation = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['title', 'content', 'requestId', 'connectorActions'].includes(key)))
    throw new Error('Task JSON allows only title, content, requestId and explicitly selected connectorActions.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 16000)
    throw new Error('Provide a task title and explicit text input within the original Workspace limits.');
  return { ...input, requestId: requestIdentifier(input.requestId || randomUUID()), ...(delegation ? { delegation: true } : {}) };
}
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], details: value });
const parseInput = args => {
  try { return JSON.parse(args); } catch { throw new Error('Provide valid task JSON with title and content.'); }
};

// Official extension terminal hook runs before builtin command dispatch and
// editor shortcuts. Keep the original Pi editor; restrict this text-only profile
// rather than replacing it or patching the upstream implementation.
export function workspaceTerminalInputPolicy(data, editorText = '') {
  if (['ctrl+g', 'ctrl+v', 'alt+v', 'tab'].some(key => matchesKey(data, key)))
    return 'External editors, file completion and clipboard attachments are unavailable in this explicit-text Workspace profile.';
  if (matchesKey(data, 'enter')) {
    const input = editorText.trim();
    if (input.startsWith('/') && !commands.has(input.split(/\s+/)[0].slice(1)))
      return 'Only /ws-* task commands and /quit are available in this Workspace profile.';
  }
}

export function workspaceExtension(client, { sample = false, close = async () => {} } = {}) {
  return pi => {
    let removeTerminalPolicy = () => {};
    const show = value => pi.sendMessage({ customType: 'workspace-receipt', content: JSON.stringify(value, null, 2), display: true }, { triggerTurn: false });
    pi.on('session_start', (_event, ctx) => {
      removeTerminalPolicy();
      removeTerminalPolicy = ctx.ui.onTerminalInput(data => {
        const reason = workspaceTerminalInputPolicy(data, ctx.ui.getEditorText());
        if (reason) { ctx.ui.notify(reason, 'warning'); return { consume: true }; }
      });
      pi.setActiveTools([...WORKSPACE_TOOLS]);
      ctx.ui.setStatus('workspace', sample ? 'Workspace · controlled faux sample' : 'Workspace · original task authority');
      ctx.ui.notify('Use /ws-task, /ws-delegate, /ws-status, /ws-cancel, /ws-resume, /ws-approve, /ws-continue or /ws-quit. Task JSON contains explicit public text only.', 'info');
    });
    pi.on('session_shutdown', async () => { removeTerminalPolicy(); await close(); });
    pi.on('user_bash', () => ({ result: { output: 'Shell execution is unavailable in the Workspace TUI profile.', exitCode: 1, cancelled: false, truncated: false } }));
    pi.on('tool_call', event => WORKSPACE_TOOLS.includes(event.toolName) ? undefined : { block: true, reason: 'Only the admitted Workspace plugin tools are available.' });
    pi.on('session_before_switch', () => ({ cancel: true }));
    pi.on('session_before_fork', () => ({ cancel: true }));
    pi.on('input', (event, ctx) => {
      if (event.images?.length) {
        ctx.ui.notify('Image and file attachments are unavailable; submit explicit public text only.', 'warning');
        return { action: 'handled' };
      }
      if (event.text.startsWith('/') && !commands.has(event.text.trim().split(/\s+/)[0].slice(1))) {
        ctx.ui.notify('Only /ws-* task commands are available in this Workspace profile.', 'warning');
        return { action: 'handled' };
      }
      if (!sample) {
        ctx.ui.notify('Natural-language model execution is blocked in this command profile. Start an original backend task with /ws-task JSON; no TUI model account is configured.', 'warning');
        return { action: 'handled' };
      }
      return { action: 'continue' };
    });
    const taskParameters = Type.Object({ title: Type.String({ minLength: 1, maxLength: 160 }), content: Type.String({ minLength: 1, maxLength: 16000 }),
      requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 96, pattern: '^[A-Za-z0-9_-]+$' })), connectorActions: Type.Optional(Type.Array(Type.Object({ connectorId: Type.String(), action: Type.String() }, { additionalProperties: false }))) }, { additionalProperties: false });
    for (const [name, delegation] of [['workspace_task', false], ['workspace_delegate', true]]) {
      pi.registerTool({ name, label: delegation ? 'Workspace delegate task' : 'Workspace task', parameters: taskParameters,
        description: delegation ? 'Submit explicit user text to the original Workspace task, with its bounded native child capability. Workspace owns all child identity, budget and results.' : 'Submit explicit user text to the original Workspace task. This tool cannot read local files or grant new authority.',
        async execute(_id, input, signal) { return result(await client.submit(taskInput(input, delegation), signal)); } });
    }
    pi.registerTool({ name: 'workspace_status', label: 'Workspace task status', parameters: Type.Object({ runId: Type.String() }, { additionalProperties: false }),
      description: 'Read actual persisted Workspace task, reply, proposal, usage and event state for the original run.',
      async execute(_id, input, signal) { return result(await client.status(input.runId, signal)); } });
    const command = (name, description, handler) => pi.registerCommand(name, { description, handler: async (args, ctx) => {
      try { const value = await handler(args, ctx); if (value !== undefined) show(value); }
      catch (error) { ctx.ui.notify(error.message, 'error'); }
    } });
    command('ws-task', 'Submit an original Workspace task: /ws-task {"title":"...","content":"..."}', args => client.submit(taskInput(parseInput(args))));
    command('ws-delegate', 'Submit a task with an original bounded native child: /ws-delegate {"title":"...","content":"..."}', args => client.submit(taskInput(parseInput(args), true)));
    command('ws-status', 'Read original task state: /ws-status RUN_ID', args => client.status(args.trim()));
    command('ws-cancel', 'Cancel original task: /ws-cancel RUN_ID', args => client.cancel(args.trim()));
    command('ws-resume', 'Explicitly recover original checkpoint: /ws-resume RUN_ID', args => client.resume(args.trim()));
    command('ws-approve', 'Review exact original proposal: /ws-approve RUN_ID PROPOSAL_ID', async (args, ctx) => {
      const [runId, proposalId, extra] = args.trim().split(/\s+/); identifier(runId); identifier(proposalId); if (extra) throw new Error('Use an original run and proposal ID.');
      const receipt = await client.status(runId);
      const proposals = receipt.proposals || receipt.run?.proposals || receipt.task?.proposals || [];
      const proposal = proposals.find(value => value.id === proposalId);
      if (!proposal) throw new Error('The exact original task proposal is unavailable. No approval was sent.');
      const confirmed = await ctx.ui.confirm('Approve this exact original Workspace proposal?', JSON.stringify(proposal, null, 2));
      if (!confirmed) return { approved: false, runId, proposalId, detail: 'No approval was sent.' };
      return client.decision(runId, proposalId, 'approved');
    });
    command('ws-continue', 'Explicitly execute an already approved action: /ws-continue RUN_ID PROPOSAL_ID', args => {
      const [runId, proposalId, extra] = args.trim().split(/\s+/); if (extra) throw new Error('Use an original run and proposal ID.');
      return client.continue(runId, proposalId);
    });
    command('ws-quit', 'Close the official Pi TUI and its sample backend', async (_args, ctx) => { await close(); ctx.shutdown(); });
  };
}
