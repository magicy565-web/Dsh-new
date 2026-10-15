// Per-task admission around the existing official provider; no model loop or
// persistent budget/account system. Reuse the reviewed request/usage helpers.
import { boundedDeepseekFetch, measuredUsage, DEEPSEEK_PRICES } from './deepseek-acceptance-policy.mjs';
export const LOCAL_DEEPSEEK_LIMITS = Object.freeze({ maxRequests: 8, maxRequestBytes: 12000, maxOutputTokens: 512,
  validatedInputTokens: 32000,
  // Official Flash text context is 1M. Reserve 1.1M to cover either decimal or
  // binary interpretation on any one unconfirmed request; do not infer this
  // bound from the SDK's 32k model metadata or a bytes-to-tokens approximation.
  unconfirmedInputTokenReserve: 1100000, maxTaskReserveCny: 2.70,
  normalCompletionUpperCny: 8 * (32000 * 2 + 512 * 8) / 1e6,
  failureInclusiveUpperCny: (7 * (32000 * 2 + 512 * 8) + 1100000 * 2 + 512 * 8) / 1e6,
  priceSource: DEEPSEEK_PRICES.source, priceCheckedOn: DEEPSEEK_PRICES.checkedOn });
const tools = ['read','write','workspace_factory_capabilities','workspace_factory_rfq_requirements','workspace_factory_match_prepare'];
export const localDeepseekConfigured = configuration => configuration?.providerId === 'workspace-deepseek'
  && configuration.model === 'deepseek-flash' && configuration.baseUrl === 'https://api.deepseek.com';
export function createLocalDeepseekTransport({ configuration, fetchImpl = globalThis.fetch, onStop = () => {} }) {
  if (!localDeepseekConfigured(configuration)) throw Object.assign(Error('LOCAL_PINNED_DEEPSEEK_REQUIRED'), { code: 'LOCAL_PINNED_DEEPSEEK_REQUIRED' });
  const controller = new AbortController();
  let actual = 0, confirmed = 0, spent = 0, pending = false, rawUsage = null, stopped = null, contractViolation = false;
  const reserve = (LOCAL_DEEPSEEK_LIMITS.unconfirmedInputTokenReserve * DEEPSEEK_PRICES.inputPeakCnyPerMillion
    + LOCAL_DEEPSEEK_LIMITS.maxOutputTokens * DEEPSEEK_PRICES.outputPeakCnyPerMillion) / 1e6;
  function stop(code = 'LOCAL_UNCERTAIN_CHARGE_STOP_DO_NOT_RETRY') {
    stopped ||= code; controller.abort(); onStop();
  }
  function refuse(code) { stop(code); throw Object.assign(new Error(code), { code }); }
  function ready() {
    if (stopped || pending) refuse(stopped || 'LOCAL_UNCONFIRMED_REQUEST_STOP_DO_NOT_RETRY');
    if (actual >= LOCAL_DEEPSEEK_LIMITS.maxRequests) refuse('LOCAL_ACTUAL_REQUEST_LIMIT');
    if (spent + reserve > LOCAL_DEEPSEEK_LIMITS.maxTaskReserveCny) refuse('LOCAL_COST_RESERVE_EXCEEDED');
  }
  const bounded = boundedDeepseekFetch(async request => {
    ready(); pending = true; rawUsage = null; actual++;
    try {
      const response = await fetchImpl(request);
      if (!response.ok) stop('LOCAL_PROVIDER_HTTP_ERROR_STOP_DO_NOT_RETRY');
      return response;
    } catch { refuse('LOCAL_UNCERTAIN_CHARGE_STOP_DO_NOT_RETRY'); }
  }, { maxModelCalls: LOCAL_DEEPSEEK_LIMITS.maxRequests, maxRequestBytes: LOCAL_DEEPSEEK_LIMITS.maxRequestBytes,
    maxOutputTokens: LOCAL_DEEPSEEK_LIMITS.maxOutputTokens, allowedToolNames: tools });
  return { signal: controller.signal, stop,
    async fetch(input, init) {
      ready();
      try {
        const request = new Request(input, init), body = await request.clone().json();
        if (!Array.isArray(body.messages) || body.messages.length > 64 || !Array.isArray(body.tools) || body.tools.length > 5
          || body.messages.some(m => !['system','developer','user','assistant','tool'].includes(m.role)
            || m.content != null && typeof m.content !== 'string' && !(Array.isArray(m.content)
              && m.content.every(b => b.type === 'text' && typeof b.text === 'string')))) refuse('LOCAL_TEXT_REQUEST_REQUIRED');
        for (const message of body.messages) if (Array.isArray(message.content)) message.content = message.content.map(b => b.text).join('\n');
        return await bounded.fetch(new Request(request, { body: JSON.stringify(body) }));
      } catch (error) { refuse(stopped || error.code || 'LOCAL_PROVIDER_PAYLOAD_REFUSED'); }
    },
    onSseEvent(event) {
      if (stopped || !event.data || event.data === '[DONE]') return;
      try {
        const frame = JSON.parse(event.data);
        if (frame.error) { stop('LOCAL_PROVIDER_STREAM_ERROR_STOP_DO_NOT_RETRY'); return; }
        if (!frame.usage) return;
        const u = frame.usage;
        if (!['prompt_tokens','completion_tokens','total_tokens'].every(k => Number.isSafeInteger(u[k]) && u[k] >= 0)
          || u.prompt_tokens <= 0 || u.total_tokens !== u.prompt_tokens + u.completion_tokens
          || ['prompt_cache_hit_tokens','prompt_cache_miss_tokens'].some(k => u[k] !== undefined && (!Number.isSafeInteger(u[k]) || u[k] < 0 || u[k] > u.prompt_tokens))) {
          stop('LOCAL_UNCERTAIN_USAGE_STOP_DO_NOT_RETRY'); return;
        }
        if (u.prompt_tokens > LOCAL_DEEPSEEK_LIMITS.unconfirmedInputTokenReserve || u.completion_tokens > LOCAL_DEEPSEEK_LIMITS.maxOutputTokens) {
          contractViolation = true; stop('LOCAL_PROVIDER_LIMIT_CONTRACT_VIOLATION'); return;
        }
        rawUsage = { input: u.prompt_tokens, output: u.completion_tokens, total: u.total_tokens };
      } catch { stop('LOCAL_UNCERTAIN_USAGE_STOP_DO_NOT_RETRY'); }
    },
    complete(message) {
      if (stopped || !pending || !rawUsage || rawUsage.input > LOCAL_DEEPSEEK_LIMITS.validatedInputTokens)
        refuse(stopped || 'LOCAL_UNCERTAIN_USAGE_STOP_DO_NOT_RETRY');
      let measured;
      try { measured = measuredUsage([message]); } catch { refuse('LOCAL_UNCERTAIN_USAGE_STOP_DO_NOT_RETRY'); }
      const u = message.usage;
      if (u.input + u.cacheRead + u.cacheWrite !== rawUsage.input || u.output !== rawUsage.output || u.totalTokens !== rawUsage.total
        || !message.content?.some(b => b.type === 'toolCall' || b.type === 'text' && b.text.trim())) refuse('LOCAL_UNCERTAIN_USAGE_STOP_DO_NOT_RETRY');
      spent += measured.usageUpperCny; confirmed++; pending = false;
    },
    finish() { if (stopped || pending || actual !== confirmed) refuse(stopped || 'LOCAL_UNCERTAIN_USAGE_STOP_DO_NOT_RETRY'); },
    report() { return { actualProviderRequests: actual, confirmedResponses: confirmed, confirmedUsageUpperCny: spent,
      chargeUpperCny: contractViolation ? null : spent + (pending ? reserve : 0), billingUncertain: pending,
      stoppedReason: stopped, accountChargedCny: null, limits: LOCAL_DEEPSEEK_LIMITS }; },
  };
}
