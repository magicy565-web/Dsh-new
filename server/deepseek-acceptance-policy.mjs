import { createHash } from 'node:crypto';
import { loadPiProviderConfig } from './pi-provider-config.mjs';
import { looksLikeCredential } from '../packages/workspace-procurement/src/public-input.mjs';

export const ACCEPTANCE_LIMITS = Object.freeze({ maxModelCalls: 3, contextWindow: 128000, maxOutputTokens: 1600 });
export const ACCEPTANCE_ENV_NAMES = Object.freeze(['PI_PROVIDER', 'PI_MODEL', 'PI_BASE_URL', 'DEEPSEEK_API_KEY',
  'WS_AGENT_URL', 'WS_AGENT_TOKEN', 'WORKSPACE_OMP_PROVIDER_COST_JSON', 'WORKSPACE_OMP_LIVE_BUDGET_VERIFIED',
  'WORKSPACE_DEEPSEEK_BUDGET_EVIDENCE']);
export const presence = (environment = {}) => Object.fromEntries(ACCEPTANCE_ENV_NAMES.map(name =>
  [name, typeof environment[name] === 'string' && environment[name].trim().length > 0]));
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function acceptanceConfiguration(environment = {}) {
  if (environment.PI_PROVIDER !== 'deepseek') fail('EXPLICIT_DEEPSEEK_PROVIDER_REQUIRED');
  let configuration;
  try { configuration = loadPiProviderConfig(environment); } catch { fail('PINNED_DEEPSEEK_MODEL_CONFIGURATION_REQUIRED'); }
  if (!configuration.apiKey.trim()) fail('DEEPSEEK_KEY_NOT_BOUND');
  if (!environment.WS_AGENT_URL || !environment.WS_AGENT_TOKEN) fail('EXISTING_WORKSPACE_BINDING_REQUIRED');
  return configuration;
}

// This validates a maintainer's reconciled billing attestation; it cannot query
// or independently certify an account. Flags alone are never balance evidence.
export function validateBudgetEvidence(value, model, now = Date.now()) {
  const fresh = Date.parse(value?.verifiedAt), expiry = Date.parse(value?.expiresAt);
  const reference = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(x);
  if (value?.schema !== 'workspace.deepseek-readonly-budget.v1' || value.provider !== 'workspace-deepseek'
    || value.model !== model || !reference(value.receiptId) || !reference(value.billingEvidenceRef)
    || !reference(value.priceEvidenceRef) || !reference(value.hardCapEvidenceRef)
    || value.hardCapVerified !== true || value.currency !== 'CNY' || value.approvedCapCny !== 5
    || !Number.isFinite(fresh) || !Number.isFinite(expiry) || fresh > now || now - fresh > 15 * 60_000
    || expiry <= now || expiry > fresh + 60 * 60_000) fail('RECONCILED_BUDGET_EVIDENCE_REQUIRED');
  const { spentCny, remainingCny, inputUpperCnyPerMillion, outputUpperCnyPerMillion } = value;
  if (![spentCny, remainingCny, inputUpperCnyPerMillion, outputUpperCnyPerMillion].every(Number.isFinite)
    || spentCny < 0 || spentCny >= 5 || remainingCny <= 0 || remainingCny > 5
    || Math.abs(spentCny + remainingCny - 5) > 1e-9
    || inputUpperCnyPerMillion <= 0 || outputUpperCnyPerMillion <= 0) fail('CUMULATIVE_REMAINDER_AND_PRICES_REQUIRED');
  const { maxModelCalls, contextWindow, maxOutputTokens } = ACCEPTANCE_LIMITS;
  const ceilingCny = Math.ceil(maxModelCalls * (contextWindow * inputUpperCnyPerMillion + maxOutputTokens * outputUpperCnyPerMillion)) / 1_000_000;
  if (ceilingCny > remainingCny) fail('VERIFIED_REMAINDER_TOO_SMALL');
  return { ceilingCny, remainingCny, expiresAt: expiry, receiptId: value.receiptId,
    evidenceSha256: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

export function modelAdmission(configuration, budget, now = Date.now) {
  let calls = 0;
  return { calls: () => calls, async beforeModelRequest({ model, context }) {
    if (now() >= budget.expiresAt) fail('BUDGET_EVIDENCE_EXPIRED');
    if (model.provider !== configuration.providerId || model.id !== configuration.model
      || model.baseUrl !== configuration.baseUrl || model.contextWindow !== ACCEPTANCE_LIMITS.contextWindow
      || model.maxTokens > ACCEPTANCE_LIMITS.maxOutputTokens) fail('MODEL_RECEIVER_CHANGED');
    // Byte bound is deliberately conservative relative to the pinned 128k
    // context, including messages/tool schemas; never infer free input usage.
    if (Buffer.byteLength(JSON.stringify(context), 'utf8') > 120_000) fail('ACCEPTANCE_CONTEXT_LIMIT');
    if (calls >= ACCEPTANCE_LIMITS.maxModelCalls) fail('ACCEPTANCE_MODEL_CALL_LIMIT');
    calls++;
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
