// Per-task admission around the existing official provider; no model loop or
// persistent budget/account system. Reuse the reviewed request/usage helpers.
import { boundedDeepseekFetch, measuredUsage, deepseekUsageUpperCny, ACCEPTANCE_LIMITS, DEEPSEEK_PRICES } from './deepseek-acceptance-policy.mjs';
// The 12KB smoke-test wire cap includes schemas and all replayed history; it
// cannot serve as a normal conversation limit. Bound outbound payload size
// separately from billing. Native context projection still preserves unique
// goals/bodies; complete provider usage gates every subsequent request.
export const LOCAL_DEEPSEEK_LIMITS = Object.freeze({ maxRequests: 8, maxRequestBytes: 128 * 1024, maxOutputTokens: 512,
  // A post-usage continuation ceiling, not an alleged pre-send tokenizer bound.
  // The full published context reserve below covers the one unconfirmed send.
  validatedInputTokens: 32000,
  // Official Flash text context is 1M. Reserve 1.1M to cover either decimal or
  // binary interpretation on any one unconfirmed request; do not infer this
  // bound from the SDK's 32k model metadata or a bytes-to-tokens approximation.
  unconfirmedInputTokenReserve: 1100000, maxTaskReserveCny: 2.70,
  normalCompletionUpperCny: 8 * (32000 * 2 + 512 * 8) / 1e6,
  failureInclusiveUpperCny: (7 * (32000 * 2 + 512 * 8) + 1100000 * 2 + 512 * 8) / 1e6,
  priceSource: DEEPSEEK_PRICES.source, priceCheckedOn: DEEPSEEK_PRICES.checkedOn });
export const localDeepseekConfigured = configuration => configuration?.providerId === 'workspace-deepseek'
  && configuration.model === 'deepseek-flash' && configuration.baseUrl === 'https://api.deepseek.com';
const unconfirmedReserveCny = () => deepseekUsageUpperCny(LOCAL_DEEPSEEK_LIMITS.unconfirmedInputTokenReserve, LOCAL_DEEPSEEK_LIMITS.maxOutputTokens);
export function createLocalDeepseekTransport({ configuration, fetchImpl = globalThis.fetch, onStop = () => {} }) {
  if (!localDeepseekConfigured(configuration)) throw Object.assign(Error('LOCAL_PINNED_DEEPSEEK_REQUIRED'), { code: 'LOCAL_PINNED_DEEPSEEK_REQUIRED' });
  const controller = new AbortController();
  const tools = [];
  let actual = 0, confirmed = 0, spent = 0, pending = false, rawUsage = null, stopped = null, contractViolation = false, sealed = false;
  const confirmedUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const reserve = unconfirmedReserveCny();
  function stop(code = 'LOCAL_UNCERTAIN_CHARGE_STOP_DO_NOT_RETRY') {
    stopped ||= code; controller.abort(); onStop();
  }
  function refuse(code) { stop(code); throw Object.assign(new Error(code), { code }); }
  function ready() {
    if (sealed) refuse('LOCAL_TRANSPORT_FINALIZED');
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
  async function fetchText(input, init, disclosure = null) {
    ready();
    try {
      const request = new Request(input, init), body = await request.clone().json();
      if (body.tools === undefined) body.tools = []; // Native provider omits tools for a conversational-only Session.
      if (!Array.isArray(body.messages) || body.messages.length > 64 || !Array.isArray(body.tools) || body.tools.length > 32
        || body.messages.some(m => !['system','developer','user','assistant','tool'].includes(m.role)
          || m.content != null && typeof m.content !== 'string' && !(Array.isArray(m.content)
            && m.content.every(b => b.type === 'text' && typeof b.text === 'string')))) refuse('LOCAL_TEXT_REQUEST_REQUIRED');
      for (const message of body.messages) if (Array.isArray(message.content)) message.content = message.content.map(b => b.text).join('\n');
      return await bounded.fetch(new Request(request, { body: JSON.stringify(body) }), undefined, disclosure);
    } catch (error) { refuse(stopped || error.code || 'LOCAL_PROVIDER_PAYLOAD_REFUSED'); }
  }
  return { signal: controller.signal, stop, seal() { sealed = true; },
    configureTools(names) {
      if (actual || pending || stopped || !Array.isArray(names) || names.length > 32 || new Set(names).size !== names.length
        || names.some(name => typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(name))) refuse('LOCAL_PLUGIN_TOOL_CONFIGURATION_REFUSED');
      tools.splice(0,tools.length,...names);
    },
    fetch: (input, init) => fetchText(input, init),
    async fetchWithDisclosure(input, init, disclosure) {
      if (!disclosure) refuse('FINAL_DISCLOSURE_HOOK_REQUIRED');
      return fetchText(input, init, disclosure);
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
      confirmedUsage.inputTokens += rawUsage.input; confirmedUsage.outputTokens += rawUsage.output; confirmedUsage.totalTokens += rawUsage.total;
    },
    finish() { if (stopped || pending || actual !== confirmed) refuse(stopped || 'LOCAL_UNCERTAIN_USAGE_STOP_DO_NOT_RETRY'); },
    report() { return { actualProviderRequests: actual, confirmedResponses: confirmed, confirmedUsage: { ...confirmedUsage }, confirmedUsageUpperCny: spent,
      chargeUpperCny: contractViolation ? null : spent + (pending ? reserve : 0), billingUncertain: pending,
      stoppedReason: stopped, accountChargedCny: null, limits: LOCAL_DEEPSEEK_LIMITS }; },
  };
}

export const NATIVE_FACTS_PAID_ACCEPTANCE = 'native-facts-deepseek-v1';
const accountingFail = () => { throw Object.assign(Error('LOCAL_ACCEPTANCE_ACCOUNTING_REFUSED'), { code: 'LOCAL_ACCEPTANCE_ACCOUNTING_REFUSED' }); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const sameCost = (a, b) => Number.isFinite(a) && a >= 0 && Math.abs(a - b) <= 1e-10;

// Validate only the original finite report, without copying provider payloads
// or deriving a new tariff. The transport's own complete() remains authoritative.
export function validateLocalDeepseekReport(value, { modelCalls, requireConfirmed = false } = {}) {
  if (!exactKeys(value, ['actualProviderRequests','confirmedResponses','confirmedUsage','confirmedUsageUpperCny',
    'chargeUpperCny','billingUncertain','stoppedReason','accountChargedCny','limits'])
    || !exactKeys(value.confirmedUsage, ['inputTokens','outputTokens','totalTokens'])
    || !exactKeys(value.limits, Object.keys(LOCAL_DEEPSEEK_LIMITS))
    || Object.entries(LOCAL_DEEPSEEK_LIMITS).some(([key, expected]) => value.limits[key] !== expected)) accountingFail();
  const { actualProviderRequests: actual, confirmedResponses: confirmed, confirmedUsage: usage } = value;
  if (![actual,confirmed,...Object.values(usage)].every(nonnegativeInteger)
    || actual > LOCAL_DEEPSEEK_LIMITS.maxRequests || confirmed > actual || actual - confirmed > 1
    || usage.totalTokens !== usage.inputTokens + usage.outputTokens
    || usage.inputTokens > confirmed * LOCAL_DEEPSEEK_LIMITS.validatedInputTokens
    || usage.outputTokens > confirmed * LOCAL_DEEPSEEK_LIMITS.maxOutputTokens
    || confirmed > 0 && usage.inputTokens <= 0
    || value.billingUncertain !== (actual > confirmed) || value.accountChargedCny !== null
    || value.stoppedReason !== null && (typeof value.stoppedReason !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(value.stoppedReason))
    || !sameCost(value.confirmedUsageUpperCny, deepseekUsageUpperCny(usage.inputTokens, usage.outputTokens))) accountingFail();
  // A final report with fewer sends than prepared model calls may be stale.
  // Reserve the whole turn rather than treating that mismatch as confirmed.
  if (modelCalls !== undefined && (!nonnegativeInteger(modelCalls) || actual !== modelCalls)) accountingFail();
  if (value.chargeUpperCny === null) {
    if (value.stoppedReason !== 'LOCAL_PROVIDER_LIMIT_CONTRACT_VIOLATION' || !value.billingUncertain) accountingFail();
  } else if (!sameCost(value.chargeUpperCny, value.confirmedUsageUpperCny + (value.billingUncertain ? unconfirmedReserveCny() : 0))
    || value.chargeUpperCny > LOCAL_DEEPSEEK_LIMITS.maxTaskReserveCny) accountingFail();
  if (requireConfirmed && (actual < 1 || actual !== confirmed || value.billingUncertain || value.stoppedReason !== null
    || value.chargeUpperCny === null || modelCalls !== undefined && actual !== modelCalls)) accountingFail();
  return Object.freeze({ ...value, confirmedUsage: Object.freeze({ ...usage }), limits: LOCAL_DEEPSEEK_LIMITS });
}

// Explicit, finite acceptance-only admission across two original Runs. This is
// not persistent billing. A fresh adapter cannot prove historical allowance;
// its trusted caller must carry forward every prior confirmed/uncertain cost.
export function createNativeDeepseekAcceptance(selection) {
  if (!exactKeys(selection, ['kind','historicalUpperCny']) || selection.kind !== NATIVE_FACTS_PAID_ACCEPTANCE
    || !Number.isFinite(selection.historicalUpperCny) || selection.historicalUpperCny < 0
    || selection.historicalUpperCny + LOCAL_DEEPSEEK_LIMITS.normalCompletionUpperCny
      + LOCAL_DEEPSEEK_LIMITS.maxTaskReserveCny > ACCEPTANCE_LIMITS.remainingCny) accountingFail();
  let carriedUpperCny = selection.historicalUpperCny, turns = 0, activeRun = null, closed = false;
  return Object.freeze({
    stop() { closed = true; },
    begin(runId) {
      if (closed || activeRun !== null || turns >= 2 || typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(runId)
        || carriedUpperCny + LOCAL_DEEPSEEK_LIMITS.maxTaskReserveCny > ACCEPTANCE_LIMITS.remainingCny) accountingFail();
      activeRun = runId; turns++;
    },
    finish(runId, { report, modelCalls, successful }) {
      if (activeRun !== runId || typeof successful !== 'boolean') accountingFail();
      let validated = null;
      try { validated = validateLocalDeepseekReport(report, { modelCalls, requireConfirmed: successful }); } catch {}
      const confirmed = validated !== null && !validated.billingUncertain && validated.chargeUpperCny !== null;
      const reservedUpperCny = confirmed ? validated.chargeUpperCny : LOCAL_DEEPSEEK_LIMITS.maxTaskReserveCny;
      // A reported violation of the provider's published limit invalidates a
      // claimed cost upper bound. Still retain the full reservation and stop.
      carriedUpperCny = validated?.chargeUpperCny === null ? null : carriedUpperCny + reservedUpperCny;
      activeRun = null;
      if (!successful || !confirmed || validated.stoppedReason !== null || turns >= 2) closed = true;
      return Object.freeze({ phase: 'provider-accounting', runId, status: confirmed ? 'confirmed' : 'unconfirmed',
        report: validated, reservedUpperCny, carriedUpperCny });
    },
  });
}
