const token = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const PI_REQUEST_LIMIT = 4;

// OpenAI-compatible pi-ai initializes a Usage object to zeros before any wire
// usage exists. Observe raw SDK events rather than treating those defaults as
// billing evidence. Store only validated counters, never raw provider payloads.
export function openAIUsage(event) {
  const raw = event?.usage || event?.choices?.[0]?.usage;
  if (!raw || typeof raw !== 'object') return null;
  const promptTokens = token(raw.prompt_tokens), completionTokens = token(raw.completion_tokens);
  const totalTokens = token(raw.total_tokens);
  const cacheReadTokens = token(raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens ?? raw.cached_tokens ?? 0);
  const cacheWriteTokens = token(raw.prompt_tokens_details?.cache_write_tokens ?? 0);
  if (promptTokens !== null && (cacheReadTokens === null || cacheWriteTokens === null || cacheReadTokens + cacheWriteTokens > promptTokens)) return null;
  if (promptTokens !== null && completionTokens !== null && totalTokens !== null && totalTokens !== promptTokens + completionTokens) return null;
  return { promptTokens, completionTokens, totalTokens, cacheReadTokens, cacheWriteTokens };
}

export function explicitPiUsage(usage) {
  if (!usage) return null;
  const input = token(usage.input), cacheReadTokens = token(usage.cacheRead), cacheWriteTokens = token(usage.cacheWrite);
  return { promptTokens: [input, cacheReadTokens, cacheWriteTokens].includes(null) ? null : input + cacheReadTokens + cacheWriteTokens,
    completionTokens: token(usage.output), totalTokens: token(usage.totalTokens), cacheReadTokens, cacheWriteTokens };
}

export function requestAllowance(active) {
  if (!Array.isArray(active.requests)) throw new Error('A persisted Pi invocation has no verifiable request reservations.');
  const consumed = active.requests.reduce((sum, request) => sum + (request.usage?.completionTokens ?? request.maxTokens), 0);
  const remaining = active.maxTokens - consumed, slots = PI_REQUEST_LIMIT - active.requests.length;
  if (slots < 1 || remaining < 1) return 0;
  // Keep capacity for subsequent tool rounds. Missing/uncertain requests consume
  // their entire issued ceiling, including a process crash before settlement.
  return Math.max(1, Math.floor(remaining / slots));
}

export function invocationUsage(requests) {
  const result = {};
  for (const key of ['promptTokens', 'completionTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens'])
    result[key] = !requests?.length || requests.some(request => request.usage?.[key] == null) ? null : requests.reduce((sum, request) => sum + request.usage[key], 0);
  return result;
}
