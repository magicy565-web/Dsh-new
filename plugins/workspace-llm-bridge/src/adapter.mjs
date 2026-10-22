// Map the repository's existing runtime provider (server/provider.mjs) onto the
// ctx.llm provider contract. Pure: it never reads env, files or the network; the
// caller injects the completion function. Provider errors are translated to the
// seam's own codes and messages so no credential or prompt text can leak.
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';

const MAX_TEXT = 80_000;

const mappedCode = code => {
  if (code === 'CANCELLED') return ERROR.llmAborted;
  if (code === 'SETUP_REQUIRED') return ERROR.llmNotConfigured;
  if (code === 'INVALID_MODEL') return ERROR.llmInvalid;
  return ERROR.llmFailed;
};

const mappedMessage = (code, providerId) => {
  if (code === ERROR.llmAborted) return 'The model request was cancelled.';
  if (code === ERROR.llmNotConfigured) return 'The runtime provider is not configured.';
  if (code === ERROR.llmInvalid) return 'The runtime provider refused the requested model.';
  return `Model provider ${providerId} failed.`;
};

export function mapProviderError(error, providerId = 'workspace-runtime') {
  const code = mappedCode(error?.code);
  return new HarnessError(code, mappedMessage(code, providerId));
}

const counter = value => (Number.isSafeInteger(value) && value >= 0 ? value : undefined);

/**
 * @param {{id?: string, model?: string, label?: string, maxTokens?: number,
 *          complete?: (request: object) => Promise<{content?: string, text?: string, usage?: object}>,
 *          stream?: (request: object) => AsyncIterable<{delta?: string, usage?: object}>}} options
 */
export function createRuntimeProvider({ id = 'workspace-runtime', model = 'deepseek-flash', label, maxTokens = 1600, complete, stream = null } = {}) {
  if (typeof complete !== 'function' && typeof stream !== 'function')
    throw new TypeError('createRuntimeProvider requires a complete or stream function.');
  const descriptor = Object.freeze({
    id,
    model,
    label: typeof label === 'string' && label ? label.slice(0, 200) : `Workspace runtime (${model})`,
  });
  const requestFor = request => ({
    messages: request.messages.map(message => ({ role: message.role, content: message.content })),
    model: request.model ?? model,
    maxTokens,
    signal: request.signal,
    json: request.json === true,
  });
  return {
    ...descriptor,
    ...(typeof complete === 'function' ? { async complete(request = {}) {
      const messages = request.messages;
      if (!Array.isArray(messages) || messages.length === 0)
        throw new HarnessError(ERROR.llmInvalid, 'The runtime provider requires at least one message.');
      let result;
      try {
        result = await complete(requestFor({ ...request, messages }));
      } catch (error) {
        if (request.signal?.aborted) throw new HarnessError(ERROR.llmAborted, 'The model request was cancelled.');
        throw mapProviderError(error, id);
      }
      const text = typeof result?.content === 'string' ? result.content : (typeof result?.text === 'string' ? result.text : '');
      if (!text.trim()) throw new HarnessError(ERROR.llmFailed, `Model provider ${id} failed.`);
      const usage = result?.usage ?? {};
      const inputTokens = counter(usage.inputTokens ?? usage.promptTokens);
      const outputTokens = counter(usage.outputTokens ?? usage.completionTokens);
      return {
        text: text.slice(0, MAX_TEXT),
        toolCalls: [],
        usage: {
          ...(inputTokens === undefined ? {} : { inputTokens }),
          ...(outputTokens === undefined ? {} : { outputTokens }),
        },
      };
    } } : {}),
    ...(typeof stream === 'function' ? { async *stream(request = {}) {
      const messages = request.messages;
      if (!Array.isArray(messages) || messages.length === 0)
        throw new HarnessError(ERROR.llmInvalid, 'The runtime provider requires at least one message.');
      let produced = 0;
      try {
        for await (const chunk of stream(requestFor({ ...request, messages }))) {
          if (request.signal?.aborted) throw new HarnessError(ERROR.llmAborted, 'The model request was cancelled.');
          if (typeof chunk?.delta === 'string' && chunk.delta) {
            produced += chunk.delta.length;
            if (produced > MAX_TEXT) throw new HarnessError(ERROR.llmInvalid, 'The streamed answer is too large.');
            yield { delta: chunk.delta };
          }
          if (chunk?.usage) {
            const inputTokens = counter(chunk.usage.inputTokens ?? chunk.usage.promptTokens);
            const outputTokens = counter(chunk.usage.outputTokens ?? chunk.usage.completionTokens);
            yield {
              usage: {
                ...(inputTokens === undefined ? {} : { inputTokens }),
                ...(outputTokens === undefined ? {} : { outputTokens }),
              },
            };
          }
        }
      } catch (error) {
        if (request.signal?.aborted) throw new HarnessError(ERROR.llmAborted, 'The model request was cancelled.');
        if (error instanceof HarnessError) throw error;
        throw mapProviderError(error, id);
      }
    } } : {}),
  };
}
