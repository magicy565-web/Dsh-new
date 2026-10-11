import { pluginFields, pluginFail } from './workspace-plugin-config.mjs';
import { createHash } from 'node:crypto';
import { looksLikeCredential } from './security.mjs';

const blockCode = requestId => `workspace-dot-${requestId}`;
const receiptId = taskRef => `workspace-dot-result-${taskRef}`;

/** Use the Host's original live Agent, Goal and durable Session services.
 * No provider/model request, dot replacement or new Harness runtime is created.
 * authorizePublicTask is trusted Host policy tied to the original user's input.
 */
export function createNativeDotBinding({ ctx, service, actor, authorizePublicTask }) {
  if (!ctx?.agents || !ctx.goals || !ctx.sessions || typeof authorizePublicTask !== 'function') {
    pluginFail('WORKSPACE_DOT_NATIVE_REQUIRED', 'Native dot dispatch needs the existing Agents, Goals, Sessions and a reviewed public-task admission policy.');
  }
  const tasks = service.bindDotTasks(actor);
  const bindingEpoch = service.status().epoch;
  function requireActiveAdmission() {
    const current = service.status();
    if (current.epoch !== bindingEpoch) pluginFail('WORKSPACE_PLUGIN_STALE', 'Refresh the original native binding after an authorization review.');
    if (current.phase !== 'active') pluginFail('WORKSPACE_PLUGIN_PAUSED', 'Restore the original connection before admitting another question.');
  }
  const originalAgent = ctx.agents.get(actor.nativeAgentId);
  if (!originalAgent) pluginFail('WORKSPACE_NATIVE_AGENT_MISSING', 'The original Workspace Agent must be live.');
  function live() {
    if (ctx.agents.get(actor.nativeAgentId) !== originalAgent) pluginFail('WORKSPACE_DOT_AGENT_CHANGED', 'The original Session changed; preserve its existing delegation.');
    return originalAgent;
  }
  function waiting(request) {
    const agent = live(), goal = ctx.goals.get(agent);
    if (!goal || goal.id !== request.goalId || goal.revision !== request.goalRevision + 1
      || goal.phase !== 'blocked' || goal.blockedReason?.code !== blockCode(request.requestId)) {
      pluginFail('WORKSPACE_DOT_GOAL_CHANGED', 'The original Goal no longer authorizes this exact cloud task.');
    }
    return { agent, goal };
  }
  async function flush(agent) {
    if (!await ctx.sessions.flush(agent.session)) pluginFail('WORKSPACE_DOT_PERSISTENCE', 'The original Session was not durably saved.');
    live();
  }
  async function delegate() {
    requireActiveAdmission();
    const agent = live(), goal = ctx.goals.get(agent);
    if (!goal) pluginFail('WORKSPACE_DOT_GOAL_REQUIRED', 'Create the original user Goal before delegating to xy.');
    const requestId = `goal-${goal.id}`;
    const previous = (await tasks.view()).find(r => r.requestId === requestId);
    if (previous) {
      waiting(previous); await flush(agent); await tasks.ready(requestId);
      return previous;
    }
    if (goal.phase !== 'active') pluginFail('WORKSPACE_DOT_GOAL_REQUIRED', 'The original Goal must be active before the first delegation.');
    // The model cannot set confirmed=true or choose owner, Session or Goal.
    if (await authorizePublicTask({ agent, goal: structuredClone(goal) }) !== true) {
      pluginFail('WORKSPACE_DOT_PUBLIC_TASK_REQUIRED', 'The exact user question has not been admitted as public cloud-worker input.');
    }
    live();
    requireActiveAdmission();
    const current = ctx.goals.get(agent);
    if (current?.id !== goal.id || current.revision !== goal.revision || current.objective !== goal.objective || current.phase !== 'active') {
      pluginFail('WORKSPACE_DOT_GOAL_CHANGED', 'The original question changed during admission.');
    }
    const request = await tasks.submit({ requestId, goalId: goal.id, goalRevision: goal.revision,
      prompt: goal.objective, confirmed: true, dataScope: 'public-only' });
    ctx.goals.block(agent, goal, { code: blockCode(requestId), message: 'Waiting for the original xy cloud Worker result.' });
    await flush(agent);
    await tasks.ready(requestId);
    return request;
  }
  async function submitQuestion(body) {
    pluginFields(body, ['requestId', 'content', 'confirmed', 'dataScope']);
    if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_.:@/-]{1,128}$/.test(body.requestId)
      || body.confirmed !== true || body.dataScope !== 'public-only' || typeof body.content !== 'string' || !body.content.trim()
      || Buffer.byteLength(body.content) > 16000 || looksLikeCredential(body.content)
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(body.content) || Buffer.from(body.content).toString() !== body.content) {
      pluginFail('WORKSPACE_DOT_PUBLIC_TASK_REQUIRED', 'Confirm a bounded public question before sending it to xy.');
    }
    const agent = live(), id = `xy-input-${createHash('sha256').update(JSON.stringify([agent.id, body.requestId])).digest('hex')}`;
    const text = JSON.stringify({ requestId: body.requestId, content: body.content, confirmed: true, dataScope: 'public-only' });
    const events = agent.session.ownEvents();
    const index = events.findIndex(e => e.type === 'agent/inbox/spliced' && e.data.inserted.some(m => m.id === id));
    if (index >= 0) {
      const saved = events[index].data.inserted.find(m => m.id === id);
      const created = events.slice(index + 1).find(e => e.type === 'goal/change' && e.data.operation === 'create');
      if (saved.content[0]?.text !== text || !created || created.data.goal.objective !== body.content) pluginFail('WORKSPACE_DOT_CONFLICT', 'Preserve the original question and Goal for this requestId.');
      const previous = (await tasks.view()).find(r => r.goalId === created.data.goal.id);
      if (previous?.ready) return previous;
      if (ctx.goals.get(agent)?.id !== created.data.goal.id) pluginFail('WORKSPACE_DOT_GOAL_CHANGED', 'The original question cannot create a replacement Goal.');
      requireActiveAdmission(); await flush(agent); return delegate();
    }
    requireActiveAdmission();
    const current = ctx.goals.get(agent);
    if (current && current.phase !== 'complete') pluginFail('WORKSPACE_DOT_TASK_UNFINISHED', 'Finish or accept the current cloud task before starting another question in this Session.');
    // Inbox admission and Goal creation are synchronous on the original
    // Session. Their durable event order is the retry identity, not a new DB.
    agent.send({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }, 'next-step', false);
    ctx.goals.create(agent, { objective: body.content, maxGoalRounds: 1 });
    await flush(agent); return delegate();
  }
  async function acceptResult(body) {
    pluginFields(body, ['requestId', 'receiptHash', 'confirmed']);
    if (body.confirmed !== true) pluginFail('WORKSPACE_DOT_ACCEPTANCE_REQUIRED', 'Review the exact original result before accepting it.');
    const request = (await tasks.view()).find(r => r.requestId === body.requestId);
    if (!request?.returnedHash || request.receiptHash !== body.receiptHash || request.receipt?.state !== 'succeeded') {
      pluginFail('WORKSPACE_DOT_RECEIPT_CHANGED', 'Accept only your own durably returned successful receipt.');
    }
    const agent = live(), goal = ctx.goals.get(agent);
    if (goal?.id !== request.goalId || !(goal.phase === 'blocked' && goal.revision === request.goalRevision + 1
      && goal.blockedReason?.code === blockCode(request.requestId) || goal.phase === 'complete' && goal.revision === request.goalRevision + 2)) {
      pluginFail('WORKSPACE_DOT_GOAL_CHANGED', 'The original Goal changed before acceptance.');
    }
    if (goal.phase !== 'complete') ctx.goals.complete(agent, goal);
    await flush(agent);
    await tasks.accept(request.requestId, body.receiptHash);
    return tasks.view();
  }
  async function cancelTask(body) {
    pluginFields(body, ['requestId', 'confirmed']);
    if (body.confirmed !== true) pluginFail('WORKSPACE_DOT_CANCEL_CONFIRMATION', 'Confirm cancellation of this exact original task.');
    const request = (await tasks.view()).find(r => r.requestId === body.requestId);
    if (!request) pluginFail('WORKSPACE_DOT_NOT_FOUND', 'This native Session does not own that task.');
    waiting(request); await tasks.cancel(request.requestId); return tasks.view();
  }
  async function closeResult(body) {
    pluginFields(body, ['requestId', 'receiptHash', 'confirmed']);
    const request = (await tasks.view()).find(r => r.requestId === body.requestId);
    if (body.confirmed !== true || !request?.returnedHash || request.receiptHash !== body.receiptHash
      || !['failed', 'cancelled', 'expired'].includes(request.receipt?.state)) pluginFail('WORKSPACE_DOT_RECEIPT_CHANGED', 'Review the exact unsuccessful original task before closing it.');
    const agent = live();
    const cleared = agent.session.ownEvents().some(e => e.type === 'goal/change' && e.data.operation === 'clear'
      && e.data.cleared.id === request.goalId && e.data.cleared.revision === request.goalRevision + 2);
    if (!cleared) { const { goal } = waiting(request); ctx.goals.clear(agent, goal); }
    await flush(agent); await tasks.close(request.requestId, body.receiptHash); return tasks.view();
  }
  async function reconcile() {
    live();
    await tasks.dispatchNext(async request => { const { agent } = waiting(request); await flush(agent); waiting(request); });
    for (const request of await tasks.view()) {
      if (!request.receipt || request.returnedHash) continue;
      const { agent } = waiting(request), id = receiptId(request.receipt.taskRef);
      // Hash-check saved files before publishing their exact version references.
      for (const file of request.receipt.files) await tasks.download({ artifactId: file.id, version: file.version, sha256: file.sha256 });
      const text = JSON.stringify(request.receipt);
      const receipts = agent.session.ownEvents().flatMap(e => e.type === 'agent/inbox/spliced' ? e.data.inserted : []).filter(m => m.id === id);
      if (receipts.length > 1 || receipts.length === 1 && receipts[0].content[0]?.text !== text) pluginFail('WORKSPACE_DOT_RECEIPT_CHANGED', 'The native Session already contains a different receipt for this original task.');
      if (!receipts.length) {
        waiting(request);
        agent.send({ id, role: 'user', source: { kind: 'workspace-dot', form: 'notice', summary: 'xy cloud Worker result' },
          content: [{ type: 'text', text }] }, 'next-step', false);
      }
      await flush(agent);
      await tasks.acknowledge(request.requestId, request.receiptHash);
      // Harness decides acceptance and continuation. Delivery does not complete
      // its Goal or claim independent verification of dot's tool receipts.
    }
    return tasks.view();
  }
  const tools = [
    { name: 'workspace_dot_delegate', description: 'Delegate the original admitted public user Goal to the existing xy cloud Worker. Owner and Session are bound by the Host.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: args => { pluginFields(args, []); return delegate(); } },
    { name: 'workspace_dot_tasks', description: 'Read your own cloud task progress and receive original xy results in this native Session.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: args => { pluginFields(args, []); return reconcile(); } },
    { name: 'workspace_dot_read_file', description: 'Read an exact returned file belonging to this original native Session.',
      parameters: { type: 'object', additionalProperties: false, required: ['artifactId', 'version', 'sha256'],
        properties: { artifactId: { type: 'string' }, version: { type: 'integer' }, sha256: { type: 'string' } } },
      async execute(args) {
        live(); const file = await tasks.download(args); live();
        return { filename: file.filename, mimeType: file.mimeType, version: file.version,
          sha256: file.sha256, encoding: 'base64', content: file.bytes.toString('base64') };
      } },
  ];
  return Object.freeze({ delegate, submitQuestion, acceptResult, cancelTask, closeResult, reconcile, tools: Object.freeze(tools) });
}
