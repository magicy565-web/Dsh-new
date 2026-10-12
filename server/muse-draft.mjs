import { randomUUID } from 'node:crypto';
import { capabilityPayloadHash as hash } from './capabilities.mjs';
import { looksLikeCredential } from './security.mjs';

export class MuseDraftError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new MuseDraftError(status, code, message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const MUSE_DRAFT_FIELDS = ['serviceId', 'product', 'market', 'objective', 'budgetCredits', 'deadlineAt'];
const labels = { serviceId: '原服务目录中的服务名称或 ID', product: '具体产品', market: '目标市场', objective: '任务目标', budgetCredits: '最高预算（内部 credits）', deadlineAt: '含时区的明确期限' };
const limits = { serviceId: 128, product: 240, market: 100, objective: 2500, deadlineAt: 80 };
const blank = () => ({ serviceId: null, product: null, market: null, objective: null, budgetCredits: null, deadlineAt: null, publicDataConfirmed: false });
const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, fields) => object(value) && Object.keys(value).every(name => fields.includes(name));
const registry = state => state.workspaceMuseDrafts ||= { version: 1, drafts: [] };
const publicText = scope => MUSE_DRAFT_FIELDS.map(field => `${labels[field]}：${scope[field] ?? '待补充'}`).join('\n');
const reviewHash = (context, scope) => hash({ schema: 'workspace.muse.draft.v1', draftId: context.draftId, revision: context.revision,
  conversationId: context.conversationId, subject: context.subject, requestId: context.requestId, scope, productReference: context.productReference, publicText: publicText(scope) });

export function findMuseDraft(state, actor, conversationId, id) {
  const draft = (state.workspaceMuseDrafts?.drafts || []).find(item => item.id === id && item.subject === actor.subject && item.conversationId === conversationId);
  if (!draft) fail(404, 'MUSE_DRAFT_NOT_FOUND', 'Use the original owner conversation and draft.');
  return draft;
}

export function assertDraftProduct(state, conversationId, reference, snapshot) {
  if (!reference) return null;
  if (!exact(reference, ['productId', 'productRevision']) || typeof reference.productId !== 'string' || !Number.isSafeInteger(reference.productRevision)) fail(400, 'MUSE_DRAFT_REFERENCE_INVALID', 'Select an exact existing product reference.');
  const binding = state.businessLibrary?.conversationReferences?.find(item => item.conversationId === conversationId);
  const product = state.businessLibrary?.products?.find(item => item.id === reference.productId && item.revision === reference.productRevision);
  if (!product || !binding?.products?.some(item => item.productId === reference.productId && item.productRevision === reference.productRevision) || snapshot && snapshot.name !== product.name)
    fail(409, 'MUSE_DRAFT_REFERENCE_CHANGED', 'The original referenced product revision changed. Review and select it again.');
  return { ...reference, name: product.name };
}

export function draftAdmission(state, actor, conversationId, body, services, draftId) {
  if (!exact(body, ['requestId', 'content', 'expectedRevision', 'productReference', 'inputContext']) || !key(body.requestId) || typeof body.content !== 'string' || !body.content.trim() || body.content.length > 4000 || looksLikeCredential(body.content))
    fail(400, 'MUSE_DRAFT_INPUT', 'Use an original requestId and bounded, non-credential goal or clarification text.');
  const fingerprint = hash({ ...body, content: body.content.trim(), draftId: draftId || null });
  const existing = (state.workspaceMuseDrafts?.drafts || []).find(draft => draft.subject === actor.subject && draft.conversationId === conversationId && draft.versions.some(version => version.context.requestId === body.requestId));
  if (existing) {
    const previous = existing.versions.find(version => version.context.requestId === body.requestId);
    if (previous.context.fingerprint !== fingerprint || draftId && existing.id !== draftId) fail(409, 'IDEMPOTENCY_CONFLICT', 'This draft requestId already identifies another exact message.');
    return structuredClone(previous.context);
  }
  const draft = draftId ? findMuseDraft(state, actor, conversationId, draftId) : null;
  if (draft && (draft.prepare || draft.rejected)) fail(409, 'MUSE_DRAFT_IMMUTABLE', 'Prepared or rejected drafts cannot be edited. Use the original order controls and start a new draft.');
  if (draft ? body.expectedRevision !== draft.versions.length : body.expectedRevision !== undefined) fail(409, 'MUSE_DRAFT_STALE_SCOPE', 'Read the current draft revision before clarifying.');
  const prior = draft?.versions.at(-1)?.context;
  const messages = [...(prior?.messages || []), { requestId: body.requestId, content: body.content.trim() }];
  if (messages.map(item => item.content).join('\n').length > 4000 || messages.length > 16) fail(400, 'MUSE_DRAFT_CONTEXT_LIMIT', 'Summarize the goal in a new draft; source text is never silently truncated.');
  const reference = Object.hasOwn(body, 'productReference') ? body.productReference : prior?.productReference || null;
  const product = assertDraftProduct(state, conversationId, reference);
  return { draftId: draft?.id || randomUUID(), revision: (draft?.versions.length || 0) + 1, subject: actor.subject, conversationId,
    requestId: body.requestId, fingerprint, messages, services: services.filter(item => item.dataMode === 'public').map(({ id, title, minimumCredits }) => ({ id, title, minimumCredits })),
    productReference: reference, productSnapshot: product, selection: body.inputContext === undefined ? prior?.selection || { artifacts: [], skills: [], memoryIds: [], connectorActions: [] } : body.inputContext };
}

export function registerDraft(state, context, run, reply) {
  let draft = registry(state).drafts.find(item => item.id === context.draftId);
  if (!draft) {
    if (registry(state).drafts.length >= 500) fail(409, 'MUSE_DRAFT_LIMIT', 'Draft storage needs operator review.');
    draft = { id: context.draftId, subject: context.subject, conversationId: context.conversationId, requestId: context.requestId, versions: [], prepare: null, rejected: null };
    registry(state).drafts.push(draft);
  }
  if (draft.prepare || draft.rejected || draft.versions.length !== context.revision - 1) fail(409, 'MUSE_DRAFT_STALE_SCOPE', 'The draft changed during admission.');
  assertDraftProduct(state, context.conversationId, context.productReference, context.productSnapshot);
  draft.versions.push({ context: structuredClone(context), runId: run.id, replyId: reply.id, scope: blank(), scopeHash: null, missingFields: [...MUSE_DRAFT_FIELDS], suggestions: [], phase: 'pending' });
}

// Candidate facts require exact admitted message/file quotes. Guesses remain
// explicitly unconfirmed suggestions; no model field can grant approval.
export function normalizeDraftProposal(args, run) {
  if (!exact(args, ['scope', 'sources', 'suggestions']) || !exact(args.scope, MUSE_DRAFT_FIELDS) || !Array.isArray(args.sources) || args.sources.length > 6 || !MUSE_DRAFT_FIELDS.every(field => Object.hasOwn(args.scope, field)))
    fail(400, 'MUSE_DRAFT_PROPOSAL_INVALID', 'Pi must use the exact inert draft tool schema.');
  const context = run.museDraftContext, scope = blank(), suggestions = [], seen = new Set();
  for (const source of args.sources) {
    if (!exact(source, ['field', 'kind', 'requestId', 'id', 'version', 'sha256', 'quote']) || !MUSE_DRAFT_FIELDS.includes(source.field) || seen.has(source.field) || typeof source.quote !== 'string' || !source.quote.trim() || source.quote.length > 4000)
      fail(400, 'MUSE_DRAFT_PROPOSAL_INVALID', 'Use one exact source quote per proposed field.');
    seen.add(source.field);
  }
  for (const field of MUSE_DRAFT_FIELDS) {
    const value = args.scope[field], source = args.sources.find(item => item.field === field);
    if (value === null) continue;
    if (field === 'budgetCredits' ? !Number.isSafeInteger(value) || value < 1 || value > 10000 : typeof value !== 'string' || !value.trim() || value.length > limits[field] || looksLikeCredential(value))
      fail(400, 'MUSE_DRAFT_PROPOSAL_INVALID', 'The candidate value exceeds the original order scope.');
    const content = source?.kind === 'message' ? context.messages.find(item => item.requestId === source.requestId)?.content
      : source?.kind === 'artifact' ? run.inputContextSnapshot?.artifacts.find(item => item.id === source.id && item.version === source.version && item.sha256 === source.sha256)?.content : null;
    let verified = Boolean(content && content.includes(source.quote));
    if (field === 'serviceId') {
      const service = context.services.find(item => item.id === value);
      verified &&= Boolean(service && (source.quote.includes(service.id) || source.quote.includes(service.title)));
    } else if (field === 'budgetCredits') {
      const amounts = [...(source?.quote || '').matchAll(/(?:^|[^\d.])([+-]?\d+(?:\.\d+)?)\s*(?:credits\b|积分)/giu)].map(match => Number(match[1]));
      verified &&= amounts.length === 1 && amounts[0] === value;
    }
    else verified &&= Boolean(source?.quote.includes(value));
    if (field === 'deadlineAt') verified &&= /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now() + 60000 && Date.parse(value) <= Date.now() + 90 * 86400000;
    if (verified) scope[field] = field === 'deadlineAt' ? new Date(value).toISOString() : typeof value === 'string' ? value.trim() : value;
    else suggestions.push({ field, value, label: '模型建议，未确认，不进入订单' });
  }
  if (args.suggestions !== undefined) {
    if (!Array.isArray(args.suggestions) || args.suggestions.length > 6 || args.suggestions.some(item => !exact(item, ['field', 'value']) || !MUSE_DRAFT_FIELDS.includes(item.field) || typeof item.value !== 'string' && !Number.isSafeInteger(item.value) || String(item.value).length > 2500 || looksLikeCredential(String(item.value))))
      fail(400, 'MUSE_DRAFT_PROPOSAL_INVALID', 'Suggestions cannot grant permissions or add fields.');
    for (const item of args.suggestions) suggestions.push({ ...item, label: '模型建议，未确认，不进入订单' });
  }
  const service = context.services.find(item => item.id === scope.serviceId);
  if (scope.budgetCredits !== null && service && scope.budgetCredits < service.minimumCredits) { suggestions.push({ field: 'budgetCredits', value: scope.budgetCredits, label: '低于原服务最低额度，需要明确新的预算' }); scope.budgetCredits = null; }
  return { scope, suggestions, sources: structuredClone(args.sources) };
}

export function publishDraft(state, run, reply, proposal) {
  const context = run.museDraftContext, draft = findMuseDraft(state, context, context.conversationId, context.draftId);
  const version = draft.versions.at(-1);
  if (draft.prepare || draft.rejected || version.context.revision !== context.revision || version.runId !== run.id || version.replyId !== reply.id)
    fail(409, 'MUSE_DRAFT_STALE_SCOPE', 'The original draft invocation changed before publication.');
  const checked = normalizeDraftProposal(proposal, run), product = assertDraftProduct(state, context.conversationId, context.productReference, context.productSnapshot);
  if (product) checked.scope.product = product.name; // Local human DTO only, never Pi context.
  version.scope = checked.scope; version.scopeHash = reviewHash(context, checked.scope); version.suggestions = checked.suggestions;
  version.missingFields = MUSE_DRAFT_FIELDS.filter(field => checked.scope[field] === null);
  version.phase = version.missingFields.length ? 'needs_information' : 'ready_for_review';
  reply.museDraftRef = { draftId: draft.id, revision: context.revision, draftHash: version.scopeHash };
  reply.content = version.missingFields.length ? `Muse 委托草案还缺：${version.missingFields.map(field => labels[field]).join('、')}。请在本会话补充。尚未创建、批准或派发订单。`
    : 'Muse 委托草案已整理，请审阅确切范围，并明确确认预算、期限和本次公开文字。尚未创建、批准或派发订单。';
}

export function draftDto(state, draft) {
  const version = draft.versions.at(-1), run = state.runs.find(item => item.id === version.runId);
  let phase = draft.rejected ? draft.rejected.status === 'done' ? 'rejected' : 'rejecting' : draft.prepare?.orderId ? 'prepared' : draft.prepare ? 'preparing' : version.phase;
  if (phase === 'pending' && ['blocked', 'interrupted', 'cancelled', 'failed'].includes(run?.status)) phase = ['blocked', 'interrupted'].includes(run.status) ? 'blocked' : 'failed';
  return { id: draft.id, draftId: draft.id, conversationId: draft.conversationId, requestId: draft.requestId, messageRequestId: version.context.requestId, reasoningProvider: 'pi',
    revision: version.context.revision, draftHash: version.scopeHash, scopeVersion: version.context.revision, scopeHash: version.scopeHash, phase, runId: version.runId,
    scope: version.scope, order: version.scope, productReference: version.context.productReference, publicText: publicText(version.scope), missingFields: version.missingFields,
    questions: version.missingFields.map(field => ({ field, question: `请明确${labels[field]}。` })), suggestions: version.suggestions,
    prepareRequestId: draft.prepare?.requestId || null, orderId: draft.prepare?.orderId || null, reviewHash: draft.prepare?.reviewHash || null,
    error: draft.prepare?.error || run?.error || null, executionStarted: false, wakeVerified: false };
}

export function assertDraftInvocation(state, run) {
  if (!run.museDraftContext) return;
  const context = run.museDraftContext, draft = findMuseDraft(state, context, context.conversationId, context.draftId);
  if (draft.prepare || draft.rejected || draft.versions.at(-1).context.revision !== context.revision) fail(409, 'MUSE_DRAFT_STALE_SCOPE', 'The original draft revision no longer permits this Pi invocation.');
}

export function museDraftInstructions(context) {
  // Product name and private referenced content deliberately excluded.
  return `\nThis is Pi preparing an INERT Muse draft, not Muse execution. Call workspace_propose_muse_draft exactly once, even when every value is null. Use only exact quotes from these admitted user messages or selected input snapshots. Unknown facts stay null, never fill budget from catalog minimum or infer a deadline. Suggestions stay separate and unconfirmed. Only these original PUBLIC services are permitted: ${JSON.stringify(context.services)}. User messages: ${JSON.stringify(context.messages)}. Selected product reference ID/revision (its private contents are resolved locally for HUMAN review only): ${JSON.stringify(context.productReference)}. No connector action, authorization, order creation, dispatch or wake is available.`;
}

export function validateMuseDraftRegistry(state) {
  const data = state.workspaceMuseDrafts;
  if (data === undefined) return;
  if (!exact(data, ['version', 'drafts']) || data.version !== 1 || !Array.isArray(data.drafts) || data.drafts.length > 500) throw new Error('Invalid Muse draft registry.');
  const ids = new Set(), requests = new Set();
  for (const draft of data.drafts) {
    if (!object(draft) || typeof draft.id !== 'string' || ids.has(draft.id) || typeof draft.subject !== 'string' || !state.conversations.some(item => item.id === draft.conversationId && item.subject === draft.subject && item.nativeAgentId === draft.conversationId) || !Array.isArray(draft.versions) || !draft.versions.length || draft.versions.length > 16) throw new Error('Invalid Muse draft ownership/version.');
    ids.add(draft.id);
    for (const [index, version] of draft.versions.entries()) {
      const context = version.context, request = JSON.stringify([draft.subject, draft.conversationId, context?.requestId]);
      if (!context || context.draftId !== draft.id || context.conversationId !== draft.conversationId || context.subject !== draft.subject || context.revision !== index + 1 || !key(context.requestId) || !digest(context.fingerprint) || requests.has(request) || !state.runs.some(run => run.id === version.runId && run.conversationId === draft.conversationId && run.museDraftContext?.fingerprint === context.fingerprint) || !state.messages.some(message => message.id === version.replyId && message.runId === version.runId) || !exact(version.scope, [...MUSE_DRAFT_FIELDS, 'publicDataConfirmed']) || version.scope.publicDataConfirmed !== false || version.scopeHash !== null && version.scopeHash !== reviewHash(context, version.scope)) throw new Error('Invalid Muse draft scope/receipt.');
      requests.add(request);
    }
    if (draft.prepare && (!key(draft.prepare.requestId) || draft.prepare.revision !== draft.versions.length || draft.prepare.scopeHash !== draft.versions.at(-1).scopeHash)) throw new Error('Invalid Muse draft preparation.');
  }
}
