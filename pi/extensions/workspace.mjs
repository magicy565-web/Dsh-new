import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Type } from '@earendil-works/pi-ai';
import { matchesKey } from '@earendil-works/pi-tui';
import { looksLikeCredential } from '../../server/security.mjs';

const API = '/api/agent/v1/pi/tasks';
const BUSINESS_API = '/api/agent/v1';
export const WORKSPACE_TOOLS = Object.freeze(['workspace_task', 'workspace_status', 'workspace_delegate', 'workspace_business_presets', 'workspace_business_task', 'workspace_business_status']);
export const WORKSPACE_BUSINESS_TOOLS = Object.freeze(['workspace_business_presets', 'workspace_business_task', 'workspace_business_status']);
const commands = new Set(['ws-task', 'ws-delegate', 'ws-status', 'ws-cancel', 'ws-resume', 'ws-approve', 'ws-continue', 'ws-presets', 'ws-procurement', 'ws-business', 'ws-business-status', 'ws-business-resume', 'ws-quit', 'quit']);
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
  async function request(method, suffix = '', body, signal, { business = false, requestId, textOnly = false, maxBytes = 2_000_000, expectedBytes } = {}) {
    let response;
    try {
      response = await fetchImpl(origin + (business ? BUSINESS_API : API) + suffix, { method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, Accept: textOnly ? 'text/markdown, text/plain' : 'application/json', ...(requestId ? { 'Idempotency-Key': requestId } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
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
        if (bytes > maxBytes) { await reader.cancel(); throw new Error('Workspace task receipt exceeded its transport limit.'); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    if (!response.ok) throw new Error(`Workspace refused this operation (HTTP ${response.status}). No approval or task result is implied.`);
    if (expectedBytes !== undefined && bytes !== expectedBytes) throw new Error('Original artifact bytes do not match their task receipt.');
    let value;
    if (textOnly) {
      if (!/^text\/(?:markdown|plain)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Workspace artifact is not an admitted text document.');
      value = text;
    } else try { value = JSON.parse(text); } catch { throw new Error('Workspace returned an invalid task receipt.'); }
    const redact = input => typeof input === 'string' ? input.replaceAll(token, '[REDACTED]')
      : Array.isArray(input) ? input.map(redact)
        : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).map(([key, item]) => [key.replaceAll(token, '[REDACTED]'), redact(item)])) : input;
    return redact(value);
  }
  const businessPresets = signal => request('GET', '/presets', undefined, signal, { business: true });
  async function check(signal) {
    // Readiness is configuration evidence only. Never submit a probe task or
    // make a model request, and authenticate against the original registry.
    const health = await request('GET', '/health', undefined, signal, { business: true, maxBytes: 64_000 });
    const presets = await businessPresets(signal);
    const rows = Array.isArray(presets) ? presets : presets?.presets;
    if (!Array.isArray(rows) || !rows.some(row => row.id === 'procurement' && Array.isArray(row.required_inputs) && Array.isArray(row.optional_inputs)))
      throw new Error('Workspace readiness failed: original procurement preset is unavailable.');
    if (health.status !== 'ok' || health.projection?.projection !== 'ready') throw new Error('Workspace readiness failed: original backend health or task projection requires review.');
    if (health.runtime !== 'pi-durable' || health.mode !== 'model' || health.readiness !== 'configured_unverified' || health.configured !== true || typeof health.model !== 'string' || !health.model)
      throw new Error('Workspace readiness failed: the original Pi backend model is not configured. No task or model call was sent.');
    return { backend: 'original-workspace', health: health.status, version: health.version, mode: health.mode, runtime: health.runtime, model: health.model,
      configured: true, onlineVerified: false, readiness: health.readiness, projection: health.projection.projection,
      presets: rows.map(row => row.id), naturalLanguage: 'blocked-command-profile', modelCalls: 0 };
  }
  async function businessSubmit(input, signal) {
    const value = await businessInput(input, await businessPresets(signal));
    const { requestId, ...body } = value;
    const task = await request('POST', '/tasks', body, signal, { business: true, requestId });
    return { profile: 'business-preset', identity: 'taskId', delegatedExecution: false, task };
  }
  async function businessStatus(taskId, signal) {
    const id = encodeURIComponent(identifier(taskId));
    const task = await request('GET', '/tasks/' + id, undefined, signal, { business: true });
    if (task.taskId !== taskId || !Array.isArray(task.artifacts) || task.artifacts.length > 40) throw new Error('Workspace returned an invalid business task receipt.');
    const events = await request('GET', '/tasks/' + id + '/events?format=json', undefined, signal, { business: true });
    const artifacts = [];
    let total = 0;
    // Only original task metadata selects authenticated text artifacts. Ignore
    // its URL field: never fetch arbitrary URLs, paths or user artifact IDs.
    for (const file of task.artifacts) {
      if (typeof file.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,123}\.(?:md|txt)$/.test(file.name) || file.name.includes('..') || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 256_000 || total + file.bytes > 512_000) {
        artifacts.push({ name: 'unavailable', status: 'blocked', detail: 'Artifact metadata exceeds the bounded text profile.' }); continue;
      }
      total += file.bytes;
      try { artifacts.push({ name: file.name, bytes: file.bytes, status: 'available', content: await request('GET', '/tasks/' + id + '/artifacts/' + encodeURIComponent(file.name), undefined, signal, { business: true, textOnly: true, maxBytes: file.bytes, expectedBytes: file.bytes }) }); }
      catch { artifacts.push({ name: file.name, status: 'unavailable', detail: 'Original authenticated artifact could not be read; no document result is inferred.' }); }
    }
    return { profile: 'business-preset', identity: 'taskId', delegatedExecution: false, task, events, artifacts };
  }
  return Object.freeze({
    // Local transcript partition only; authentication remains the original
    // Bearer binding on every HTTP request. Never persist the token itself.
    bindingFingerprint: createHash('sha256').update(origin).update('\0').update(token).digest('hex'),
    check,
    submit: (input, signal) => request('POST', '', input, signal),
    status: (runId, signal) => request('GET', '/' + encodeURIComponent(identifier(runId)), undefined, signal),
    cancel: (runId, signal) => request('POST', '/' + encodeURIComponent(identifier(runId)) + '/cancel', {}, signal),
    resume: (runId, requestId = randomUUID(), signal) => request('POST', '/' + encodeURIComponent(identifier(runId)) + '/resume', { requestId: requestIdentifier(requestId) }, signal),
    decision: (runId, proposalId, decision, signal) => request('POST', '/' + encodeURIComponent(identifier(runId)) + '/decision', { proposalId: identifier(proposalId), decision, confirmed: true }, signal),
    continue: (runId, proposalId, requestId = randomUUID(), signal) => request('POST', '/' + encodeURIComponent(identifier(runId)) + '/continue', { proposalId: identifier(proposalId), requestId: requestIdentifier(requestId) }, signal),
    businessPresets,
    businessSubmit,
    businessStatus,
    businessResume: async (taskId, signal) => ({ profile: 'business-preset', identity: 'taskId', delegatedExecution: false,
      task: await request('POST', '/tasks/' + encodeURIComponent(identifier(taskId)) + '/resume', {}, signal, { business: true }) }),
  });
}

async function businessInput(input, presets) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['type', 'title', 'input', 'requestId'].includes(key)))
    throw new Error('Business JSON allows only type, title, input and a stable requestId.');
  requestIdentifier(input.requestId);
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300 || /[\x00-\x1f]/.test(input.title) || looksLikeCredential(input.title))
    throw new Error('Provide a bounded public business title without credentials.');
  const rows = Array.isArray(presets) ? presets : presets?.presets;
  const preset = rows?.find(row => row.id === input.type);
  if (!preset || !Array.isArray(preset.required_inputs) || !Array.isArray(preset.optional_inputs)) throw new Error('Select an original business preset from /ws-presets.');
  const allowed = new Set([...preset.required_inputs, ...preset.optional_inputs]);
  if (!input.input || typeof input.input !== 'object' || Array.isArray(input.input) || Object.keys(input.input).some(key => !allowed.has(key))
    || preset.required_inputs.some(key => !['string', 'number'].includes(typeof input.input[key]) || !String(input.input[key]).trim()))
    throw new Error('Use only the public input fields listed by this original preset; all required fields must be supplied.');
  const forbidden = /^(?:__proto__|prototype|constructor|agentPresetContext|piTaskContext|tools|model|budget|artifact(?:s|Ids?|_ids?)?|skill(?:s|Ids?|_ids?)?|memory(?:Ids?|_ids?)?|file(?:s|Path|_path|Ids?)?)$/i;
  function publicTree(value, depth = 0) {
    if (depth > 8 || typeof value === 'number' && !Number.isFinite(value) || typeof value === 'string' && (value.length > 65536 || looksLikeCredential(value))) throw new Error('Use bounded explicit public text without credentials.');
    if (value && typeof value === 'object') {
      if (Array.isArray(value) && value.length > 100) throw new Error('Public business lists are limited to 100 items.');
      for (const [key, item] of Object.entries(value)) { if (forbidden.test(key)) throw new Error('Business input cannot set files, models, tools, budget or host context.'); publicTree(item, depth + 1); }
    }
  }
  publicTree(input.input);
  if (Buffer.byteLength(JSON.stringify(input.input)) > 96_000) throw new Error('Public business input exceeds this profile limit.');
  return input;
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

export function workspaceExtension(client, { sample = false, agent = false, close = async () => {} } = {}) {
  return pi => {
    const activeTools = agent ? WORKSPACE_BUSINESS_TOOLS : WORKSPACE_TOOLS;
    let removeTerminalPolicy = () => {};
    const show = value => pi.sendMessage({ customType: 'workspace-receipt', content: JSON.stringify(value, null, 2), display: true }, { triggerTurn: false });
    pi.on('session_start', (_event, ctx) => {
      removeTerminalPolicy();
      removeTerminalPolicy = ctx.ui.onTerminalInput(data => {
        const reason = workspaceTerminalInputPolicy(data, ctx.ui.getEditorText());
        if (reason) { ctx.ui.notify(reason, 'warning'); return { consume: true }; }
      });
      pi.setActiveTools([...activeTools]);
      ctx.ui.setStatus('workspace', agent ? 'Workspace · development Agent · original business tasks' : sample ? 'Workspace · controlled faux sample' : 'Workspace · original task authority');
      ctx.ui.notify('Use /ws-task for generic runs; /ws-presets and /ws-business for original business tasks. /ws-status takes RUN_ID; /ws-business-status takes TASK_ID. Explicit public input only.', 'info');
    });
    pi.on('session_shutdown', async () => { removeTerminalPolicy(); await close(); });
    pi.on('user_bash', () => ({ result: { output: 'Shell execution is unavailable in the Workspace TUI profile.', exitCode: 1, cancelled: false, truncated: false } }));
    pi.on('tool_call', event => activeTools.includes(event.toolName) ? undefined : { block: true, reason: 'Only the admitted Workspace plugin tools are available.' });
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
      if (agent && looksLikeCredential(event.text)) {
        ctx.ui.notify('Do not paste credentials into the Agent conversation. No model call or task was sent.', 'warning');
        return { action: 'handled' };
      }
      if (!sample && !agent) {
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
    pi.registerTool({ name: 'workspace_business_presets', label: 'Workspace business presets', parameters: Type.Object({}, { additionalProperties: false }),
      description: 'List the existing authenticated business presets, required public inputs and document deliverables. This is capability discovery, not proof of connected research or task completion.',
      async execute(_id, _input, signal) { return result(await client.businessPresets(signal)); } });
    pi.registerTool({ name: 'workspace_business_task', label: 'Workspace business task', parameters: Type.Object({ type: Type.String(), title: Type.String({ minLength: 1, maxLength: 300 }),
      input: Type.Record(Type.String(), Type.Unknown()), requestId: Type.String({ minLength: 1, maxLength: 96, pattern: '^[A-Za-z0-9_-]+$' }) }, { additionalProperties: false }),
      description: 'Submit explicitly supplied public input to an original business preset under a stable requestId. The original coordinator, stages, Pi tools and approvals remain authoritative. It has no default subagent capability.',
      async execute(_id, input, signal) { return result(await client.businessSubmit(input, signal)); } });
    pi.registerTool({ name: 'workspace_business_status', label: 'Workspace business task results', parameters: Type.Object({ taskId: Type.String() }, { additionalProperties: false }),
      description: 'Read an original business taskId, stage events and authenticated text documents. It does not take a generic runId, arbitrary URL, file or artifact ID.',
      async execute(_id, input, signal) { return result(await client.businessStatus(input.taskId, signal)); } });
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
    command('ws-presets', 'List original business presets and public inputs', () => client.businessPresets());
    command('ws-procurement', 'Collect three public fields: /ws-procurement STABLE_REQUEST_ID', async (args, ctx) => {
      const requestId = requestIdentifier(args.trim());
      ctx.ui.notify('Public procurement input only: no private files, credentials or supplier claims. Escape cancels. Keep this requestId and identical fields when retrying an uncertain submission.', 'info');
      const input = {};
      for (const [field, label] of [['product', 'Public product'], ['spec', 'Public specification'], ['quantity', 'Public quantity (positive integer)']]) {
        const value = await ctx.ui.input(label);
        if (value === undefined) return { profile: 'business-preset', requestId, submitted: false, detail: 'Canceled. No business task was submitted.' };
        if (!value.trim() || value.length > 4000 || /[\x00-\x1f]/.test(value) || looksLikeCredential(value)) throw new Error('Use bounded explicit public fields without credentials. No business task was submitted.');
        input[field] = value.trim();
      }
      if (!/^[1-9][0-9]*$/.test(input.quantity) || !Number.isSafeInteger(Number(input.quantity))) throw new Error('Public quantity must be a positive safe integer. No business task was submitted.');
      input.quantity = Number(input.quantity);
      const draft = { type: 'procurement', title: `Procurement: ${input.product}`.slice(0, 300), input, requestId };
      show({ profile: 'business-preset', requestId, publicSubmission: draft, detail: 'For an uncertain result, retry the same requestId and identical fields. Admission is not completion.' });
      return client.businessSubmit(draft);
    });
    command('ws-business', 'Submit an original business task: /ws-business {"type":"procurement","title":"...","input":{...},"requestId":"stable-key"}', args => client.businessSubmit(parseInput(args)));
    command('ws-business-status', 'Read original business stages and documents: /ws-business-status TASK_ID', args => client.businessStatus(args.trim()));
    command('ws-business-resume', 'Explicitly resume the unchanged original business task: /ws-business-resume TASK_ID', async (args, ctx) => {
      const taskId = identifier(args.trim());
      const receipt = await client.businessStatus(taskId);
      if (!receipt.task.result?.resumable || !['failed', 'interrupted'].includes(receipt.task.status)) throw new Error('The original business task has no eligible explicit recovery checkpoint. No continuation was sent.');
      if (!await ctx.ui.confirm('Resume this unchanged original business task?', JSON.stringify({ taskId, type: receipt.task.type, status: receipt.task.status, result: receipt.task.result }, null, 2)))
        return { profile: 'business-preset', taskId, resumed: false, detail: 'No continuation was sent.' };
      return client.businessResume(taskId);
    });
    command('ws-quit', 'Close the official Pi TUI and its sample backend', async (_args, ctx) => { await close(); ctx.shutdown(); });
  };
}
