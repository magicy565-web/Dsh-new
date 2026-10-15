import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { lazyStream } from '@earendil-works/pi-ai/api/lazy';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createWorkspaceAgentRuntime } from '../scripts/pi-workspace-agent.mjs';
import { WORKSPACE_AGENT_TOOLS } from '../pi/extensions/workspace.mjs';
import { libraryReadHash, normalizeLibraryRecipient, libraryRecipientForModel } from './library-model-read-contract.mjs';
import { emptyInputContext, normalizeInputContext } from './task-context.mjs';
import { looksLikeCredential } from './security.mjs';
import { createWorkspaceFactoryMaterialsClient } from '../packages/workspace-procurement/src/workspace-factory-materials-client.mjs';
import { ApiError } from './runtime.mjs';
import { ProviderError } from './provider.mjs';
import { privateDirectory, openPrivateFile, syncDirectory } from './store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const ownerMatches = (owner, actor) => owner?.subject === actor?.subject && owner?.workspaceId === actor?.workspaceId;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const requestId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
function decoded(value) {
  let result; try { result = decodeURIComponent(value); } catch { fail(400, 'INVALID_PATH', 'Use an original record identifier.'); }
  if (!id(result)) fail(400, 'INVALID_PATH', 'Use an original record identifier.');
  return result;
}
function publicContext(value) {
  const normalized = normalizeInputContext(value ?? emptyInputContext());
  if (Object.values(normalized).some(values => values.length)) fail(403, 'BUSINESS_AGENT_PUBLIC_INPUT_ONLY', 'This integration accepts supplied public text only; selected files, memories, skills and connector grants are not enabled.');
  return normalized;
}

// Provider transport + context/access associations only. Original Runtime owns
// every Run, Message, scheduler, cancellation and token reservation. No turns,
// commands, graph, task queue or second execution-state registry is introduced.
export function createPiBusinessAgentAdapter({ provider: original, options }) {
  if (original.kind !== 'pi-durable' || !options || Object.keys(options).some(key => !['recipient', 'resolveBinding', 'resolveControlBinding', 'engineAdapter'].includes(key)) || typeof options.resolveBinding !== 'function'
    || options.resolveControlBinding !== undefined && typeof options.resolveControlBinding !== 'function')
    throw new TypeError('Use the existing Pi provider and a trusted existing member binding resolver.');
  const engineAdapter = options.engineAdapter;
  if (engineAdapter && (!['omp:18.10.4:public-v1', 'omp:18.10.4:factory-materials-v1'].includes(engineAdapter.scope) || typeof engineAdapter.complete !== 'function'))
    throw new TypeError('Use the reviewed fixed OMP public session adapter.');
  const recipient = normalizeLibraryRecipient(options.recipient), recipientFingerprint = libraryReadHash(recipient);
  const executionFingerprint = engineAdapter ? hash(recipientFingerprint + '\0' + engineAdapter.scope) : recipientFingerprint;
  let store, runtime, access, instanceId, libraryModelRead;
  function current(idValue) { const record = store.read().conversations.find(row => row.id === idValue); if (!record) fail(404, 'NOT_FOUND', 'Conversation not found.'); return record; }
  function actor(context, write = false) {
    if (!context?.subject || !context.workspaceId) fail(401, 'SESSION_REQUIRED', 'Use the original Workspace Session.');
    if (access.mode !== 'local') {
      const live = access.nativeSessionById(context.sessionId ?? context.session?.id);
      if (!live || !ownerMatches(live, context) || live.role !== context.role) fail(401, 'SESSION_REQUIRED', 'The original Session expired or was revoked.');
    } else if (context.subject !== 'local-operator' || context.workspaceId !== 'local') fail(401, 'SESSION_REQUIRED', 'Use the original local identity.');
    if (write && !['admin', 'operator'].includes(context.role)) fail(403, 'ROLE_REQUIRED', 'The existing role cannot execute this request.');
    return { subject: context.subject, workspaceId: context.workspaceId, role: context.role, sessionId: context.sessionId ?? context.session?.id ?? null };
  }
  function owned(conversationId, identity) {
    const conversation = current(conversationId);
    if (!ownerMatches(conversation.businessAgentOwner, identity)) fail(404, 'NOT_FOUND', 'Conversation not found.');
    return conversation;
  }
  async function bindingFor(identity, conversation, signal, controlOnly = false) {
    actor(identity);
    const binding = await (controlOnly && options.resolveControlBinding || options.resolveBinding)({ actor: identity, conversation: { id: conversation.id, title: conversation.title } });
    if (!binding?.client?.bindingIdentity || !engineAdapter && !binding.modelRuntime || !binding?.model) fail(409, 'BUSINESS_AGENT_UNCONFIGURED', 'The existing Host member/model binding is not configured.');
    if (conversation.businessAgentSession && (conversation.businessAgentSession.engineScope || 'pi:1.1.0') !== (engineAdapter?.scope || 'pi:1.1.0'))
      fail(403, 'BUSINESS_AGENT_ENGINE_CHANGED', 'This transcript belongs to another engine scope. Start a fresh public-only conversation; private Pi history cannot migrate.');
    let proof;
    try { proof = await binding.client.bindingIdentity(signal); }
    catch (error) {
      const rejected = /HTTP (?:401|403)/.test(error?.message || '');
      fail(rejected ? 403 : 503, 'BUSINESS_AGENT_BINDING_UNAVAILABLE', 'The existing member transport cannot prove its current binding; no model request was admitted.');
    }
    if (!ownerMatches(proof, identity) || proof.role !== identity.role || proof.instanceId !== instanceId)
      fail(403, 'BUSINESS_AGENT_IDENTITY_CHANGED', 'The existing Agent client must belong to this original Session member, workspace and original application instance.');
    let receiver;
    try { receiver = libraryReadHash(libraryRecipientForModel(binding.model)); } catch { fail(403, 'BUSINESS_AGENT_RECIPIENT_CHANGED', 'Use the explicitly pinned official Pi model receiver.'); }
    if (receiver !== recipientFingerprint || conversation.businessAgentSession && conversation.businessAgentSession.recipientFingerprint !== recipientFingerprint)
      fail(403, 'BUSINESS_AGENT_RECIPIENT_CHANGED', 'This transcript cannot inherit a changed model receiver; start a new conversation.');
    if (!/^[a-f0-9]{64}$/.test(binding.client.bindingFingerprint || '')) fail(409, 'BUSINESS_AGENT_BINDING_INVALID', 'The existing service binding is invalid.');
    if (conversation.businessAgentSession && conversation.businessAgentSession.bindingFingerprint !== binding.client.bindingFingerprint)
      fail(403, 'BUSINESS_AGENT_BINDING_CHANGED', 'A rotated service binding cannot inherit this transcript; start a new conversation.');
    return binding;
  }
  async function complete(input) {
    const run = store.read().runs.find(row => row.id === input.runId);
    if (!run?.businessAgentContext) return original.complete.call(original, input);
    if (run.goalId || run.agentPresetContext || run.piTaskContext || run.supplierDraftContext || run.museDraftContext || !input.json || input.accountedNativeTaskId !== undefined)
      throw new ProviderError('BUSINESS_AGENT_CONTEXT_CONFLICT', 'This is not a public-business AgentSession invocation.');
    const identity = actor(run.businessAgentContext, true), conversation = owned(input.conversationId, identity);
    if (conversation.activeRunId !== run.id || run.status !== 'running') throw new ProviderError('CANCELLED', 'The original run is no longer active.');
    const binding = await bindingFor(identity, conversation, input.signal);
    const authorize = async () => {
      input.signal?.throwIfAborted(); actor(identity, true);
      const live = store.read().runs.find(row => row.id === run.id);
      if (live?.status !== 'running' || current(conversation.id).activeRunId !== run.id) throw new ProviderError('CANCELLED', 'The original run stopped.');
      const proof = await binding.client.bindingIdentity(input.signal);
      if (!ownerMatches(proof, identity) || proof.role !== identity.role || proof.instanceId !== instanceId) throw new ProviderError('BUSINESS_AGENT_IDENTITY_CHANGED', 'The original member or application binding changed.');
    };
    // A plain facade avoids PR67's Proxy invariant violation on the frozen #65
    // client. The original client retains all transport/permission checks.
    const client = Object.fromEntries(Object.entries(binding.client).map(([key, value]) => [key, typeof value !== 'function' ? value : async (...args) => {
      await authorize();
      if (key === 'businessSubmit' && !run.businessAgentContext.allowBusinessSubmit) fail(403, 'BUSINESS_EXECUTION_INTENT_REQUIRED', 'Read-only conversation input cannot submit a business task.');
      const result = await value.apply(binding.client, args);
      const taskId = result?.task?.taskId;
      if (['businessSubmit', 'businessStatus', 'businessResult'].includes(key) && taskId) {
        await authorize();
        await store.update(state => {
          const task = state.workspaceAgentTasks?.tasks.find(row => row.id === taskId);
          const originalRun = state.runs.find(row => row.id === run.id && row.status === 'running');
          if (!originalRun || !ownerMatches(task, identity)) fail(403, 'BUSINESS_TASK_OWNER_REQUIRED', 'No original owned task receipt is available.');
          const refs = originalRun.executionRefs ||= [];
          if (!refs.some(row => row.taskId === taskId)) refs.push({ kind: 'workspace-business', taskId });
        });
      }
      return result;
    }]));
    if (engineAdapter) {
      // The original adapter retains identity, Session, instance, authorization,
      // executionRefs and Run ownership. The trusted seam supplies only the
      // official OMP SDK transport; it introduces no business queue or ledger.
      const isolated = path.join(store.directory, 'omp-agent-context', hash(conversation.id));
      await privateDirectory(isolated);
      const materialsClient = engineAdapter.scope === 'omp:18.10.4:factory-materials-v1' ? createWorkspaceFactoryMaterialsClient({ recipient,
        request: async (route, init) => {
          await authorize();
          const url = new URL(route, 'https://original-library.invalid');
          if (!url.pathname.startsWith('/api/library/model-read/factory/') || init.method !== 'GET') throw Error('Only the original read-only factory Library projection is admitted.');
          try {
            const value = await libraryModelRead.readFactoryForSession({ identity, recipientHash: init.headers['X-Workspace-Library-Recipient'],
              suffix: url.pathname.slice('/api/library/model-read/factory/'.length), query: url.searchParams, signal: input.signal });
            await authorize();
            return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
          } catch (error) {
            if (![401, 403, 404, 409].includes(error.status)) throw error;
            return new Response('{}', { status: error.status, headers: { 'content-type': 'application/json' } });
          }
        } }) : null;
      return engineAdapter.complete({ input, run, binding, client, authorize, materialsClient, isolationDirectory: isolated,
        savedSession: current(conversation.id).businessAgentSession || null,
        async saveSession(mapping) {
          await authorize();
          const expected = path.join(isolated, 'sessions', binding.client.bindingFingerprint);
          if (!mapping || !id(mapping.agentSessionId) || path.dirname(mapping.sessionFile || '') !== expected)
            fail(409, 'BUSINESS_AGENT_SESSION_PATH_CHANGED', 'The OMP public transcript mapping is invalid.');
          const file = await openPrivateFile(mapping.sessionFile); await file.close();
          await store.update(state => {
            const record = state.conversations.find(row => row.id === conversation.id);
            if (!record || record.activeRunId !== run.id) throw new ProviderError('CANCELLED', 'The original run stopped.');
            record.businessAgentSession = { agentSessionId: mapping.agentSessionId, sessionFile: mapping.sessionFile,
              bindingFingerprint: binding.client.bindingFingerprint, recipientFingerprint, engineScope: engineAdapter.scope };
          });
        } });
    }
    const isolated = path.join(store.directory, 'pi-agent-context', hash(conversation.id));
    await privateDirectory(isolated);
    const sessionDirectory = path.join(isolated, 'sessions', binding.client.bindingFingerprint); await privateDirectory(sessionDirectory);
    let manager;
    const saved = current(conversation.id).businessAgentSession;
    if (saved) {
      if (path.dirname(saved.sessionFile) !== sessionDirectory) fail(409, 'BUSINESS_AGENT_SESSION_PATH_CHANGED', 'The original transcript mapping changed.');
      const file = await openPrivateFile(saved.sessionFile);
      try { if ((await file.stat()).size > 32_000_000) fail(409, 'BUSINESS_AGENT_SESSION_LIMIT', 'The original transcript requires archival.'); } finally { await file.close(); }
      manager = SessionManager.open(saved.sessionFile, sessionDirectory, isolated);
      if (manager.getSessionId() !== saved.agentSessionId || path.resolve(manager.getCwd()) !== isolated) fail(409, 'BUSINESS_AGENT_SESSION_ID_CHANGED', 'The original official transcript identity changed.');
    } else {
      manager = SessionManager.create(isolated, sessionDirectory);
      // Save only the SDK's own header. Context identity survives even an
      // interrupted first turn; no fabricated user/tool/model receipt is added.
      const filename = manager.getSessionFile(), file = await fs.open(filename, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(manager.getHeader()) + '\n'); await file.sync(); } finally { await file.close(); }
      await syncDirectory(sessionDirectory);
      manager = SessionManager.open(filename, sessionDirectory, isolated);
    }
    await authorize();
    await store.update(state => {
      const record = state.conversations.find(row => row.id === conversation.id);
      if (!record || record.activeRunId !== run.id) throw new ProviderError('CANCELLED', 'The original run stopped.');
      record.businessAgentSession = { agentSessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), bindingFingerprint: binding.client.bindingFingerprint, recipientFingerprint };
    });
    const created = await createWorkspaceAgentRuntime({ client, isolationDirectory: isolated, modelRuntime: binding.modelRuntime, model: binding.model, sessionManager: manager });
    const pi = created.runtime.session;
    try { await pi.bindExtensions({}); } catch (error) { await created.runtime.dispose(); throw error; }
    const unsubscribe = pi.agent.subscribe(async event => {
      if (!['tool_execution_start', 'tool_execution_end'].includes(event.type) || !WORKSPACE_AGENT_TOOLS.includes(event.toolName)) return;
      await input.onEvent?.({ type: event.type === 'tool_execution_start' ? 'pi.tool.started' : event.isError ? 'pi.tool.failed' : 'pi.tool.finished',
        toolName: event.toolName, toolCallId: hash(String(event.toolCallId)) });
    });
    const start = pi.agent.state.messages.length;
    let modelCalls = 0;
    const stream = pi.agent.streamFunction;
    // Four * 400 output tokens fit the ORIGINAL 1600-token reservation even on
    // abort/unknown usage. No new ledger or monetary-budget claim is introduced.
    pi.agent.streamFunction = (model, context, opts) => lazyStream(model, async () => {
      await authorize();
      if (++modelCalls > 4 || libraryReadHash(libraryRecipientForModel(model)) !== recipientFingerprint) throw new ProviderError('BUSINESS_AGENT_MODEL_LIMIT', 'The admitted AgentSession request bound or receiver changed.');
      const maxTokens = Math.min(400, Math.floor(input.maxTokens / 4));
      if (maxTokens < 1) throw new ProviderError('TOKEN_BUDGET', 'The original run has no remaining admitted allowance.');
      await input.onEvent?.({ type: 'pi.agent-session.request' });
      await authorize();
      return stream(model, context, { ...opts, signal: AbortSignal.any([input.signal, opts?.signal, AbortSignal.timeout(60_000)].filter(Boolean)),
        maxTokens, maxRetries: 0, timeoutMs: 60_000, reasoning: 'off' });
    });
    const stop = () => { void pi.abort(); }; input.signal?.addEventListener('abort', stop, { once: true });
    try {
      await authorize();
      const user = store.read().messages.find(row => row.id === run.userMessageId)
        || store.read().messages.find(row => row.conversationId === conversation.id && row.role === 'user' && row.requestId === run.requestId);
      if (!user || looksLikeCredential(user.content)) fail(400, 'PUBLIC_TEXT_REQUIRED', 'Provide bounded public text without credentials.');
      await pi.prompt(user.content, { expandPromptTemplates: false });
      await authorize();
      const last = pi.agent.state.messages.at(-1);
      if (pi.agent.state.messages.length <= start || last?.role !== 'assistant' || last.stopReason !== 'stop') throw new ProviderError('BUSINESS_AGENT_INCOMPLETE', 'The official AgentSession did not finish a new answer. Original business task receipts remain authoritative.');
      const filename = pi.sessionFile;
      const file = await openPrivateFile(filename); try { await file.sync(); } finally { await file.close(); }
      const answers = pi.agent.state.messages.slice(start).filter(row => row.role === 'assistant');
      const sum = field => answers.every(row => Number.isSafeInteger(row.usage?.[field]) && row.usage[field] >= 0) ? answers.reduce((total, row) => total + row.usage[field], 0) : null;
      const completionTokens = sum('output'); if (completionTokens !== null && completionTokens > input.maxTokens) throw new ProviderError('TOKEN_BUDGET', 'The frontend exceeded the original reserved output allowance.');
      return { content: JSON.stringify({ done: true, content: pi.getLastAssistantText() }), usage: { promptTokens: sum('input'), completionTokens, totalTokens: sum('totalTokens') },
        runtime: { kind: 'pi-durable', execution: 'agent-session', agentSessionId: manager.getSessionId(), modelCalls, originalRunId: run.id } };
    } finally { input.signal?.removeEventListener('abort', stop); unsubscribe(); await created.runtime.dispose(); }
  }
  const provider = new Proxy({}, { get(_target, key) {
    if (key === 'businessAgentRecipientFingerprint') return executionFingerprint;
    if (key === 'complete') return complete;
    const value = Reflect.get(original, key, original); return typeof value === 'function' ? value.bind(original) : value;
  } });
  return {
    provider,
    attach(dependencies) { ({ store, runtime, access, instanceId, libraryModelRead } = dependencies); },
    async handle({ req, res, pathname, context, readBody, respond }) {
      if (req.method === 'GET' && pathname === '/api/conversations/runtime') {
        actor(context);
        await respond(res, 200, { engine: engineAdapter ? 'omp' : 'pi', engineScope: engineAdapter?.scope || 'pi:1.1.0',
          frontend: 'original-workspace-conversation-run', privateLibrary: engineAdapter?.scope === 'omp:18.10.4:factory-materials-v1' ? 'original-reviewed-session-policy-required' : engineAdapter ? 'disabled' : 'original-controlled-policy' });
        return true;
      }
      if (req.method === 'POST' && pathname === '/api/conversations') {
        const identity = actor(context, true), body = await readBody(req); publicContext(body.inputContext);
        await respond(res, 201, await runtime.createConversation(body, identity, { businessAgentOwner: { subject: identity.subject, workspaceId: identity.workspaceId } })); return true;
      }
      const match = pathname.match(/^\/api\/conversations\/([^/]+)(?:\/(messages|cancel|task-graph|business-results|terminal-status|terminal-controls)|\/business-tasks\/([^/]+)\/(resume))?$/);
      if (!match) return false;
      const conversationId = decoded(match[1]);
      if (!current(conversationId).businessAgentOwner) {
        if (engineAdapter && req.method === 'POST' && match[2] === 'messages') {
          const identity = actor(context, true), legacy = current(conversationId);
          if (legacy.createdBy !== identity.subject || legacy.workspaceId !== identity.workspaceId) fail(404, 'NOT_FOUND', 'Conversation not found.');
          fail(403, 'BUSINESS_AGENT_ENGINE_CHANGED', 'This historical conversation requires explicit Pi fallback. Start a fresh public-only OMP conversation.');
        }
        return false;
      }
      const identity = actor(context, req.method !== 'GET'), conversation = owned(conversationId, identity);
      if (req.method === 'POST' && match[2] === 'terminal-controls') {
        const body = await readBody(req), operation = body.operation;
        const fields = { status: ['runId'], cancel: ['runId', 'confirmed'], resume: ['runId', 'requestId', 'confirmed'],
          decision: ['runId', 'proposalId', 'confirmed'], continue: ['runId', 'proposalId', 'requestId', 'confirmed'],
          businessStatus: ['taskId'], businessCancel: ['taskId', 'confirmed'] };
        if (!Object.hasOwn(fields, operation) || Object.keys(body).some(key => !['operation', ...fields[operation]].includes(key))
          || fields[operation].some(key => key === 'confirmed' ? body[key] !== true : key === 'requestId' ? !requestId(body[key]) : !id(body[key])))
          fail(400, 'HUMAN_CONTROL_REQUIRED', 'Use an exact original human control, identifiers and stable requestId, with explicit confirmation for mutations.');
        const binding = await bindingFor(identity, conversation, undefined, !['resume', 'continue'].includes(operation));
        let value;
        if (operation.startsWith('business')) {
          const linked = store.read().runs.some(run => run.conversationId === conversationId && run.executionRefs?.some(ref => ref.taskId === body.taskId));
          if (!linked) fail(404, 'NOT_FOUND', 'This conversation has no such original task reference.');
          value = await binding.client[operation](body.taskId);
        } else {
          const run = store.read().runs.find(row => row.id === body.runId && row.piTaskContext && ownerMatches(row.piTaskContext, identity));
          if (!run) fail(404, 'ORIGINAL_PI_CHECKPOINT_REQUIRED', 'Use an owned original Pi checkpoint; an OMP frontend transcript cannot be replayed as Pi.');
          value = operation === 'decision' ? await binding.client.decision(body.runId, body.proposalId, 'approved')
            : operation === 'continue' ? await binding.client.continue(body.runId, body.proposalId, body.requestId)
              : operation === 'resume' ? await binding.client.resume(body.runId, body.requestId) : await binding.client[operation](body.runId);
        }
        actor(identity, true);
        if (looksLikeCredential(JSON.stringify(value))) fail(403, 'PUBLIC_RECEIPT_REQUIRED', 'The original control receipt cannot be disclosed in this public terminal.');
        await respond(res, 200, value); return true;
      }
      if (req.method === 'GET' && match[2] === 'terminal-status') {
        const query = new URL(req.url, 'http://localhost').searchParams;
        if ([...query.keys()].some(key => key !== 'runId') || query.getAll('runId').length !== 1 || !id(query.get('runId')))
          fail(400, 'INVALID_INPUT', 'Use one exact original runId for this public conversation.');
        await bindingFor(identity, conversation);
        const run = store.read().runs.find(row => row.id === query.get('runId') && row.conversationId === conversationId && row.businessAgentContext);
        if (!run) fail(404, 'NOT_FOUND', 'This conversation has no such original frontend run.');
        const reply = store.read().messages.find(row => row.id === run.assistantId && row.conversationId === conversationId && row.role === 'assistant');
        if (reply && looksLikeCredential(reply.content)) fail(403, 'PUBLIC_RECEIPT_REQUIRED', 'The original reply cannot be disclosed as public text.');
        await respond(res, 200, { conversationId, run: { id: run.id, status: run.status, events: run.events,
          usage: run.usage, budget: run.budget, executionRefs: run.executionRefs || [], error: run.error ? { code: run.error.code } : null },
          reply: reply ? { id: reply.id, runId: run.id, status: reply.status, content: reply.content } : null });
        return true;
      }
      if (req.method === 'POST' && match[2] === 'messages') {
        const body = await readBody(req);
        if (Object.keys(body).some(key => !['content', 'requestId', 'workspaceExecution', 'inputContext', 'provider'].includes(key)) || body.provider !== undefined && !['builtin', 'pi'].includes(body.provider)
          || body.workspaceExecution !== undefined && typeof body.workspaceExecution !== 'boolean' || typeof body.content !== 'string' || body.content.trimStart().startsWith('/') || !requestId(body.requestId) || looksLikeCredential(body.content)) fail(400, 'PUBLIC_TEXT_REQUIRED', 'Use public conversation text and a stable requestId; terminal commands remain in their original human control surface.');
        publicContext(body.inputContext);
        // Validate the existing Host binding before admitting the original run.
        await bindingFor(identity, conversation);
        const admitted = await runtime.sendMessage(conversationId, { content: body.content, requestId: body.requestId, inputContext: emptyInputContext(), workspaceExecution: true },
          { businessAgentContext: { ...identity, allowBusinessSubmit: body.workspaceExecution === true } });
        await respond(res, 202, admitted); return true;
      }
      if (req.method === 'POST' && match[2] === 'cancel') {
        const body = await readBody(req); if (Object.keys(body).length) fail(400, 'INVALID_INPUT', 'Use the original conversation cancel contract.');
        await respond(res, 200, { ...await runtime.cancelConversation(conversationId), backendTasksCancelled: false }); return true;
      }
      if (req.method === 'GET' && match[2] === 'task-graph') { await respond(res, 200, { taskGraph: null, mode: 'single-business-conversation' }); return true; }
      const refs = () => [...new Set(store.read().runs.filter(row => row.conversationId === conversationId).flatMap(row => (row.executionRefs || []).map(ref => ref.taskId)))];
      if (req.method === 'GET' && match[2] === 'business-results') {
        const binding = await bindingFor(identity, conversation);
        const results = []; for (const taskId of refs()) results.push(await binding.client.businessResult({ taskId }));
      await respond(res, 200, { conversationId, status: !results.length ? 'empty' : results.every(result => result.status === 'available') ? 'available' : 'partial', results,
          executionRefs: results.map(result => ({ kind: 'workspace-business', taskId: result.task.taskId, conversationId: store.read().workspaceAgentTasks.tasks.find(row => row.id === result.task.taskId)?.conversationId || null,
            stageRunIds: store.read().workspaceAgentTasks.tasks.find(row => row.id === result.task.taskId)?.steps.map(step => step.runId).filter(Boolean) || [] })) }); return true;
      }
      if (req.method === 'POST' && match[4] === 'resume') {
        const taskId = decoded(match[3]), body = await readBody(req);
        if (body.confirmed !== true || !requestId(body.requestId) || Object.keys(body).some(key => !['confirmed', 'requestId'].includes(key))) fail(400, 'HUMAN_CONFIRMATION_REQUIRED', 'Explicitly confirm continuing the unchanged original task with a stable requestId.');
        if (!refs().includes(taskId)) fail(404, 'NOT_FOUND', 'This conversation has no original task reference.');
        const binding = await bindingFor(identity, conversation);
        await respond(res, 200, await binding.client.businessResume(taskId, undefined, body.requestId)); return true;
      }
      return false;
    },
  };
}
