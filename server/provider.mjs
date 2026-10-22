export class ProviderError extends Error {
  constructor(code, message) { super(message); this.name = 'ProviderError'; this.code = code; }
}

export const SUPPORTED_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];

const HTTP_ERRORS = {
  401: ['PROVIDER_AUTH', 'DeepSeek rejected the API key. Check DEEPSEEK_API_KEY and restart the server.'],
  402: ['PROVIDER_BALANCE', 'The DeepSeek account has insufficient balance.'],
  429: ['PROVIDER_RATE_LIMIT', 'DeepSeek is rate limiting requests. Please retry later.'],
};

const mapUsage = usage => usage ? {
  promptTokens: Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0 ? usage.prompt_tokens : null,
  completionTokens: Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0 ? usage.completion_tokens : null,
  totalTokens: Number.isSafeInteger(usage.total_tokens) && usage.total_tokens >= 0 ? usage.total_tokens : null,
} : null;

const httpError = status => HTTP_ERRORS[status]
  || ['PROVIDER_ERROR', `DeepSeek returned HTTP ${status}. Please retry later.`];

/** Official DeepSeek endpoint only. No fallbacks, credential persistence or tool execution. */
export function createDeepSeekProvider({ apiKey = '', fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
  const requireConfigured = model => {
    if (!apiKey.trim()) throw new ProviderError('SETUP_REQUIRED', 'Set DEEPSEEK_API_KEY in the server environment and restart to enable DeepSeek. Your work is saved.');
    if (!SUPPORTED_MODELS.includes(model)) throw new ProviderError('INVALID_MODEL', 'Select a supported DeepSeek model.');
  };
  return {
    configured: Boolean(apiKey.trim()),
    containsCredential: value => Boolean(apiKey && typeof value === 'string' && value.includes(apiKey)),
    async complete({ messages, model, maxTokens = 1600, signal, json = false }) {
      requireConfigured(model);
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try {
        response = await fetchImpl('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages, thinking: { type: 'disabled' }, stream: false, max_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
          signal: combined,
        });
      } catch {
        if (signal?.aborted) throw new ProviderError('CANCELLED', 'The request was stopped.');
        if (timeout.aborted) throw new ProviderError('PROVIDER_TIMEOUT', 'DeepSeek did not respond before the request time limit. You can retry.');
        throw new ProviderError('PROVIDER_UNREACHABLE', 'DeepSeek could not be reached. Check your connection and try again.');
      }
      if (!response.ok) {
        const errors = {
          401: ['PROVIDER_AUTH', 'DeepSeek rejected the API key. Check DEEPSEEK_API_KEY and restart the server.'],
          402: ['PROVIDER_BALANCE', 'The DeepSeek account has insufficient balance.'],
          429: ['PROVIDER_RATE_LIMIT', 'DeepSeek is rate limiting requests. Please retry later.'],
        };
        const [code, message] = errors[response.status] || ['PROVIDER_ERROR', `DeepSeek returned HTTP ${response.status}. Please retry later.`];
        await response.body?.cancel().catch(() => {});
        throw new ProviderError(code, message);
      }
      let data;
      try {
        // Bound untrusted response size before JSON parsing; never expose raw provider errors.
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Missing response body');
        let bytes = 0;
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1_000_000) { await reader.cancel(); throw new Error('Response too large'); }
          chunks.push(value);
        }
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        if (signal?.aborted) throw new ProviderError('CANCELLED', 'The request was stopped.');
        if (timeout.aborted) throw new ProviderError('PROVIDER_TIMEOUT', 'DeepSeek did not respond before the request time limit. You can retry.');
        throw new ProviderError('INVALID_RESPONSE', 'DeepSeek returned an unreadable response. Please retry.');
      }
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length') throw new ProviderError('OUTPUT_LIMIT', 'The response reached the output token limit. Try a smaller request.');
      if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new ProviderError('EMPTY_RESPONSE', 'DeepSeek returned no text. Please retry.');
      const counter = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
      return { content: choice.message.content.slice(0, 80_000), usage: data.usage ? { promptTokens: counter(data.usage.prompt_tokens), completionTokens: counter(data.usage.completion_tokens), totalTokens: counter(data.usage.total_tokens) } : null };
    },

    /**
     * Streaming completion over SSE. Yields `{ delta }` text chunks and a final
     * `{ usage }`. Provider error text is mapped to bounded codes and never
     * forwarded, and the stream is bounded in both bytes and characters.
     */
    async *stream({ messages, model, maxTokens = 1600, signal, json = false }) {
      requireConfigured(model);
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try {
        response = await fetchImpl('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model, messages, thinking: { type: 'disabled' }, stream: true,
            stream_options: { include_usage: true }, max_tokens: maxTokens,
            ...(json ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: combined,
        });
      } catch {
        if (signal?.aborted) throw new ProviderError('CANCELLED', 'The request was stopped.');
        if (timeout.aborted) throw new ProviderError('PROVIDER_TIMEOUT', 'DeepSeek did not respond before the request time limit. You can retry.');
        throw new ProviderError('PROVIDER_UNREACHABLE', 'DeepSeek could not be reached. Check your connection and try again.');
      }
      if (!response.ok) {
        const [code, message] = httpError(response.status);
        await response.body?.cancel().catch(() => {});
        throw new ProviderError(code, message);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ProviderError('INVALID_RESPONSE', 'DeepSeek returned an unreadable response. Please retry.');
      const decoder = new TextDecoder();
      let buffer = '';
      let bytes = 0;
      let total = 0;
      let usage = null;
      let finished = false;
      try {
        while (!finished) {
          let chunk;
          try {
            chunk = await reader.read();
          } catch {
            if (signal?.aborted) throw new ProviderError('CANCELLED', 'The request was stopped.');
            if (timeout.aborted) throw new ProviderError('PROVIDER_TIMEOUT', 'DeepSeek did not respond before the request time limit. You can retry.');
            throw new ProviderError('INVALID_RESPONSE', 'DeepSeek returned an unreadable response. Please retry.');
          }
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 2_000_000) throw new ProviderError('INVALID_RESPONSE', 'DeepSeek returned an oversized response. Please retry.');
          buffer += decoder.decode(chunk.value, { stream: true });
          let index;
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (!line || line.startsWith(':')) continue;
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') { finished = true; break; }
            let event;
            try { event = JSON.parse(payload); } catch { throw new ProviderError('INVALID_RESPONSE', 'DeepSeek returned an unreadable response. Please retry.'); }
            if (event.usage) usage = mapUsage(event.usage);
            const choice = event.choices?.[0];
            const delta = choice?.delta?.content;
            if (typeof delta === 'string' && delta) {
              total += delta.length;
              if (total > 80_000) throw new ProviderError('OUTPUT_LIMIT', 'The response reached the output token limit. Try a smaller request.');
              yield { delta };
            }
            if (choice?.finish_reason === 'length') throw new ProviderError('OUTPUT_LIMIT', 'The response reached the output token limit. Try a smaller request.');
          }
        }
        yield { usage };
      } finally {
        await reader.cancel().catch(() => {});
      }
    },
  };
}
