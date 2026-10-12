import { randomUUID } from 'node:crypto';
import { SUPPLIER_FIELDS, blankSupplierProfile, normalizeSupplierProfile, supplierFail, supplierHash, supplierObject } from './supplier-profile.mjs';
import { looksLikeCredential } from './security.mjs';

export const supplierRegistry = state => state.workspaceSupplierServices ||= { version: 1, services: [], monitors: [], commands: [] };
export function supplierOwned(state, actor, conversationId) {
  const item = state.conversations.find(conversation => conversation.id === conversationId);
  const receipts = state.workspaceConversationCreations?.receipts || [];
  const created = item?.createdBy === actor.subject && (item.workspaceId === actor.workspaceId || receipts.some(receipt => receipt.conversationId === item.id && receipt.subject === actor.subject && receipt.workspaceId === actor.workspaceId && receipt.requestId === item.creationRequestId));
  if (!item || !['admin', 'operator'].includes(actor.role) || !(created || item.subject === actor.subject && item.nativeAgentId === item.id)) supplierFail(404, 'SUPPLIER_CONVERSATION_REQUIRED', 'Use this authenticated owner’s original business conversation.');
  return item;
}
export function supplierFind(state, actor, conversationId, id) {
  supplierOwned(state, actor, conversationId);
  const row = (state.workspaceSupplierServices?.services || []).find(service => service.id === id && service.subject === actor.subject && service.workspaceId === actor.workspaceId && service.conversationId === conversationId);
  if (!row) supplierFail(404, 'SUPPLIER_SERVICE_NOT_FOUND', 'The original supplier service was not found.');
  return row;
}
export function supplierRequest(body, fields) {
  supplierObject(body, ['requestId', ...fields]);
  if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.requestId)) supplierFail(400, 'SUPPLIER_REQUEST_ID_REQUIRED', 'Retain one original requestId for this exact operation.');
  if (looksLikeCredential(JSON.stringify(body))) supplierFail(400, 'RAW_CREDENTIAL_REJECTED', 'Credentials belong only in existing approved host configuration.');
}
export function supplierAdmission(state, actor, conversationId, body, id) {
  supplierRequest(body, ['content', 'expectedRevision', 'inputContext']); supplierOwned(state, actor, conversationId);
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 6000) supplierFail(400, 'SUPPLIER_INPUT_INVALID', 'Provide bounded product facts or clarification.');
  const fingerprint = supplierHash({ ...body, conversationId, serviceId: id || null });
  const prior = (state.workspaceSupplierServices?.services || []).filter(row => row.subject === actor.subject && row.workspaceId === actor.workspaceId && row.conversationId === conversationId).flatMap(row => row.versions.map(version => version.context)).find(context => context?.requestId === body.requestId);
  if (prior) { if (prior.fingerprint !== fingerprint) supplierFail(409, 'IDEMPOTENCY_CONFLICT', 'This request already names another exact supplier message.'); return structuredClone(prior); }
  const row = id ? supplierFind(state, actor, conversationId, id) : null;
  if (row && body.expectedRevision !== row.revision || !row && body.expectedRevision !== undefined) supplierFail(409, 'SUPPLIER_REVISION_CONFLICT', 'Read the current supplier revision before clarifying.');
  if (row?.versions.at(-1)?.phase === 'pending' && !['blocked', 'failed', 'cancelled'].includes(state.runs.find(run => run.id === row.versions.at(-1).runId)?.status)) supplierFail(409, 'SUPPLIER_BUSY', 'Reconcile the original Pi run before another clarification.');
  const messages = [...(row?.messages || []), { requestId: body.requestId, content: body.content.trim() }];
  if (messages.length > 20 || messages.map(message => message.content).join('\n').length > 12000) supplierFail(400, 'SUPPLIER_CONTEXT_LIMIT', 'Start a separately reviewed product intake; sources are never silently truncated.');
  const selection = body.inputContext || { artifacts: [], skills: [], memoryIds: [], connectorActions: [] };
  if (selection.connectorActions?.length) supplierFail(400, 'SUPPLIER_EFFECTS_FORBIDDEN', 'Intake only uses admitted input and inert product facts.');
  return { serviceId: row?.id || randomUUID(), revision: (row?.revision || 0) + 1, subject: actor.subject, workspaceId: actor.workspaceId, conversationId, requestId: body.requestId, fingerprint, messages, previousProfile: row?.profile || blankSupplierProfile(), selection };
}
export function registerSupplierDraft(state, context, run, reply) {
  let row = supplierRegistry(state).services.find(item => item.id === context.serviceId);
  if (!row) { if (supplierRegistry(state).services.length >= 500) supplierFail(409, 'SUPPLIER_CAPACITY_LIMIT', 'Supplier service capacity needs operator review.'); row = { id: context.serviceId, subject: context.subject, workspaceId: context.workspaceId, conversationId: context.conversationId, revision: 0, profile: blankSupplierProfile(), messages: [], versions: [], preview: null, productReference: null, createdAt: new Date().toISOString() }; supplierRegistry(state).services.push(row); }
  if (row.revision !== context.revision - 1) supplierFail(409, 'SUPPLIER_REVISION_CONFLICT', 'The supplier record changed before Pi admission.');
  row.revision = context.revision; row.messages = structuredClone(context.messages);
  row.versions.push({ context: structuredClone(context), runId: run.id, replyId: reply.id, phase: 'pending' });
}
const labels = { name: /name|名称|产品名/i, description: /description|描述/i, targetMarket: /target.?market|目标市场/i, currency: /currency|零售货币|售价货币/i, skuCode: /sku/i, supplierUnit: /supplier.?unit|供应单位/i, supplierMoq: /moq|起订量/i, wholesaleUnitPrice: /wholesale|批发价/i, wholesaleCurrency: /wholesale.?currency|批发货币/i, internalUnitCost: /internal.?unit.?cost|内部成本/i, internalCostCurrency: /internal.?cost.?currency|成本货币/i, recommendedRetailPrice: /recommended.?retail|建议零售价/i, retailUnit: /retail.?unit|零售单位/i, unitsPerPack: /units.?per.?pack|包装数量/i, consumerPrice: /consumer.?price|消费者售价|销售价/i, productionDays: /production.?days|生产.*天|生产交期/i, handlingDays: /handling.?days|处理发货|发货.*天/i, shippingDays: /shipping.?days|运输.*天|运输时长/i };
export function normalizeSupplierProposal(args, run) {
  supplierObject(args, ['facts', 'sources', 'suggestions']); supplierObject(args.facts, SUPPLIER_FIELDS.filter(field => field !== 'images'));
  if (!Array.isArray(args.sources) || args.sources.length > 18 || !Array.isArray(args.suggestions || [])) supplierFail(400, 'SUPPLIER_PROPOSAL_INVALID', 'Use factual fields with exact admitted quotes.');
  const checked = normalizeSupplierProfile(args.facts), facts = {}, suggestions = [];
  for (const [field, value] of Object.entries(args.facts)) {
    if (value === null) continue;
    const sources = args.sources.filter(source => source.field === field);
    const source = sources[0];
    if (source) supplierObject(source, ['field', 'kind', 'requestId', 'artifactId', 'version', 'sha256', 'quote']);
    const content = source?.kind === 'message' ? run.supplierDraftContext.messages.find(message => message.requestId === source.requestId)?.content : source?.kind === 'artifact' ? run.inputContextSnapshot?.artifacts.find(item => item.id === source.artifactId && item.version === source.version && item.sha256 === source.sha256)?.content : null;
    const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const labelled = new RegExp('(?:' + labels[field].source + ')[\\s:=："\']{0,12}' + escaped + (typeof value === 'number' || /Price|Cost/.test(field) ? '(?![\\d.])' : ''), 'i');
    const quoted = sources.length === 1 && typeof source.quote === 'string' && content?.includes(source.quote) && labelled.test(source.quote);
    if (quoted) facts[field] = checked[field]; else suggestions.push({ field, value, confirmed: false });
  }
  for (const item of args.suggestions || []) { supplierObject(item, ['field', 'value']); if (!SUPPLIER_FIELDS.includes(item.field) || !['string', 'number'].includes(typeof item.value) || String(item.value).length > 500) supplierFail(400, 'SUPPLIER_PROPOSAL_INVALID', 'Suggestions remain bounded unconfirmed values.'); suggestions.push({ ...item, confirmed: false }); }
  return { facts, suggestions };
}
export function publishSupplierDraft(state, run, reply, proposal) {
  const context = run.supplierDraftContext, row = supplierFind(state, { ...context, role: 'operator' }, context.conversationId, context.serviceId);
  if (row.revision !== context.revision || row.versions.at(-1)?.runId !== run.id) supplierFail(409, 'SUPPLIER_REVISION_CONFLICT', 'The original intake revision changed.');
  const checked = normalizeSupplierProposal(proposal, run);
  row.profile = normalizeSupplierProfile(checked.facts, row.profile); row.profileHash = supplierHash(row.profile); row.suggestions = checked.suggestions; row.preview = null;
  row.versions.at(-1).phase = 'saved'; row.updatedAt = new Date().toISOString();
  const missing = SUPPLIER_FIELDS.filter(field => field !== 'internalUnitCost' && field !== 'internalCostCurrency' && (row.profile[field] === null || field === 'images' && !row.profile.images.length));
  reply.supplierServiceRef = { serviceId: row.id, revision: row.revision, profileHash: row.profileHash };
  reply.content = missing.length ? `供应商产品资料已私有保存。请补充：${missing.join('、')}。未生成 Shopify 草稿或发布商品。` : '产品事实已私有保存。请审阅零售可销售单元与图片权限，再生成公开字段预览。';
}
export function supplierInstructions(context) { return '\nYou are the built-in Cnsubscribe supplier intake agent running on Pi. Call workspace_propose_supplier_profile once. Extract only labelled, exact quoted product facts from these admitted user messages and selected files. Keep unknown fields null, suggestions separate. Never map supplier MOQ to pack quantity, wholesale/recommended price to consumer price, or production days to handling/shipping days. Do not propose images or public approval; images are admitted through exact original file references. No Shopify mutation, grant, payment, monitoring activation or Muse/Dot execution is allowed. Admitted messages: ' + JSON.stringify(context.messages); }
export function supplierDto(state, row) {
  const version = row.versions.at(-1), run = state.runs.find(item => item.id === version?.runId);
  const phase = version?.phase === 'pending' ? ['failed', 'blocked', 'interrupted', 'cancelled'].includes(run?.status) ? run.status : 'pending' : row.preview?.phase || 'needs_information';
  return { id: row.id, serviceId: row.id, conversationId: row.conversationId, revision: row.revision, phase: row.rejectedAt ? 'rejected' : row.cancelledAt ? 'cancelled' : phase, profile: row.profile, profileHash: row.profileHash || supplierHash(row.profile), productReference: row.productReference, preview: row.preview,
    missingFields: SUPPLIER_FIELDS.filter(field => !['internalUnitCost', 'internalCostCurrency'].includes(field) && (row.profile[field] === null || field === 'images' && !row.profile.images.length)), suggestions: row.suggestions || [], runId: version?.runId || null, error: run?.error || null,
    questions: SUPPLIER_FIELDS.filter(field => !['internalUnitCost', 'internalCostCurrency'].includes(field) && (row.profile[field] === null || field === 'images' && !row.profile.images.length)).map(field => ({ field, question: `请明确 ${field}；未知可保留。` })),
    cancelledAt: row.cancelledAt || null, rejectedAt: row.rejectedAt || null,
    runtime: 'pi-durable', externalStatus: row.external?.status || 'preview', external: row.external || null };
}
