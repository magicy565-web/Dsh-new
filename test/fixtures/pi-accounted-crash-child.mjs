// Kill after original Workspace accounting is durably committed but before the
// pending reply is acknowledged. Both real Pi execution and Store commits run.
import { randomUUID } from 'node:crypto';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createPiProvider } from '../../server/pi-provider.mjs';
import { createApp } from '../../server/index.mjs';
import { getPreset } from '../../server/agent/presets.mjs';
import { buildAgentPresetContext } from '../../server/agent/pi-preset.mjs';

const [directory, mode] = process.argv.slice(2);
const unknown = mode.endsWith('-unknown'), kind = mode.startsWith('goal') ? 'goal' : 'chat';
const faux = fauxProvider(unknown ? { api: 'faux-unknown-wire' } : {}), models = createModels(); models.setProvider(faux.provider);
const provider = createPiProvider({ models, providerId: 'faux', model: 'faux-1' });
const app = await createApp({ dataDirectory: directory, provider });
const update = app.store.update.bind(app.store);
let paused = false;
app.store.update = async (...args) => {
  const result = await update(...args);
  if (!paused) {
    const state = app.store.read();
    const reply = state.messages.find(message => message.status === 'pending' && message.providerResultAccounted !== undefined);
    if (reply) {
      paused = true;
      const run = state.runs.find(value => value.id === reply.runId), goal = state.goals.find(value => value.id === run.goalId);
      process.stdout.write(JSON.stringify({ runId: run.id, replyId: reply.id, nativeTaskId: reply.providerResultAccounted, goalId: goal?.id,
        conversationId: run.conversationId, requestId: run.piRequestId, usage: run.usage, stepCount: goal?.stepCount ?? run.stepCount,
        outputTokens: goal?.outputTokens ?? run.outputTokens, reservedOutputTokens: reply.reservedOutputTokens }) + '\n');
      return new Promise(() => {});
    }
  }
  return result;
};
if (kind === 'goal') {
  faux.setResponses([fauxAssistantMessage(JSON.stringify({ done: false, content: 'Accounted Goal document ready for review', nextStep: 'No second invocation' }))]);
  const goal = (await app.runtime.createGoal({ title: 'Original one-step Goal', maxSteps: 1, maxOutputTokens: 1600 })).goal;
  await app.runtime.updateGoal(goal.id, { action: 'start' });
} else {
  const actor = { subject: 'local-operator', workspaceId: 'local', role: 'admin' };
  const conversation = (await app.runtime.createConversation({ title: 'Original one-stage document' }, actor)).conversation;
  const preset = getPreset('procurement');
  const task = { id: randomUUID(), subject: actor.subject, workspaceId: actor.workspaceId, conversationId: conversation.id, preset, type: 'procurement', title: 'Original one-stage document',
    input: { product: 'Original cup', spec: '500ml', quantity: 100, market: 'US' }, steps: preset.stages.map(stage => ({ key: stage.key, title: stage.title, requestId: randomUUID(), runId: null, replyId: null, status: 'pending', output: null, error: null })),
    status: 'running', result: null, createdAt: new Date().toISOString(), finishedAt: null };
  await app.store.update(state => { (state.workspaceAgentTasks ||= { version: 1, tasks: [] }).tasks.push(task); });
  const context = buildAgentPresetContext({ state: app.store.read(), taskId: task.id, stageKey: task.steps[0].key, requestId: task.steps[0].requestId,
    actor, budget: { maxSteps: 1, maxOutputTokens: 1600 } });
  faux.setResponses([fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', { analysis: [{ text: 'Original selected product is supplied.', sources: ['input.product'] }], recommendations: [], questions: [] }), { stopReason: 'toolUse' })]);
  await app.runtime.sendMessage(task.conversationId, { content: 'Return the admitted original document stage', requestId: context.requestId, workspaceExecution: true }, { agentPresetContext: context });
}
setInterval(() => {}, 1000);
