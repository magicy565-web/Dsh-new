// Harness plugin: execute prepared chat runs against the model seam.
//
// The runner is the only component allowed to move a run forward. It subscribes
// to prepared runs, assembles the conversation history plus the workspace's
// confirmed business memory, calls ctx.llm, writes the answer back and records
// usage. It never exposes an HTTP route: a user may cancel a run, but only this
// service may claim one completed.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { createRunner } from './runner.mjs';

export const PLUGIN_ID = 'workspace-runner';
const CONFIG_KEYS = ['workspaceId', 'enabled', 'model', 'systemPrompt', 'timeoutMs', 'maxQueue', 'memory', 'deltaBatchChars', 'deltaBatchMs'];

const manifestError = message => new HarnessError(ERROR.manifestInvalid, message);

export async function apply(ctx, config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config))
    throw manifestError(`${PLUGIN_ID} config must be an object.`);
  if (Object.keys(config).some(key => !CONFIG_KEYS.includes(key)))
    throw manifestError(`${PLUGIN_ID} config has an unsupported field.`);
  if (config.workspaceId !== undefined && (typeof config.workspaceId !== 'string' || !config.workspaceId))
    throw manifestError('config.workspaceId must be a non-empty string.');
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean')
    throw manifestError('config.enabled must be a boolean.');
  if (config.model !== undefined && (typeof config.model !== 'string' || !config.model.trim()))
    throw manifestError('config.model must be non-empty text.');
  if (config.systemPrompt !== undefined && (typeof config.systemPrompt !== 'string' || !config.systemPrompt.trim()))
    throw manifestError('config.systemPrompt must be non-empty text.');
  if (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 600_000))
    throw manifestError('config.timeoutMs must be an integer between 1000 and 600000.');
  if (config.maxQueue !== undefined && (!Number.isInteger(config.maxQueue) || config.maxQueue < 1 || config.maxQueue > 1_000))
    throw manifestError('config.maxQueue must be an integer between 1 and 1000.');
  if (config.memory !== undefined && typeof config.memory !== 'boolean')
    throw manifestError('config.memory must be a boolean.');
  if (config.deltaBatchChars !== undefined && (!Number.isInteger(config.deltaBatchChars) || config.deltaBatchChars < 1 || config.deltaBatchChars > 8_000))
    throw manifestError('config.deltaBatchChars must be an integer between 1 and 8000.');
  if (config.deltaBatchMs !== undefined && (!Number.isInteger(config.deltaBatchMs) || config.deltaBatchMs < 0 || config.deltaBatchMs > 5_000))
    throw manifestError('config.deltaBatchMs must be an integer between 0 and 5000.');

  const workspaceId = config.workspaceId ?? 'local';
  const chat = ctx.chat;
  const llm = ctx.llm;
  // Optional by design: a composition without business memory still chats, and
  // the run records that memory was unavailable rather than inventing facts.
  const memory = config.memory === false ? null : (ctx.get?.('businessMemory', false) ?? null);

  if (config.enabled === false) {
    if (ctx.health?.register) ctx.health.register('runner', () => ({ status: 'ok', detail: { enabled: false } }));
    return async () => {};
  }

  const runner = createRunner({
    chat, llm, memory, workspaceId,
    model: config.model ?? null,
    systemPrompt: config.systemPrompt,
    timeoutMs: config.timeoutMs ?? 120_000,
    maxQueue: config.maxQueue ?? 100,
    deltaBatchChars: config.deltaBatchChars ?? 160,
    deltaBatchMs: config.deltaBatchMs ?? 120,
  });

  const unsubscribe = chat.onPrepared(({ runId }) => { runner.enqueue(runId); });
  if (ctx.health?.register) {
    ctx.health.register('runner', () => ({ status: 'ok', detail: { ...runner.stats(), memory: Boolean(memory) } }));
  }
  let disposeService = null;
  if (typeof ctx.provide === 'function') disposeService = ctx.provide('runner', runner);

  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    if (typeof disposeService === 'function') await disposeService();
    await runner.stop();
  };
}

export default { apply };
