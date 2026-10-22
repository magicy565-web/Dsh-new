// ctx.llm: provider-neutral model seam for the Workspace Harness.
//
// This package must stay network-free: real providers (pi/OMP or the DeepSeek
// API) are registered by deployment code. Everything here is validated,
// audited metadata plus an offline replay/echo provider for acceptance runs.
import { HarnessError, ERROR } from '../../harness-contracts/src/index.mjs';

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const AUDIT_LIMIT = 100;
const MAX_MESSAGES = 400;
const MAX_MESSAGE_CHARS = 200_000;
const MAX_TOOL_CALLS = 64;

const fail = (code, message) => { throw new HarnessError(code, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = value => structuredClone(value);

function assertProvider(provider) {
  if (!isPlain(provider)) fail(ERROR.llmInvalid, 'A provider must be a plain object.');
  if (typeof provider.id !== 'string' || !ID.test(provider.id)) fail(ERROR.llmInvalid, 'provider.id must be a bounded identifier.');
  if (provider.model !== undefined && (typeof provider.model !== 'string' || provider.model.length > 120)) fail(ERROR.llmInvalid, 'provider.model must be bounded text.');
  if (typeof provider.complete !== 'function' && typeof provider.stream !== 'function')
    fail(ERROR.llmInvalid, `Provider ${provider.id} must expose complete(request) or stream(request).`);
  const id = provider.id, model = provider.model, label = provider.label;
  const complete = typeof provider.complete === 'function' ? provider.complete : null;
  const stream = typeof provider.stream === 'function' ? provider.stream : null;
  return Object.freeze({ id, model, label: typeof label === 'string' ? label.slice(0, 200) : '', complete, stream });
}

function assertRequest(request) {
  if (!isPlain(request)) fail(ERROR.llmInvalid, 'A completion request must be a plain object.');
  if (!Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > MAX_MESSAGES)
    fail(ERROR.llmInvalid, `messages must contain 1..${MAX_MESSAGES} entries.`);
  let chars = 0;
  for (const message of request.messages) {
    if (!isPlain(message) || typeof message.role !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(message.role))
      fail(ERROR.llmInvalid, 'Each message needs a valid role.');
    if (message.content !== undefined && typeof message.content !== 'string') fail(ERROR.llmInvalid, 'message.content must be text.');
    chars += (message.content ?? '').length;
  }
  if (chars > MAX_MESSAGE_CHARS) fail(ERROR.llmInvalid, 'The request exceeds the bounded message budget.');
  if (request.tools !== undefined && (!Array.isArray(request.tools) || request.tools.length > MAX_TOOL_CALLS))
    fail(ERROR.llmInvalid, `tools must be an array of at most ${MAX_TOOL_CALLS} definitions.`);
  return request;
}

function normalizeUsage(value) {
  if (!isPlain(value)) return {};
  return {
    ...(Number.isSafeInteger(value.inputTokens) ? { inputTokens: value.inputTokens } : {}),
    ...(Number.isSafeInteger(value.outputTokens) ? { outputTokens: value.outputTokens } : {}),
  };
}

function normalizeResult(result, provider) {
  if (!isPlain(result)) fail(ERROR.llmInvalid, `Provider ${provider.id} returned a non-object result.`);
  const text = result.text === undefined ? '' : result.text;
  if (typeof text !== 'string' || text.length > MAX_MESSAGE_CHARS) fail(ERROR.llmInvalid, `Provider ${provider.id} returned invalid text.`);
  const calls = result.toolCalls === undefined ? [] : result.toolCalls;
  if (!Array.isArray(calls) || calls.length > MAX_TOOL_CALLS) fail(ERROR.llmInvalid, `Provider ${provider.id} returned invalid toolCalls.`);
  const toolCalls = calls.map(call => {
    if (!isPlain(call) || typeof call.name !== 'string' || !call.name.trim()) fail(ERROR.llmInvalid, 'A tool call needs a name.');
    const args = call.arguments === undefined ? {} : call.arguments;
    if (!isPlain(args)) fail(ERROR.llmInvalid, 'Tool call arguments must be a JSON object.');
    return { name: call.name, arguments: clone(args) };
  });
  const usage = normalizeUsage(result.usage);
  return { provider: provider.id, model: provider.model ?? null, text, toolCalls, usage };
}

/** The fail-closed default: an unconfigured deployment never fabricates a reply. */
export function createUnavailableProvider(id = 'unavailable') {
  return Object.freeze({
    id, label: 'No model configured',
    complete: async () => fail(ERROR.llmNotConfigured, 'No model provider is configured for this harness.'),
  });
}

/** Offline smoke provider: returns the last user message unchanged. */
export function createEchoProvider({ id = 'echo', model = 'echo-1' } = {}) {
  return Object.freeze({
    id, model, label: 'Echo (offline)',
    async complete(request) {
      const last = [...assertRequest(request).messages].reverse().find(message => message.role === 'user');
      return { text: typeof last?.content === 'string' ? last.content : '', toolCalls: [], usage: {} };
    },
  });
}

/** Scripted provider used by offline acceptance; it exposes the exact requests it saw. */
export function createReplayProvider({ id = 'replay', model = 'replay-1', responses = [] } = {}) {
  if (!Array.isArray(responses)) fail(ERROR.llmInvalid, 'responses must be an array.');
  const queue = responses.map(response => {
    if (!isPlain(response)) fail(ERROR.llmInvalid, 'Each scripted response must be an object.');
    return clone(response);
  });
  const requests = [];
  return Object.freeze({
    id, model, label: 'Replay (offline)',
    requests,
    get remaining() { return queue.length; },
    async complete(request) {
      assertRequest(request);
      requests.push({
        messageCount: request.messages.length,
        toolCount: Array.isArray(request.tools) ? request.tools.length : 0,
        roles: request.messages.map(message => message.role),
      });
      const next = queue.shift();
      if (!next) fail(ERROR.llmExhausted, `Replay provider ${id} has no scripted response left.`);
      return next;
    },
  });
}

export function createLlm({ providers = [], defaultProvider } = {}) {
  if (!Array.isArray(providers)) fail(ERROR.llmInvalid, 'providers must be an array.');
  const registry = new Map();
  const audit = [];
  let lastRequest = null;

  const record = entry => {
    audit.push(entry);
    if (audit.length > AUDIT_LIMIT) audit.splice(0, audit.length - AUDIT_LIMIT);
  };

  /** Resolve the provider a request names, or the only registered one. */
  const selectProvider = request => {
    const requested = request.provider ?? defaultProvider;
    if (requested !== undefined) {
      const provider = registry.get(requested);
      if (!provider) fail(ERROR.llmProviderRequired, `Provider ${JSON.stringify(requested)} is not registered.`);
      return provider;
    }
    if (registry.size === 1) return [...registry.values()][0];
    if (registry.size === 0) fail(ERROR.llmNotConfigured, 'No model provider is registered for this harness.');
    return fail(ERROR.llmProviderRequired, 'This harness has several providers; name one explicitly.');
  };

  const llm = {
    register(provider) {
      const validated = assertProvider(provider);
      if (registry.has(validated.id)) fail(ERROR.llmDuplicate, `Provider ${validated.id} is already registered.`);
      registry.set(validated.id, validated);
      return () => { registry.delete(validated.id); };
    },
    providers() {
      return [...registry.values()].map(provider => ({ id: provider.id, model: provider.model ?? null, label: provider.label }))
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    },
    async complete(request, { actor } = {}) {
      assertRequest(request);
      const provider = selectProvider(request);
      if (!provider.complete)
        fail(ERROR.llmInvalid, `Provider ${provider.id} only supports streaming completion.`);
      if (request.signal?.aborted) fail(ERROR.llmAborted, 'The model request was cancelled.');
      const started = Date.now();
      try {
        const result = normalizeResult(await provider.complete(request, { actor }), provider);
        if (request.signal?.aborted) fail(ERROR.llmAborted, 'The model request was cancelled.');
        lastRequest = { provider: provider.id, model: result.model, at: new Date(started).toISOString(), messageCount: request.messages.length };
        record({ at: lastRequest.at, provider: provider.id, model: result.model, messageCount: request.messages.length,
          toolCount: result.toolCalls.length, ok: true });
        return result;
      } catch (error) {
        const preserved = new Set([ERROR.llmAborted, ERROR.llmInvalid, ERROR.llmExhausted, ERROR.llmNotConfigured, ERROR.llmProviderRequired, ERROR.llmDuplicate]);
        const code = preserved.has(error?.code) ? error.code : (request.signal?.aborted ? ERROR.llmAborted : ERROR.llmFailed);
        record({ at: new Date(started).toISOString(), provider: provider.id, model: provider.model ?? null,
          messageCount: request.messages.length, toolCount: 0, ok: false, errorCode: code });
        if (error?.code === code) throw error;
        // Never forward a provider message: it may contain credentials or prompt text.
        throw new HarnessError(code, `Model provider ${provider.id} failed.`);
      }
    },
    /**
     * Streaming completion. Yields `{ type: 'delta', text }` chunks and exactly
     * one `{ type: 'done', text, usage, model, provider }`. A provider without
     * stream() is adapted by calling complete() once and yielding one delta, so
     * callers never branch on provider capabilities.
     */
    async *stream(request, { actor } = {}) {
      assertRequest(request);
      const provider = selectProvider(request);
      if (request.signal?.aborted) fail(ERROR.llmAborted, 'The model request was cancelled.');
      const started = Date.now();
      let text = '';
      let usage = {};
      let model = provider.model ?? null;
      try {
        if (provider.stream) {
          for await (const chunk of provider.stream(request, { actor })) {
            if (request.signal?.aborted) fail(ERROR.llmAborted, 'The model request was cancelled.');
            if (!isPlain(chunk)) fail(ERROR.llmInvalid, 'A stream chunk must be a plain object.');
            const delta = chunk.delta ?? chunk.text;
            if (delta !== undefined) {
              if (typeof delta !== 'string') fail(ERROR.llmInvalid, 'A stream delta must be text.');
              if (text.length + delta.length > MAX_MESSAGE_CHARS) fail(ERROR.llmInvalid, 'The streamed answer exceeds the bounded message budget.');
              text += delta;
              if (delta) yield { type: 'delta', text: delta };
            }
            if (chunk.usage !== undefined) usage = normalizeUsage(chunk.usage);
            if (typeof chunk.model === 'string' && chunk.model.length <= 120) model = chunk.model;
          }
        } else {
          const result = normalizeResult(await provider.complete(request, { actor }), provider);
          text = result.text;
          usage = result.usage;
          model = result.model;
          if (text) yield { type: 'delta', text };
        }
        if (request.signal?.aborted) fail(ERROR.llmAborted, 'The model request was cancelled.');
        lastRequest = { provider: provider.id, model, at: new Date(started).toISOString(), messageCount: request.messages.length };
        record({ at: lastRequest.at, provider: provider.id, model, messageCount: request.messages.length, toolCount: 0, ok: true });
        yield { type: 'done', text, usage, model, provider: provider.id };
      } catch (error) {
        const preserved = new Set([ERROR.llmAborted, ERROR.llmInvalid, ERROR.llmExhausted, ERROR.llmNotConfigured, ERROR.llmProviderRequired, ERROR.llmDuplicate]);
        const code = preserved.has(error?.code) ? error.code : (request.signal?.aborted ? ERROR.llmAborted : ERROR.llmFailed);
        record({ at: new Date(started).toISOString(), provider: provider.id, model,
          messageCount: request.messages.length, toolCount: 0, ok: false, errorCode: code });
        if (error?.code === code) throw error;
        throw new HarnessError(code, `Model provider ${provider.id} failed.`);
      }
    },
    lastRequest() { return lastRequest ? clone(lastRequest) : null; },
    audit() { return audit.map(entry => clone(entry)); },
    close() { registry.clear(); },
  };
  for (const provider of providers) llm.register(provider);
  return Object.freeze(llm);
}

export const manifest = Object.freeze({
  id: 'llm', version: '0.1.0', kind: 'provider', entry: './src/llm.mjs', provides: ['llm'], requires: [],
});

export function createLlmProvider(options = {}) {
  const service = createLlm(options);
  return {
    id: 'llm', manifest,
    async apply(ctx) {
      if (typeof ctx?.provide !== 'function') fail(ERROR.llmInvalid, 'The Cordis context must expose provide().');
      const dispose = ctx.provide('llm', service);
      return async () => { try { await service.close(); } finally { if (typeof dispose === 'function') await dispose(); } };
    },
  };
}

export async function apply(ctx, config = {}) {
  return createLlmProvider(config).apply(ctx);
}
