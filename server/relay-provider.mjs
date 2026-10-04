import { ProviderError } from './provider.mjs';

// The sole relay destination is verified from FastAIToken's official quickstart.
// No browser/API input can choose an endpoint, credential or model allowlist.
export const FASTAITOKEN_ENDPOINT = 'https://www.fastaitoken.com/v1/chat/completions';
export function createFastAITokenProvider({ apiKey = '', model = '', fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
  if (typeof apiKey !== 'string' || typeof model !== 'string' || model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) throw new Error('FASTAITOKEN_MODEL must be a documented chat-compatible model identifier.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid relay timeout.');
  const setupMessage = 'Set a newly authorized FASTAITOKEN_API_KEY and an approved FASTAITOKEN_MODEL in the server environment, then restart. No model or test spending is selected automatically.';
  return {
    provider: 'fastaitoken', kind: 'fastaitoken-api', configured: Boolean(apiKey.trim() && model), model: model || 'not-configured', models: model ? [model] : [], setupMessage,
    containsCredential: value => Boolean(apiKey && typeof value === 'string' && value.includes(apiKey)),
    capabilities: ['text_chat', 'bounded_text_goal_loop', 'conversation_history', 'explicit_memory_crud', 'saved_text_outputs'],
    limitations: ['Chat Completions compatibility is documented, not live-validated. The selected model must support non-streaming text and JSON response_format for goals.', 'Requests send conversation context and applicable saved memories to FastAIToken and its routed model provider only after you start them.', 'Relay use does not grant browser, shell, native Harness or external connector capabilities.', 'Key/model presence is configuration readiness only; spending and live connection require separate approval.'],
    async complete({ messages, model: selected, maxTokens = 1600, signal, json = false }) {
      if (!apiKey.trim() || !model) throw new ProviderError('SETUP_REQUIRED', setupMessage);
      if (selected !== model) throw new ProviderError('INVALID_MODEL', 'Use the model approved in the relay server configuration.');
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1600) throw new ProviderError('INVALID_INPUT', 'Output token limit is invalid.');
      if (signal?.aborted) throw new ProviderError('CANCELLED', 'The request was stopped.');
      const timeout = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try {
        response = await fetchImpl(FASTAITOKEN_ENDPOINT, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages, stream: false, max_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}) }), signal: combined });
      } catch {
        if (signal?.aborted) throw new ProviderError('CANCELLED', 'The request was stopped.');
        if (timeout.aborted) throw new ProviderError('PROVIDER_TIMEOUT', 'The relay did not respond before the request limit.');
        throw new ProviderError('PROVIDER_UNREACHABLE', 'The relay could not be reached safely. Check network and endpoint availability.');
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const codes = { 401: 'PROVIDER_AUTH', 402: 'PROVIDER_BALANCE', 403: 'PROVIDER_FORBIDDEN', 429: 'PROVIDER_RATE_LIMIT' };
        throw new ProviderError(codes[response.status] || 'PROVIDER_ERROR', `The relay rejected the request (HTTP ${response.status}). Check account/model access and limits; no automatic retry was made.`);
      }
      let data;
      try {
        const reader = response.body?.getReader(); if (!reader) throw new Error();
        let size = 0; const chunks = [];
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1_000_000) { await reader.cancel(); throw new Error(); } chunks.push(value); }
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        if (signal?.aborted) throw new ProviderError('CANCELLED', 'The request was stopped.');
        if (timeout.aborted) throw new ProviderError('PROVIDER_TIMEOUT', 'The relay did not respond before the request limit.');
        throw new ProviderError('INVALID_RESPONSE', 'The relay returned an unreadable or oversized response.');
      }
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length') throw new ProviderError('OUTPUT_LIMIT', 'The reply reached the output limit. Try a smaller task.');
      if (choice?.message?.tool_calls?.length || choice?.message?.function_call) throw new ProviderError('UNSUPPORTED_TOOL_CALL', 'This relay adapter only supports text; tool calls are not executed.');
      if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new ProviderError('EMPTY_RESPONSE', 'The relay returned no text.');
      const counter = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
      return { content: choice.message.content.slice(0, 80_000), usage: data.usage ? { promptTokens: counter(data.usage.prompt_tokens), completionTokens: counter(data.usage.completion_tokens), totalTokens: counter(data.usage.total_tokens) } : null };
    },
  };
}
