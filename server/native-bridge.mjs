import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

export const name = 'workspace-native-bridge';
export const inject = ['agents', 'sessionPersistence'];
const SESSION_ID = /^workspace-session-[a-f0-9]{32}$/;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => isRecord(value) && Object.keys(value).every(key => fields.includes(key));
const invalid = () => { throw new Error('Workspace native bridge: invalid request'); };

/** Resolve only the reviewed installation's public package exports. No source/old-version fallback. */
export async function loadNativeBridgeDependencies(sdkPackagePath) {
  if (typeof sdkPackagePath !== 'string' || !path.isAbsolute(sdkPackagePath)
    || path.basename(sdkPackagePath) !== 'package.json') throw new Error('A built SDK server package.json is required.');
  const manifest = JSON.parse(await readFile(sdkPackagePath, 'utf8'));
  if (manifest.name !== '@deepseek-ai/dsh-sdk-jsonrpc-server' || manifest.version !== '0.2.0-rc.2') {
    throw new Error('Workspace native bridge requires the reviewed Harness 0.2.0-rc.2 SDK server.');
  }
  const require = createRequire(sdkPackagePath);
  const server = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sdk-jsonrpc-server')).href);
  const protocol = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-sdk-protocol')).href);
  const llm = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
  if (typeof server.HarnessSdkJsonRpcServer !== 'function' || typeof protocol.JsonRpcLineTransport !== 'function'
    || typeof llm.createUserMessage !== 'function') throw new Error('The reviewed native package exports are unavailable.');
  return { HarnessSdkJsonRpcServer: server.HarnessSdkJsonRpcServer,
    JsonRpcLineTransport: protocol.JsonRpcLineTransport, createUserMessage: llm.createUserMessage };
}

/**
 * Workspace deployment extension around public native APIs. The native Agent,
 * Session persistence, Goal, MCP, context and profile still own their state.
 * Injection exists for keyless protocol/lifecycle tests, never model simulation in production.
 */
export function createNativeBridgeController(ctx, transport, { HarnessSdkJsonRpcServer, createUserMessage }) {
  let route;
  let initializing = false;
  let initializationTask;
  let closing = false;
  let shutdown;
  const handles = new Map();
  const pending = new Map();
  const abort = new AbortController();
  const server = new HarnessSdkJsonRpcServer(ctx, { notify(method, params) {
    if (!closing) transport.notify(method, params);
  } }, { maxTokensAsSuccess: false });

  const assertOpen = () => { if (closing) throw new Error('Workspace native bridge: closed'); };
  const assertReady = () => { assertOpen(); if (!route) throw new Error('Workspace native bridge: initialize first'); };
  const live = id => {
    const handle = handles.get(id);
    if (!handle || ctx.agents.get(id) !== handle.agent) throw new Error('Workspace native bridge: session is not open');
    return handle;
  };

  async function openSession(params) {
    assertReady();
    if (!exact(params, ['version', 'sessionId', 'mode']) || params.version !== 1 || !SESSION_ID.test(params.sessionId)
      || !['create', 'resume'].includes(params.mode)) invalid();
    const { sessionId, mode } = params;
    if (handles.has(sessionId)) {
      live(sessionId);
      if (mode !== 'resume') throw new Error('Workspace native bridge: session already exists');
      return { version: 1, sessionId, resumed: true };
    }
    if (pending.has(sessionId)) throw new Error('Workspace native bridge: session opening');
    const task = (async () => {
      const agentOptions = { provider: route.provider, model: route.model, maxTokens: route.maxTokens,
        ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }) };
      let handle;
      if (mode === 'resume') {
        const snapshot = await ctx.sessionPersistence.stat(sessionId, { signal: abort.signal });
        assertOpen();
        if (!snapshot || snapshot.header?.id !== sessionId || typeof snapshot.header.cwd !== 'string'
          || path.resolve(snapshot.header.cwd) !== route.cwd || snapshot.header.parentSession !== undefined) {
          throw new Error('Workspace native bridge: stored session missing or outside workspace');
        }
        handle = await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, signal: abort.signal });
      } else {
        handle = await ctx.agents.create({ sessionId, meta: { cwd: route.cwd }, agentOptions, signal: abort.signal });
      }
      if (closing) { await handle.dispose(); throw new Error('Workspace native bridge: closed'); }
      handles.set(sessionId, handle);
      return { version: 1, sessionId, resumed: mode === 'resume' };
    })();
    pending.set(sessionId, task);
    try { return await task; }
    finally { pending.delete(sessionId); }
  }

  async function close() {
    shutdown ??= (async () => {
      closing = true;
      abort.abort();
      if (initializationTask) await Promise.allSettled([initializationTask]);
      await Promise.allSettled(pending.values());
      const owned = [...handles.values()];
      handles.clear();
      const outcomes = await Promise.allSettled(owned.map(handle => handle.dispose()));
      try { await server.shutdown(); }
      catch (error) { outcomes.push({ status: 'rejected', reason: error }); }
      const errors = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
      if (errors.length) throw new AggregateError(errors, 'Workspace native bridge: shutdown failed');
      return {};
    })();
    return shutdown;
  }

  return {
    close,
    async request(method, params) {
      if (method === 'shutdown') return close();
      assertOpen();
      if (method === 'initialize') {
        if (route || initializing) throw new Error('Workspace native bridge: already initialized');
        if (!exact(params, ['cwd', 'provider', 'model', 'reasoningEffort', 'maxTokens'])
          || typeof params.cwd !== 'string' || !path.isAbsolute(params.cwd)
          || typeof params.provider !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(params.provider)
          || typeof params.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(params.model)
          || !Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0 || params.maxTokens > 131_072) invalid();
        initializing = true;
        initializationTask = (async () => {
          try {
            await ctx.get('loader')?.await();
            assertOpen();
            const result = await server.initialize(params);
            assertOpen();
            route = { ...params, cwd: path.resolve(params.cwd) };
            return result;
          } finally { initializing = false; }
        })();
        return initializationTask;
      }
      if (method === 'workspace/session/open') return openSession(params);
      if (method === 'session/prompt') {
        assertReady();
        if (!exact(params, ['sessionId', 'contentBlocks']) || !SESSION_ID.test(params.sessionId)
          || !Array.isArray(params.contentBlocks) || params.contentBlocks.length < 1 || params.contentBlocks.length > 100
          || params.contentBlocks.some(block => !exact(block, ['type', 'text']) || block.type !== 'text' || typeof block.text !== 'string')
          || params.contentBlocks.reduce((size, block) => size + block.text.length, 0) > 250_000) invalid();
        const handle = live(params.sessionId);
        const message = createUserMessage({ content: structuredClone(params.contentBlocks), source: { kind: 'user' } });
        handle.agent.followup(message);
        return { messageId: message.id };
      }
      // No tools, goal mutation, approval reply, arbitrary RPC or permission bypass.
      throw new Error('Workspace native bridge: unsupported method');
    },
  };
}

/** Loaded only by an explicitly reviewed dsh profile overlay. */
export async function apply(ctx, config) {
  if (!exact(config, ['sdkPackagePath']) || typeof config.sdkPackagePath !== 'string') invalid();
  const dependencies = await loadNativeBridgeDependencies(config.sdkPackagePath);
  const transport = new dependencies.JsonRpcLineTransport(process.stdin, process.stdout);
  const controller = createNativeBridgeController(ctx, transport, dependencies);
  let exitTask;
  const disposeAndExit = () => exitTask ??= (async () => {
    let failed = false;
    try { await transport.flush(); } catch { failed = true; }
    try { await ctx.root.fiber.dispose(); } catch { failed = true; }
    process.exit(failed ? 1 : 0);
  })();
  transport.onRequest(async (method, params) => {
    const result = await controller.request(method, params);
    if (method === 'shutdown') setImmediate(() => { void disposeAndExit(); });
    return result;
  });
  ctx.effect(() => {
    transport.start();
    return async () => { try { await controller.close(); } finally { transport.close(); } };
  }, 'workspace-native-bridge.serve');
}
