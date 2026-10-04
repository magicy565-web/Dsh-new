export class ProviderError extends Error {
  constructor(code, message) { super(message); this.name = 'ProviderError'; this.code = code; }
}

export const SUPPORTED_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];

/** Official DeepSeek endpoint only. No fallbacks, credential persistence or tool execution. */
export function createDeepSeekProvider({ apiKey = '', fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
  return {
    configured: Boolean(apiKey.trim()),
    containsCredential: value => Boolean(apiKey && typeof value === 'string' && value.includes(apiKey)),
    async complete({ messages, model, maxTokens = 1600, signal, json = false }) {
      if (!apiKey.trim()) throw new ProviderError('SETUP_REQUIRED', 'Set DEEPSEEK_API_KEY in the server environment and restart to enable DeepSeek. Your work is saved.');
      if (!SUPPORTED_MODELS.includes(model)) throw new ProviderError('INVALID_MODEL', 'Select a supported DeepSeek model.');
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
  };
}
