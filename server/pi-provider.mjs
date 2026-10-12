import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { Agent } from '@earendil-works/pi-agent-core';
import { Type, createModels, createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context';
import { AssistantEntry, Harness, GenerationTask, ToolTask, createRegistry, defineDoc, defineExtension, defineTool, hook } from '@earendil-works/pi-durable';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import { ProviderError } from './provider.mjs';
import { capabilityPayloadHash } from './capabilities.mjs';
import { assertInputContextSnapshot } from './task-context.mjs';

export const PI_SOURCE = 'abe508e1b89912adde45528136c3221eb69acdd7';
export const PI_VERSION = '1.1.0';
const context = BACKGROUND_CONTEXT;
const hash = value => createHash('sha256').update(value).digest('hex');
const RecordDoc = defineDoc({ kind: 'workspace.pi-invocations', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ records: {}, active: null }) });
const POLICY = { version: 1, tools: ['workspace_input', 'workspace_propose_action'], externalExecution: 'original-workspace-approval', replay: 'safe-only', storage: 'jsonl-fsync' };
const fail = (code, message) => { throw new ProviderError(code, message); };
const clone = value => JSON.parse(JSON.stringify(value));

// Pi does not provide a process lock. This service may only open storage while
// the original Workspace Store holds the exclusive writer lease.
async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.mode & 0o077)) fail('PI_STORAGE_UNSAFE', 'Pi storage requires a private regular directory.');
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isSymbolicLink()) fail('PI_STORAGE_UNSAFE', 'Pi storage cannot contain symbolic links.');
    if (item.isDirectory()) await privateDirectory(filename);
    else if (!item.isFile()) fail('PI_STORAGE_UNSAFE', 'Pi storage contains an unsupported entry.');
    else if (process.platform !== 'win32') await fs.chmod(filename, 0o600);
  }
}

export function createPiProvider({ apiKey = '', model = 'gpt-6-sol', models: suppliedModels, providerId = 'workspace-fastaitoken', timeoutMs = 60_000 } = {}) {
  if (!/^[a-zA-Z0-9_.:/-]{1,160}$/.test(model)) throw new TypeError('Pi model must be a bounded server-configured model ID.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000) throw new TypeError('Invalid Pi timeout.');
  const models = suppliedModels || createModels();
  if (!suppliedModels) models.setProvider(createProvider({ id: providerId, name: 'Workspace reviewed FastAIToken', baseUrl: 'https://www.fastaitoken.com/v1',
    auth: { apiKey: { name: 'Host-managed FastAIToken key', resolve: async () => apiKey.trim() ? { auth: { apiKey } } : undefined } },
    models: [{ id: model, name: model, api: 'openai-completions', provider: providerId, baseUrl: 'https://www.fastaitoken.com/v1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1600 }],
    api: openAICompletionsApi() }));
  const modelRef = models.getModel(providerId, model);
  const opened = new Map(), opening = new Map(), activeCalls = new Map();
  let store, directory, closing = false, closePromise;
  function assertActive(active) {
    if (closing || !active) fail('PI_NOT_ADMITTED', 'No active Workspace invocation authorizes this Pi operation.');
    const state = store.read(), run = state.runs.find(value => value.id === active.runId);
    if (!run || run.status !== 'running' || run.conversationId !== active.conversationId || run.executionHash !== active.executionHash || run.assistantId !== active.replyId)
      fail('PI_NOT_ADMITTED', 'The original Workspace run is stopped or its execution scope changed.');
    assertInputContextSnapshot(state, active.conversationId, run.inputContextSnapshot);
    return run;
  }
  async function openConversation(conversationId) {
    if (opened.has(conversationId)) return opened.get(conversationId);
    if (opening.has(conversationId)) return opening.get(conversationId);
    const operation = (async () => {
      const location = path.join(directory, hash(conversationId));
      await privateDirectory(location);
      const storage = await openNodeJsonlStorage(location, context, { fsync: true });
      let harness;
      const state = { harness: null, root: null, active: null, location };
      const registry = createRegistry();
      const input = defineTool({ name: 'workspace_input', description: 'Read only an explicitly selected, verified input snapshot. No filesystem paths or ambient enterprise data.',
        parameters: Type.Object({ kind: Type.Union([Type.Literal('artifact'), Type.Literal('memory'), Type.Literal('skill')]), id: Type.String({ maxLength: 160 }) }), replay: 'safe',
        execute: async args => {
          const run = assertActive(state.active);
          const rows = state.active.snapshot?.[args.kind === 'artifact' ? 'artifacts' : args.kind === 'memory' ? 'memories' : 'skills'] || [];
          const item = rows.find(value => value.id === args.id);
          if (!item || !run.inputContextSnapshot) fail('PI_TOOL_PERMISSION', 'This input was not selected for the admitted run.');
          return { content: [{ type: 'text', text: JSON.stringify(item) }] };
        } });
      const propose = defineTool({ name: 'workspace_propose_action', description: 'Propose one selected connector action for exact human approval. This tool cannot execute, approve, wake Muse or send a message.',
        parameters: Type.Object({ content: Type.String({ minLength: 1, maxLength: 2000 }), connectorId: Type.String({ maxLength: 128 }), action: Type.String({ maxLength: 128 }), resource: Type.String({ maxLength: 2000 }), payload: Type.Record(Type.String(), Type.Unknown()) }), replay: 'safe', executionMode: 'sequential',
        execute: async (args, api, callContext) => {
          const run = assertActive(state.active);
          if (!state.active.structured || !run.connectorGrants?.some(grant => grant.connectorId === args.connectorId && grant.action === args.action)) fail('PI_TOOL_PERMISSION', 'This connector action was not selected for this run.');
          const proposal = { done: false, content: args.content, action: { connectorId: args.connectorId, action: args.action, resource: args.resource, payload: args.payload } };
          await api.commit(async tx => {
            const doc = await tx.doc(RecordDoc, api.conversationId);
            if (doc.active.proposal && capabilityPayloadHash(doc.active.proposal) !== capabilityPayloadHash(proposal)) fail('PI_TOOL_PERMISSION', 'Only one exact proposal may be returned per invocation.');
            doc.active.proposal = proposal;
          }, callContext);
          return { content: [{ type: 'text', text: 'Proposal recorded for original Workspace approval; no action executed.' }], control: { terminate: true } };
        } });
      const extension = defineExtension({ name: 'workspace-governed', tools: [input, propose], hooks: [
        hook(GenerationTask, { beforeRequest: async (request, api, callContext) => {
          assertActive(state.active);
          const doc = await api.snapshot(RecordDoc, api.conversationId, callContext);
          const tail = request.messages.filter(message => message.role !== 'system').slice(1);
          const answers = tail.filter(message => message.role === 'assistant');
          const used = answers.reduce((sum, message) => sum + (message.usage?.output || 0), 0);
          if (answers.length >= 4 || used >= doc.active.maxTokens) fail('TOKEN_BUDGET', 'Pi reached the admitted turn/output allowance.');
          state.active.remainingTokens = doc.active.maxTokens - used;
          return { messages: [request.messages[0], ...doc.active.messages, ...tail].filter(Boolean) };
        } }),
        hook(ToolTask, { beforeTool: call => {
          assertActive(state.active);
          if (!['workspace_input', 'workspace_propose_action'].includes(call.name)) return { block: 'Only selected Workspace input and action-proposal tools are permitted.' };
        } }),
      ] });
      registry.install(extension);
      state.extension = extension; state.input = input; state.propose = propose;
      try {
        harness = await Harness.open(storage, { models, registry, settings: { retry: { enabled: false, maxRetries: 0 }, compaction: { enabled: false }, toolExecution: 'sequential',
          get stream() { return { maxTokens: Math.min(1600, state.active?.remainingTokens || state.active?.maxTokens || 1600), timeoutMs }; } } }, context);
        state.harness = harness; state.root = await harness.root(context);
        // No resume here: reopen is a read. Only an admitted complete() may start work.
        opened.set(conversationId, state);
        return state;
      } catch (error) { await (harness ? harness.close(context) : storage.close(context)); throw error; }
    })();
    opening.set(conversationId, operation);
    try { return await operation; } finally { opening.delete(conversationId); }
  }
  return {
    kind: 'pi-durable', provider: 'pi', configured: Boolean(suppliedModels ? modelRef : apiKey.trim()), model, models: [model],
    permissionFingerprint: capabilityPayloadHash({ ...POLICY, providerId, model, source: PI_SOURCE }),
    capabilities: ['pi-agent-context', 'pi-durable-execution', 'durable-request-dedupe', 'explicit-interruption-recovery', 'explicit-durable-abort', 'selected-replay-safe-tools'],
    setupMessage: 'Configure the existing host-managed FASTAITOKEN_API_KEY and PI_MODEL for Pi. Credentials remain on the server. Your work is saved.',
    limitations: ['Pi 1.1.0 is pinned; model endpoint/account access remains unverified.', 'Only selected input snapshots and exact action proposals are available to Pi. Workspace executes approved actions.', 'Reopen does not resume work automatically. User cancellation explicitly aborts durable work; shutdown preserves checkpoints.', 'Muse and Dot remain independent original connectors. A receipt or write submission is not wake/execution evidence.'],
    containsCredential: value => Boolean(apiKey && typeof value === 'string' && value.includes(apiKey)),
    async initialize({ store: originalStore }) {
      if (store || closing || !originalStore?.directory) throw new Error('Pi requires one original locked Workspace Store lifetime.');
      store = originalStore; directory = path.join(store.directory, 'pi'); await privateDirectory(directory);
    },
    async complete({ messages, model: requestedModel, maxTokens = 1600, signal, json = false, runId, conversationId, replyId, onEvent }) {
      if (!store || closing) fail('PI_NOT_ADMITTED', 'Pi is not attached to an open Workspace Store.');
      if (!this.configured) fail('SETUP_REQUIRED', this.setupMessage);
      if (requestedModel !== model || !modelRef) fail('INVALID_MODEL', 'Select the server-pinned Pi model.');
      if (typeof replyId !== 'string' || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1600) fail('PI_NOT_ADMITTED', 'Pi requires an admitted reply and bounded output budget.');
      if (activeCalls.has(conversationId)) fail('RUNTIME_BUSY', 'This Pi conversation already has admitted work.');
      const state = await openConversation(conversationId);
      if (activeCalls.has(conversationId)) fail('RUNTIME_BUSY', 'This Pi conversation already has admitted work.');
      const requestId = `${runId}:${replyId}`;
      const run = store.read().runs.find(value => value.id === runId);
      const scope = { runId, replyId, conversationId, executionHash: run?.executionHash, maxTokens, structured: json, snapshot: run?.inputContextSnapshot || null };
      assertActive(scope);
      const document = await state.harness.snapshot(RecordDoc, state.root.id, context);
      const previous = document?.records[requestId];
      const reattaching = Boolean(previous || document?.active?.requestId === requestId);
      let abortPromise;
      const localStop = new AbortController();
      const operation = { stop: () => localStop.abort('SHUTDOWN') };
      activeCalls.set(conversationId, operation);
      const cancelled = () => {
        // Cancelling wait alone leaves durable work running. User cancellation
        // aborts the actual conversation; shutdown closes without aborting it.
        const status = store.read().runs.find(value => value.id === runId)?.status;
        if (status !== 'interrupted' && !closing) abortPromise ||= state.root.abort(context);
        localStop.abort('STOPPED');
      };
      signal?.addEventListener('abort', cancelled, { once: true });
      try {
        if (reattaching) {
          if (document.active.requestId !== requestId || document.active.executionHash !== scope.executionHash) fail('EXECUTION_SCOPE_CHANGED', 'The persisted Pi invocation belongs to another execution scope.');
          state.active = clone(document.active);
        } else {
          // Stop an abandoned prior invocation before resetting its model context.
          if (document?.active) await state.root.abort(context);
          await state.root.reset(undefined, context);
          const systemPrompt = messages.filter(value => value.role === 'system').map(value => value.content).join('\n');
          const canonical = messages.filter(value => value.role !== 'system').map(value => value.role === 'assistant'
            ? { role: 'assistant', content: [{ type: 'text', text: value.content }], api: modelRef.api, provider: providerId, model, stopReason: 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
            : { role: 'user', content: value.content, timestamp: Date.now() });
          // Use the real Pi Agent state API for canonical context. pi-durable
          // owns execution and tools; no second Agent loop/scheduler is started.
          const agent = new Agent({ initialState: { model: modelRef, systemPrompt, messages: canonical }, streamFn: models.streamSimple.bind(models) });
          state.active = { ...scope, requestId, messages: clone(agent.state.messages.filter(value => value.role !== 'system')) };
          await state.root.configure({ model: { provider: providerId, modelId: model }, instructions: systemPrompt,
            tools: json ? [state.input, state.propose] : [state.input], extensions: [state.extension] }, context);
          await state.root.commit(async tx => { (await tx.doc(RecordDoc, state.root.id)).active = state.active; }, context);
        }
        if (signal?.aborted) cancelled();
        if (localStop.signal.aborted) fail('CANCELLED', 'The request was stopped.');
        const submission = previous ? await state.harness.submission(previous.submissionId, context)
          : await state.root.submit({ type: 'input', content: 'Continue the admitted Workspace request using only its selected inputs and permissions.', requestId, whenBusy: 'reject' }, context);
        if (!submission) fail('PI_CHECKPOINT_MISSING', 'The persisted Pi submission could not be found.');
        if (!previous) await state.root.commit(async tx => { (await tx.doc(RecordDoc, state.root.id)).records[requestId] = { submissionId: submission.id }; }, context);
        await onEvent?.({ type: 'pi.submission', piConversationId: state.root.id, piSubmissionId: submission.id, piRequestId: requestId });
        const settled = await submission.wait(withAbortSignal(localStop.signal, context));
        await abortPromise;
        if (localStop.signal.aborted || signal?.aborted) fail('CANCELLED', 'The request was stopped.');
        assertActive(state.active);
        const finalDoc = await state.harness.snapshot(RecordDoc, state.root.id, context);
        const entry = settled.answer ? await state.root.commit(tx => tx.entry(AssistantEntry, settled.answer), context) : null;
        const answer = entry?.model?.[0];
        const content = finalDoc.active.proposal ? JSON.stringify(finalDoc.active.proposal) : answer?.content?.filter(value => value.type === 'text').map(value => value.text).join('');
        if (settled.status !== 'done' && !finalDoc.active.proposal) fail('PI_UNANSWERED', `Pi did not complete this submission (${settled.reason || 'unanswered'}). Saved checkpoints remain available.`);
        if (answer?.stopReason === 'length') fail('OUTPUT_LIMIT', 'Pi reached the output limit. Review saved work before retrying.');
        if (!content?.trim() || content.length > 80000 || apiKey && content.includes(apiKey)) fail('INVALID_RESPONSE', 'Pi returned an invalid visible answer.');
        // Invocation usage is computed from the reset-bounded active transcript.
        const view = await state.root.context(context);
        const totals = view.messages.filter(value => value.role === 'assistant').reduce((sum, value) => ({ promptTokens: sum.promptTokens + (value.usage?.input || 0), completionTokens: sum.completionTokens + (value.usage?.output || 0), totalTokens: sum.totalTokens + (value.usage?.totalTokens || 0) }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        return { content, usage: totals, runtime: { kind: 'pi-durable', version: PI_VERSION, source: PI_SOURCE, submissionId: submission.id, replayed: reattaching } };
      } catch (error) {
        await abortPromise?.catch(() => {});
        if (localStop.signal.aborted || signal?.aborted) fail('CANCELLED', 'The request was stopped.');
        if (error instanceof ProviderError || error?.code) throw error;
        const failure = new ProviderError('PI_RUNTIME_ERROR', 'Pi could not complete this invocation. Inspect saved local diagnostics; no unreviewed action was executed.'); failure.cause = error; throw failure;
      } finally { signal?.removeEventListener('abort', cancelled); activeCalls.delete(conversationId); state.active = null; }
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const value of activeCalls.values()) value.stop();
      closePromise = (async () => {
        await Promise.allSettled([...opening.values()]);
        for (const state of opened.values()) { await state.harness.close(context); await privateDirectory(state.location); }
        opened.clear();
      })();
      return closePromise;
    },
  };
}
