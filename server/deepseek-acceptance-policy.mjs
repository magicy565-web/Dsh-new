import { createHash } from 'node:crypto';
import { looksLikeCredential } from '../packages/workspace-procurement/src/public-input.mjs';
import { workspaceOmpConfiguration } from './workspace-omp-host.mjs';

// User reconfirmed the total remaining allowance as CNY5. No historical billing
// JSON, freshness window, external hard-cap attestation or file reservation.
export const ACCEPTANCE_LIMITS = Object.freeze({ remainingCny: 5, maxModelCalls: 2, maxOutputTokens: 512, maxRequestBytes: 12000 });
export const DEEPSEEK_PRICES = Object.freeze({ checkedOn: '2026-10-15',
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  inputPeakCnyPerMillion: 2, outputPeakCnyPerMillion: 8,
  ompUsdPerMillion: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0.3 } });
export const ACCEPTANCE_ENV_NAMES = Object.freeze(['DEEPSEEK_API_KEY', 'WS_AGENT_URL', 'WS_AGENT_TOKEN']);
export const presence = (environment = {}) => Object.fromEntries(ACCEPTANCE_ENV_NAMES.map(name =>
  [name, typeof environment[name] === 'string' && environment[name].trim().length > 0]));
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function acceptanceConfiguration(environment = {}) {
  return workspaceOmpConfiguration({ PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-flash',
    DEEPSEEK_API_KEY: environment.DEEPSEEK_API_KEY || '',
    WORKSPACE_OMP_PROVIDER_COST_JSON: JSON.stringify(DEEPSEEK_PRICES.ompUsdPerMillion),
    WORKSPACE_OMP_LIVE_BUDGET_VERIFIED: '1' });
}
export function measuredUsage(messages) {
  const responses = messages.filter(m => m.role === 'assistant');
  let upperCny = 0;
  for (const message of responses) {
    const u = message.usage;
    if (!['stop', 'toolUse'].includes(message.stopReason) || !u
      || !['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].every(k => Number.isSafeInteger(u[k]) && u[k] >= 0)
      || u.totalTokens <= 0 || u.input + u.output + u.cacheRead + u.cacheWrite === 0
      || u.output > 512 || u.totalTokens > 32512) fail('UNCERTAIN_USAGE_STOP_DO_NOT_RETRY');
    upperCny += ((u.input + u.cacheRead + u.cacheWrite) * 2 + u.output * 8) / 1e6;
  }
  if (upperCny > ACCEPTANCE_LIMITS.remainingCny) fail('REMAINING_BUDGET_EXCEEDED');
  return { responses: responses.length, usageUpperCny: upperCny };
}

// Transport restriction only; original OMP owns the model/tool/session loop.
// A caller must also stop SDK retries/replay after any uncertain result.
export function boundedDeepseekFetch(fetchImpl, { maxModelCalls = ACCEPTANCE_LIMITS.maxModelCalls, maxOutputTokens = ACCEPTANCE_LIMITS.maxOutputTokens,
  maxRequestBytes = ACCEPTANCE_LIMITS.maxRequestBytes, allowedToolNames = ['workspace_business_tasks'] } = {}) {
  let requests = 0, uncertain = false;
  return { requests: () => requests, fetch: async (input, init) => {
    if (uncertain || requests >= maxModelCalls) fail('UNCERTAIN_OR_EXHAUSTED_STOP_DO_NOT_RETRY');
    const request = new Request(input, init);
    if (request.url !== 'https://api.deepseek.com/chat/completions' || request.method !== 'POST') fail('PINNED_DEEPSEEK_REQUEST_REQUIRED');
    const text = await request.text();
    if (Buffer.byteLength(text) > maxRequestBytes) fail('SHORT_INPUT_LIMIT');
    const body = JSON.parse(text);
    if (body.model !== 'deepseek-flash' || body.tools?.some(t => !allowedToolNames.includes(t.function?.name))) fail('PINNED_READONLY_MODEL_REQUIRED');
    body.max_tokens = Math.min(body.max_tokens || maxOutputTokens, maxOutputTokens);
    if (!Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1) fail('SHORT_OUTPUT_LIMIT');
    body.thinking = { type: 'disabled' };
    delete body.max_completion_tokens; delete body.reasoning_effort; delete body.store; delete body.prompt_cache_retention;
    for (const m of body.messages || []) if (m.role === 'developer') m.role = 'system';
    for (const t of body.tools || []) delete t.function.strict;
    if (Buffer.byteLength(JSON.stringify(body)) > maxRequestBytes) fail('SHORT_INPUT_LIMIT');
    requests++;
    try { const response = await fetchImpl(new Request(request, { body: JSON.stringify(body), redirect: 'error' }));
      if (!response.ok) uncertain = true; return response;
    } catch { uncertain = true; fail('UNCERTAIN_CHARGE_STOP_DO_NOT_RETRY'); }
  } };
}

// A second boundary under the tool allowlist. Even a forged/hidden tool cannot
// submit, approve, resume, cancel, read Library or follow an arbitrary URL.
export function readonlyWorkspaceFetch(baseURL, fetchImpl = globalThis.fetch) {
  let base; try { base = new URL(baseURL); } catch { fail('EXISTING_WORKSPACE_BINDING_REQUIRED'); }
  return async (input, init = {}) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== base.origin || url.username || url.password || url.hash
      || !['/api/agent/v1/health', '/api/agent/v1/presets', '/api/agent/v1/tasks'].includes(url.pathname)
      || [...url.searchParams.keys()].some(key => !['limit', 'status'].includes(key))) fail('READONLY_WORKSPACE_REQUEST_REFUSED');
    return fetchImpl(request, { redirect: 'error' });
  };
}

export function verifyReadonlyAnswer(messages) {
  const receipts = messages.filter(m => m.role === 'toolResult');
  if (!receipts.length || receipts.some(m => m.toolName !== 'workspace_business_tasks' || m.isError)) fail('ORIGINAL_READONLY_RECEIPT_REQUIRED');
  let receipt;
  try { receipt = JSON.parse(receipts.at(-1).content.filter(b => b.type === 'text').map(b => b.text).join('\n')); }
  catch { fail('ORIGINAL_READONLY_RECEIPT_REQUIRED'); }
  const final = messages.at(-1), answer = final?.content?.filter(b => b.type === 'text').map(b => b.text).join('\n');
  if (final?.role !== 'assistant' || final.stopReason !== 'stop' || !answer || !['available', 'empty'].includes(receipt.status)
    || !Array.isArray(receipt.tasks) || !Array.isArray(receipt.sources)) fail('SOURCE_ANSWER_INCOMPLETE');
  if (!receipt.tasks.length) fail('NO_AUTHORIZED_RECORDS_FOR_CITATION');
  const cited = receipt.sources.filter(source => source.kind === 'task' && receipt.tasks.some(t => t.taskId === source.recordId)
    && answer.includes(source.recordId) && answer.includes(source.api));
  if (!cited.length) fail('ORIGINAL_SOURCE_CITATION_MISSING');
  if (looksLikeCredential(answer)) fail('UNSAFE_ANSWER_REFUSED');
  return { status: 'passed', answer, sources: cited.map(({ kind, recordId, api }) => ({ kind, recordId, api })),
    answerSha256: createHash('sha256').update(answer).digest('hex'),
    citedSourceCount: cited.length, toolReceipts: receipts.length, semanticAccuracy: 'requires-human-review' };
}
