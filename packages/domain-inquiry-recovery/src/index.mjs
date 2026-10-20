// Historical inquiry recovery: authorized import, evidence-bound recovery decisions,
// human-reviewed follow-up drafts and non-enabled Goal drafts. No sending, no model
// call and no fabricated research happens here.
//
// This is the standalone domain package. It imports only Node builtins and files of
// its own: the host injects its store, artifact writer, clock and error class.
import { createHash, randomUUID } from 'node:crypto';
import { InquiryError } from './errors.mjs';
import { COLUMNS, MAX_IMPORT_BYTES, parseCsv } from './csv.mjs';

const DAY = 86_400_000;
const VERSION = 1;
const INPUT_SCHEMA = 'historical-inquiry.input.v1';
const MAX_ROWS = 50;
const MAX_BODY = 4000;
const DEFAULT_STALE_DAYS = 7;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
// leadId becomes a URL path segment, so it may not contain a slash.
const LEAD_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/u;
const STATUSES = new Set(['active', 'won', 'lost', 'opted_out', 'manual_hold']);
const HOLD_STATUSES = new Set(['won', 'lost', 'opted_out', 'manual_hold']);
const DIRECTIONS = new Set(['inbound', 'outbound', 'internal']);
const FACT_KINDS = new Set(['rfq', 'contact', 'purchase']);
const IDENTITY_STATES = new Set(['unknown', 'confirmed', 'conflicting']);
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

const fail = (status, code, message) => { throw new InquiryError(status, code, message); };
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const now = clock => new Date(Number(clock())).toISOString();

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

function text(value, label, maximum, optional = false) {
  if (value === undefined || value === null || value === '') {
    if (optional) return '';
    fail(400, 'INQUIRY_FIELD_REQUIRED', `${label} is required.`);
  }
  if (typeof value !== 'string') fail(400, 'INQUIRY_FIELD_INVALID', `${label} must be text.`);
  const trimmed = value.trim();
  if (!trimmed && optional) return '';
  if (!trimmed || [...trimmed].length > maximum || CONTROL.test(trimmed))
    fail(400, 'INQUIRY_FIELD_INVALID', `${label} must be nonempty, printable and at most ${maximum} characters.`);
  return trimmed;
}

function identifier(value, label) {
  const result = text(value, label, 128);
  if (!ID.test(result)) fail(400, 'INQUIRY_FIELD_INVALID', `${label} uses unsupported characters.`);
  return result;
}

/** A date is only used when it is explicit and unambiguous; anything else stays unknown. */
function explicitDate(value) {
  if (value === undefined || value === null || value === '') return { value: null, unknown: true };
  if (typeof value !== 'string') return { value: null, unknown: true };
  const input = value.trim();
  // A calendar date, or a datetime that states its timezone. A datetime without
  // an offset is never guessed against the server clock.
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/u.test(input))
    return { value: null, unknown: true, raw: input.slice(0, 64) };
  // Neither a bare date nor a datetime may carry an impossible calendar day:
  // Date.parse would silently roll 2026-02-30 over to 2026-03-02.
  const [year, month, day] = input.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day)
    return { value: null, unknown: true, raw: input.slice(0, 64) };
  if (/^\d{4}-\d{2}-\d{2}$/u.test(input)) return { value: calendar.toISOString(), unknown: false };
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) return { value: null, unknown: true, raw: input.slice(0, 64) };
  return { value: new Date(parsed).toISOString(), unknown: false };
}

function integer(value, label, minimum, maximum) {
  const number = typeof value === 'string' && /^\d+$/u.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum)
    fail(400, 'INQUIRY_FIELD_INVALID', `${label} must be an integer between ${minimum} and ${maximum}.`);
  return number;
}

function arrayField(value, label, maximum) {
  if (value === undefined || value === null || value === '') return [];
  let parsed = value;
  if (typeof value === 'string') {
    if ([...value].length > maximum) fail(400, 'INQUIRY_FIELD_INVALID', `${label} is too large.`);
    try { parsed = JSON.parse(value); } catch { fail(400, 'INQUIRY_FIELD_INVALID', `${label} must be JSON in a CSV cell.`); }
  }
  if (!Array.isArray(parsed) || parsed.length > 50) fail(400, 'INQUIRY_FIELD_INVALID', `${label} must be a bounded array.`);
  return parsed;
}

function normalizeRow(source, label = 'row') {
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.getPrototypeOf(source) !== Object.prototype)
    fail(400, 'INQUIRY_ROW_INVALID', `${label} must be a plain object.`);
  for (const key of Object.keys(source)) if (!COLUMNS.includes(key))
    fail(400, 'INQUIRY_ROW_INVALID', `${label} contains unsupported field ${key}.`);
  const leadId = identifier(source.leadId, 'leadId');
  if (!LEAD_ID.test(leadId)) fail(400, 'INQUIRY_FIELD_INVALID', 'leadId may not contain a slash; it becomes a route segment.');
  const sourceId = identifier(source.sourceId, 'sourceId');
  const revision = integer(source.revision, 'revision', 1, Number.MAX_SAFE_INTEGER);
  const status = source.status === undefined || source.status === '' ? 'active' : String(source.status).trim();
  if (!STATUSES.has(status)) fail(400, 'INQUIRY_ROW_INVALID', `${label} status must be ${[...STATUSES].join('/')}.`);
  const quantity = source.quantity === undefined || source.quantity === '' ? null : integer(source.quantity, 'quantity', 1, Number.MAX_SAFE_INTEGER);
  const dates = {
    requestedAt: explicitDate(source.requestedAt), receivedAt: explicitDate(source.receivedAt), lastContactAt: explicitDate(source.lastContactAt),
  };
  const history = arrayField(source.history, 'history', 12000).map((entry, position) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(400, 'INQUIRY_ROW_INVALID', `${label} history[${position}] must be an object.`);
    const direction = String(entry.direction ?? '').trim();
    if (!DIRECTIONS.has(direction)) fail(400, 'INQUIRY_ROW_INVALID', `${label} history[${position}].direction is invalid.`);
    return {
      id: identifier(entry.id, `history[${position}].id`),
      direction,
      sentAt: explicitDate(entry.sentAt).value,
      body: text(entry.body, `history[${position}].body`, 4000),
    };
  });
  const facts = arrayField(source.facts, 'facts', 12000).map((entry, position) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(400, 'INQUIRY_ROW_INVALID', `${label} facts[${position}] must be an object.`);
    const kind = String(entry.kind ?? '').trim();
    if (!FACT_KINDS.has(kind)) fail(400, 'INQUIRY_ROW_INVALID', `${label} facts[${position}].kind is invalid.`);
    return {
      kind,
      sourceMessageId: identifier(entry.sourceMessageId, `facts[${position}].sourceMessageId`),
      quote: text(entry.quote, `facts[${position}].quote`, 1000),
      occurredAt: explicitDate(entry.occurredAt).value,
    };
  });
  for (const fact of facts) {
    const message = history.find(entry => entry.id === fact.sourceMessageId);
    if (!message || !message.body.includes(fact.quote))
      fail(400, 'INQUIRY_FACT_UNSUPPORTED', `${label} fact ${fact.sourceMessageId} quotes text that is not in the imported history.`);
  }
  const certifications = arrayField(source.requestedCertifications, 'requestedCertifications', 4000)
    .map((entry, position) => text(entry, `requestedCertifications[${position}]`, 120));
  const record = {
    leadId, sourceId, revision, status, quantity,
    companyName: text(source.companyName, 'companyName', 200, true),
    companyUrl: text(source.companyUrl, 'companyUrl', 500, true),
    contactEmail: text(source.contactEmail, 'contactEmail', 250, true),
    customerName: text(source.customerName, 'customerName', 200, true),
    productId: text(source.productId, 'productId', 128, true),
    product: text(source.product, 'product', 200, true),
    unit: text(source.unit, 'unit', 40, true),
    destination: text(source.destination, 'destination', 200, true),
    body: text(source.body, 'body', MAX_BODY, true),
    requestedAt: dates.requestedAt.value, receivedAt: dates.receivedAt.value, lastContactAt: dates.lastContactAt.value,
    dateUnknown: Object.entries(dates).filter(([, value]) => value.unknown).map(([key]) => key),
    history, facts, requestedCertifications: certifications,
  };
  if (record.companyUrl && !/^https?:\/\/[^\s]+$/u.test(record.companyUrl))
    fail(400, 'INQUIRY_ROW_INVALID', `${label} companyUrl must be an absolute http(s) URL.`);
  if (record.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(record.contactEmail))
    fail(400, 'INQUIRY_ROW_INVALID', `${label} contactEmail is not an address.`);
  return record;
}

const sourceHash = record => hash(record);

const decisionRank = { follow_up: 0, need_evidence: 1, nurture: 2, hold: 3 };

function decisionFor(lead, asOfMs, staleDays = DEFAULT_STALE_DAYS) {
  if (HOLD_STATUSES.has(lead.status)) {
    return { decision: 'hold', reasons: [`STATUS_${lead.status.toUpperCase()}`], daysStale: null, missing: [] };
  }
  const reasons = [], missing = [];
  if (lead.identity.status !== 'confirmed') reasons.push(lead.identity.status === 'conflicting' ? 'IDENTITY_CONFLICT' : 'IDENTITY_UNCONFIRMED');
  if (!Array.isArray(lead.facts) || lead.facts.length === 0) reasons.push('NO_VERBATIM_EVIDENCE');
  if (!lead.contactEmail && !lead.customerName) missing.push('contact_channel');
  if (!lead.companyUrl) missing.push('company_url');
  if (!lead.productId) missing.push('product_binding');
  const last = Date.parse(lead.lastContactAt ?? '');
  const daysStale = Number.isFinite(last) ? Math.max(0, Math.floor((asOfMs - last) / DAY)) : null;
  if (daysStale === null) reasons.push('LAST_CONTACT_UNKNOWN');
  if (reasons.length || missing.length) return { decision: 'need_evidence', reasons, daysStale, missing };
  if (daysStale >= staleDays) return { decision: 'follow_up', reasons: ['STALE_FOLLOW_UP'], daysStale, missing };
  return { decision: 'nurture', reasons: ['RECENT_CONTACT'], daysStale, missing };
}

function nextStepFor(lead, decision, staleDays = DEFAULT_STALE_DAYS) {
  if (decision.decision === 'hold')
    return { action: '暂停复联', why: `当前状态为 ${lead.status}，不生成外发草稿。`, risk: '仅当客户重新主动联系后重新评估。' };
  if (decision.decision === 'need_evidence')
    return {
      action: '先补齐证据再决定是否复联',
      why: `缺少：${[...decision.reasons, ...decision.missing].join('、')}`,
      risk: '在补齐前不得报价、承诺交期或假设客户仍在采购。',
    };
  if (decision.decision === 'nurture')
    return { action: '保持节奏，到期后再评估', why: `最近一次联系在 ${decision.daysStale} 天前，未超过 ${staleDays} 天阈值。`, risk: '不要为了推进而虚构新进展。' };
  return {
    action: `发出一次简短跟进（已 ${decision.daysStale} 天未联系）`,
    why: '引用对方原话中的需求，只问一个容易回答的问题。',
    risk: '草稿需人工审核；价格、MOQ、交期与认证必须来自已审核目录或人工确认。',
  };
}

function evidenceFor(lead) {
  return lead.facts.map(fact => ({
    kind: fact.kind, sourceMessageId: fact.sourceMessageId, quote: fact.quote, occurredAt: fact.occurredAt,
    independentlyVerified: false,
    note: fact.kind === 'purchase' ? '历史记录中的采购说法，未经独立核实，不能当作订单。' : '来自导入历史的逐字片段。',
  }));
}

function draftFor(lead, decision, asOf) {
  const evidence = evidenceFor(lead);
  const facts = evidence.map(item => `- [${item.kind}] ${item.quote}（${item.sourceMessageId}，${item.occurredAt ?? '日期未知'}；独立核实：否${item.kind === 'purchase' ? '，采购说法未经核实，不是订单' : ''}）`).join('\n');
  const lines = [
    '<!-- 未发送：人审必需。本文件由 Workspace 依据已导入历史生成，未经模型撰写、未做外部联系。 -->',
    `# 复联草稿 · ${lead.companyName || lead.leadId}`,
    '',
    `- leadId: ${lead.leadId}`,
    `- sourceId/revision: ${lead.sourceId}/${lead.revision}`,
    `- 评估基准日: ${asOf}`,
    `- 最近联系: ${lead.lastContactAt ?? '未知'}（${decision.daysStale ?? '未知'} 天）`,
    `- 需求: ${lead.product || '未提供'}${lead.quantity ? `，数量 ${lead.quantity}${lead.unit || ''}` : ''}`,
    '',
    '## 可用证据（仅以下内容可作为事实）',
    facts || '- 无逐字证据；不得声称客户仍有采购意向。',
    '',
    '## 草稿',
    lead.customerName ? `${lead.customerName}，您好：` : '您好：',
    '',
    `想确认一下您之前提到的${lead.product || '相关需求'}目前是否还在评估中。`,
    '如果是，我可以按您原来提到的要求整理一份可核对的资料；如果计划有变化，也请告诉我，我会按新的方向跟进。',
    '',
    '顺祝商祺',
    '',
    '---',
    '## 未知与边界',
    '- 价格、MOQ、交期、认证与库存均未在此草稿中承诺。',
    '- 客户当前采购意向未知；历史记录只代表当时的说法。',
    '- 发送、报价与任何对外承诺需要单独的人工审批。',
    '',
    '## 来源',
    `- importId: ${lead.importId}`,
    `- sourceHash: ${lead.sourceHash}`,
  ];
  const content = lines.join('\n');
  return { filename: `followup-${lead.leadId}.md`, content, sha256: hash(content) };
}

function cardFor(lead, asOfMs, staleDays) {
  const decision = decisionFor(lead, asOfMs, staleDays);
  const draft = decision.decision === 'follow_up' ? draftFor(lead, decision, new Date(asOfMs).toISOString().slice(0, 10)) : null;
  return {
    leadId: lead.leadId, sourceId: lead.sourceId, revision: lead.revision, sourceHash: lead.sourceHash,
    company: { name: lead.companyName || null, url: lead.companyUrl || null, email: lead.contactEmail || null, contact: lead.customerName || null },
    request: { productId: lead.productId || null, product: lead.product || null, quantity: lead.quantity, unit: lead.unit || null, destination: lead.destination || null },
    status: lead.status,
    identity: { status: lead.identity.status, reviewerConfirmed: lead.identity.reviewerConfirmed === true },
    lastContactAt: lead.lastContactAt, daysStale: decision.daysStale,
    decision: decision.decision, reasons: decision.reasons, missing: decision.missing,
    evidence: evidenceFor(lead), nextStep: nextStepFor(lead, decision, staleDays),
    draft: draft ? { filename: draft.filename, sha256: draft.sha256, sent: false, humanReviewRequired: true } : null,
    dateUnknown: lead.dateUnknown, updatedAt: lead.updatedAt,
  };
}

function requireActor(actor) {
  if (!actor || typeof actor.subject !== 'string' || !actor.subject.trim()) fail(401, 'INQUIRY_ACTOR_REQUIRED', 'An authenticated member is required.');
  return actor;
}

function requireMember(actor) {
  requireActor(actor);
  if (!['admin', 'operator'].includes(actor.role)) fail(403, 'INQUIRY_ROLE_REQUIRED', 'Only an administrator or operator may change inquiry recovery data.');
  return actor;
}

export function createInquiryRecoveryService({ store, artifacts = null, clock = Date.now, workspaceId = 'local', staleDays = DEFAULT_STALE_DAYS, ApiError: ErrorClass = InquiryError } = {}) {
  if (!store?.read || !store?.update || typeof clock !== 'function') throw new TypeError('The original Workspace store and a clock are required.');
  if (typeof workspaceId !== 'string' || !workspaceId) throw new TypeError('A workspace identity is required.');
  if (!Number.isInteger(staleDays) || staleDays < 1 || staleDays > 365) throw new TypeError('staleDays must be between 1 and 365.');
  if (artifacts !== null && typeof artifacts?.create !== 'function') throw new TypeError('Artifacts must expose the original create service.');
  if (typeof ErrorClass !== 'function') throw new TypeError('ApiError must be an Error constructor.');

  const fresh = () => ({ version: VERSION, workspaceId, leads: [], imports: [], conflicts: [], selections: [], commands: [], events: [] });

  function database(state) {
    if (!state.inquiryRecovery) return null;
    const db = state.inquiryRecovery;
    if (db.version !== VERSION || db.workspaceId !== workspaceId) fail(409, 'INQUIRY_WORKSPACE_CHANGED', 'This recovery store belongs to its original enterprise.');
    for (const key of ['leads', 'imports', 'conflicts', 'selections', 'commands', 'events'])
      if (!Array.isArray(db[key])) fail(409, 'INQUIRY_STORE_INVALID', 'The recovery store needs review; no data was overwritten.');
    // A damaged section must fail closed instead of feeding decisionFor a
    // half-shaped lead (which used to surface as a TypeError/500).
    for (const lead of db.leads) {
      if (!lead || typeof lead !== 'object' || typeof lead.leadId !== 'string' || !lead.leadId
        || typeof lead.sourceId !== 'string' || !Number.isSafeInteger(lead.revision)
        || typeof lead.sourceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(lead.sourceHash)
        || !STATUSES.has(lead.status) || !Array.isArray(lead.facts) || !Array.isArray(lead.history)
        || !lead.identity || !IDENTITY_STATES.has(lead.identity.status))
        fail(409, 'INQUIRY_STORE_INVALID', 'The recovery store needs review; no data was overwritten.');
    }
    return db;
  }

  const snapshot = () => database(store.read()) ?? fresh();
  const event = (db, kind, actor, details = {}) => {
    db.events.push({ id: randomUUID(), kind, actor: actor.subject, at: now(clock), ...details });
    if (db.events.length > 4000) db.events.splice(0, db.events.length - 4000);
  };

  function command(actor, action, input, callback) {
    requireActor(actor);
    const requestId = input?.requestId;
    if (typeof requestId !== 'string' || !UUID.test(requestId)) fail(400, 'INQUIRY_REQUEST_ID_REQUIRED', 'A stable UUID requestId is required.');
    const digest = hash({ action, actor: actor.subject, input });
    return store.update(state => {
      state.inquiryRecovery ??= fresh();
      const db = database(state);
      const existing = db.commands.find(item => item.requestId === requestId && item.actor === actor.subject);
      if (existing) {
        if (existing.digest !== digest || existing.action !== action) fail(409, 'INQUIRY_IDEMPOTENCY_CONFLICT', 'This requestId was already used for another command.');
        return existing.result;
      }
      const result = callback(db, state);
      db.commands.push({ id: randomUUID(), requestId, actor: actor.subject, action, digest, result, at: now(clock) });
      if (db.commands.length > 600) db.commands.splice(0, db.commands.length - 600);
      return result;
    });
  }

  function applyRow(db, record, importId, actor) {
    const digest = sourceHash(record);
    const sameLead = db.leads.filter(lead => lead.leadId === record.leadId && lead.sourceId === record.sourceId);
    const current = sameLead.sort((a, b) => b.revision - a.revision)[0];
    const conflict = (kind, detail) => {
      db.conflicts.push({ id: randomUUID(), leadId: record.leadId, sourceId: record.sourceId, kind, detail, importId, at: now(clock) });
      if (db.conflicts.length > 500) db.conflicts.splice(0, db.conflicts.length - 500);
    };
    if (current) {
      const identical = db.leads.find(lead => lead.leadId === record.leadId && lead.sourceId === record.sourceId && lead.revision === record.revision);
      if (identical) {
        if (identical.sourceHash === digest) return 'duplicate';
        conflict('REVISION_CONTENT_CHANGED', `revision ${record.revision} already imported with different content`);
        return 'conflict';
      }
      if (record.revision <= current.revision) {
        conflict('REVISION_NOT_NEWER', `revision ${record.revision} is not newer than stored revision ${current.revision}`);
        return 'conflict';
      }
      const crossSource = db.leads.some(lead => lead.leadId === record.leadId && lead.sourceId !== record.sourceId && lead.status === 'active');
      if (crossSource) {
        conflict('LEAD_SOURCE_CHANGED', 'this lead already has an active version from another source');
        return 'conflict';
      }
      if (current.companyName && record.companyName && current.companyName !== record.companyName) {
        conflict('COMPANY_CHANGED', `company changed from ${current.companyName} to ${record.companyName}`);
        return 'conflict';
      }
      const previous = { revision: current.revision, sourceHash: current.sourceHash, at: current.updatedAt };
      // A newer revision may omit optional identity/request fields (CSV exports
      // often do). Keep the last reviewed value instead of silently erasing it.
      const carried = {};
      for (const key of ['companyName', 'companyUrl', 'contactEmail', 'customerName', 'productId', 'product', 'unit', 'destination'])
        if (!record[key] && current[key]) carried[key] = current[key];
      if (record.quantity === null && current.quantity !== null) carried.quantity = current.quantity;
      if (!record.body && current.body) carried.body = current.body;
      for (const key of ['history', 'facts', 'requestedCertifications'])
        if (Array.isArray(record[key]) && record[key].length === 0 && (current[key]?.length ?? 0) > 0) carried[key] = current[key];
      Object.assign(current, record, carried, {
        sourceHash: digest, importId, updatedAt: now(clock), updatedBy: actor.subject,
        revisionHistory: [...(current.revisionHistory || []), previous].slice(-20),
        identity: { status: 'unknown', reviewerConfirmed: false, basis: [] },
      });
      // A carried fact is only valid while the effective history still contains
      // its verbatim quote. New history + omitted facts must not leave orphan
      // "evidence" that nothing in the record backs any more.
      const backed = current.facts.filter(fact => {
        const message = current.history.find(entry => entry.id === fact.sourceMessageId);
        return Boolean(message && message.body.includes(fact.quote));
      });
      if (backed.length !== current.facts.length) {
        current.factsDropped = (current.factsDropped ?? 0) + (current.facts.length - backed.length);
        current.facts = backed;
      }
      if (Object.keys(carried).length) current.carriedForward = [...new Set([...(current.carriedForward || []), ...Object.keys(carried)])];
      return 'updated';
    }
    if (db.leads.some(lead => lead.leadId === record.leadId)) {
      conflict('LEAD_ID_REUSED', 'the same leadId already exists with another source or revision');
      return 'conflict';
    }
    db.leads.push({
      ...record, sourceHash: digest, importId, createdAt: now(clock), updatedAt: now(clock), updatedBy: actor.subject,
      identity: { status: 'unknown', reviewerConfirmed: false, basis: [] }, revisionHistory: [],
    });
    if (db.leads.length > 2000) fail(409, 'INQUIRY_CAPACITY_LIMIT', 'Pilot storage limit reached; archive before importing more leads.');
    return 'inserted';
  }

  function planSelection(leadId, body, db = null) {
    const source = db ?? snapshot();
    const lead = source.leads.find(item => item.leadId === leadId);
    if (!lead) fail(404, 'INQUIRY_NOT_FOUND', 'The imported lead was not found.');
    if (body?.expectedRevision !== lead.revision) fail(409, 'INQUIRY_REVISION_CONFLICT', 'The lead changed; reload before selecting it.');
    if (body?.sourceHash !== lead.sourceHash) fail(409, 'INQUIRY_SOURCE_CHANGED', 'The lead source changed; reload before selecting it.');
    const asOfMs = body?.asOf === undefined ? Number(clock()) : Date.parse(`${body.asOf}T23:59:59.999Z`);
    if (!Number.isFinite(asOfMs)) fail(400, 'INQUIRY_ASOF_INVALID', 'asOf must be YYYY-MM-DD.');
    const decision = decisionFor(lead, asOfMs, staleDays);
    if (decision.decision !== 'follow_up') fail(409, 'INQUIRY_NOT_ELIGIBLE', `Only stale, evidence-complete leads can produce a follow-up draft (current: ${decision.decision}).`);
    const draft = draftFor(lead, decision, new Date(asOfMs).toISOString().slice(0, 10));
    return { lead, decision, draft, asOfMs };
  }

  function ownedConversationId(conversationId, actor) {
    if (conversationId === undefined || conversationId === null || conversationId === '') return null;
    if (typeof conversationId !== 'string' || !conversationId.trim() || conversationId.length > 200)
      fail(400, 'INQUIRY_CONVERSATION_INVALID', 'conversationId must be a bounded identifier.');
    const conversation = (store.read().conversations ?? []).find(item => item.id === conversationId);
    const owner = conversation?.createdBy ?? conversation?.subject;
    const workspace = conversation?.workspaceId;
    if (!conversation || owner !== actor.subject || (workspace !== undefined && workspace !== workspaceId))
      fail(403, 'INQUIRY_CONVERSATION_REFUSED', 'Attach only your own Workspace conversation, or omit it.');
    return conversationId;
  }

  const service = Object.freeze({
    /** Import authorized historical inquiries. Every rejected row is reported, never dropped silently. */
    async importInquiries(body, actor) {
      requireMember(actor);
      const format = body?.format === 'csv' ? 'csv' : body?.format === 'json' ? 'json' : null;
      if (!format) fail(400, 'INQUIRY_IMPORT_FORMAT', 'Use format csv or json.');
      const sourceName = text(body.sourceName, 'sourceName', 120, true) || (format === 'csv' ? 'inquiries.csv' : 'inquiries.json');
      const contentBytes = typeof body.content === 'string' ? Buffer.byteLength(body.content, 'utf8') : Buffer.byteLength(JSON.stringify(body.content ?? null), 'utf8');
      if (contentBytes > MAX_IMPORT_BYTES) fail(413, 'INQUIRY_IMPORT_TOO_LARGE', 'The import exceeds the 64 KiB input limit.');
      let records;
      try {
        if (format === 'csv') records = parseCsv(body.content);
        else {
          const parsed = typeof body.content === 'string' ? JSON.parse(body.content) : body.content;
          if (!parsed || parsed.schema !== INPUT_SCHEMA || !Array.isArray(parsed.inquiries))
            fail(400, 'INQUIRY_IMPORT_INVALID', `JSON import must be {"schema":"${INPUT_SCHEMA}","inquiries":[...]}.`);
          if (parsed.synthetic !== false) fail(400, 'INQUIRY_IMPORT_SYNTHETIC', 'Mark demo input as synthetic:false only when it is real authorized data.');
          records = parsed.inquiries;
        }
      } catch (error) {
        if (error instanceof InquiryError) throw error;
        fail(400, 'INQUIRY_IMPORT_INVALID', 'The import is not valid JSON or CSV.');
      }
      if (!Array.isArray(records) || records.length === 0) fail(400, 'INQUIRY_IMPORT_EMPTY', 'The import contains no rows.');
      if (records.length > MAX_ROWS) fail(413, 'INQUIRY_IMPORT_TOO_LARGE', `At most ${MAX_ROWS} inquiries may be imported at once.`);
      const normalized = [], rejected = [];
      records.forEach((record, index) => {
        try { normalized.push(normalizeRow(record, `row ${index + 1}`)); }
        catch (error) { rejected.push({ row: index + 1, code: error.code || 'INQUIRY_ROW_INVALID', message: error.message }); }
      });
      if (!normalized.length) {
        const error = new InquiryError(400, 'INQUIRY_IMPORT_REJECTED', 'No row passed validation; nothing was imported.');
        error.rejected = rejected;
        throw error;
      }
      return await command(actor, 'inquiry.import', body, db => {
        const importId = randomUUID();
        const counts = { inserted: 0, updated: 0, duplicate: 0, conflict: 0 };
        for (const record of normalized) counts[applyRow(db, record, importId, actor)]++;
        const record = {
          importId, sourceName, format, actor: actor.subject, at: now(clock), rows: records.length,
          accepted: normalized.length, rejected, inputSha256: hash({ format, sourceName, records }),
          ...counts,
        };
        db.imports.push(record);
        if (db.imports.length > 200) db.imports.shift();
        event(db, 'inquiry.imported', actor, { importId, ...counts, rejected: rejected.length });
        return record;
      });
    },

    status(actor) {
      requireActor(actor);
      const db = snapshot(), asOfMs = Number(clock());
      const counts = { follow_up: 0, need_evidence: 0, nurture: 0, hold: 0 };
      for (const lead of db.leads) counts[decisionFor(lead, asOfMs, staleDays).decision]++;
      return {
        engineVersion: VERSION, staleDays, asOf: new Date(asOfMs).toISOString(),
        counts: { leads: db.leads.length, selections: db.selections.length, imports: db.imports.length, conflicts: db.conflicts.length, ...counts },
        lastImport: db.imports.length ? db.imports[db.imports.length - 1] : null,
      };
    },

    opportunities({ asOfDate } = {}, actor) {
      requireActor(actor);
      const asOfMs = asOfDate === undefined ? Number(clock()) : Date.parse(`${asOfDate}T23:59:59.999Z`);
      if (!Number.isFinite(asOfMs)) fail(400, 'INQUIRY_ASOF_INVALID', 'asOf must be YYYY-MM-DD.');
      const db = snapshot();
      const cards = db.leads.map(lead => cardFor(lead, asOfMs, staleDays))
        .sort((a, b) => (decisionRank[a.decision] - decisionRank[b.decision]) || ((b.daysStale ?? -1) - (a.daysStale ?? -1)) || a.leadId.localeCompare(b.leadId));
      return {
        asOf: new Date(asOfMs).toISOString(), staleDays,
        summary: cards.reduce((accumulator, card) => { accumulator[card.decision]++; return accumulator; }, { follow_up: 0, need_evidence: 0, nurture: 0, hold: 0 }),
        cards,
      };
    },

    lead(leadId, actor) {
      requireActor(actor);
      const db = snapshot(), lead = db.leads.find(item => item.leadId === leadId);
      if (!lead) fail(404, 'INQUIRY_NOT_FOUND', 'The imported lead was not found.');
      return {
        card: cardFor(lead, Number(clock()), staleDays), history: lead.history, facts: lead.facts, identity: lead.identity,
        revisionHistory: lead.revisionHistory, conflicts: db.conflicts.filter(item => item.leadId === leadId).slice(-20),
      };
    },

    /** Human identity review binds to the exact imported source hash. */
    async reviewIdentity(leadId, body, actor) {
      requireMember(actor);
      const status = body?.status;
      if (!IDENTITY_STATES.has(status)) fail(400, 'INQUIRY_IDENTITY_INVALID', 'Use unknown, confirmed or conflicting.');
      const basis = Array.isArray(body.basis) ? body.basis.slice(0, 10) : [];
      for (const [index, entry] of basis.entries()) {
        if (!entry || typeof entry !== 'object') fail(400, 'INQUIRY_IDENTITY_INVALID', `basis[${index}] must be an object.`);
        text(entry.sourceId, `basis[${index}].sourceId`, 128);
        text(entry.quote, `basis[${index}].quote`, 1000);
        if (entry.officialUrl !== undefined && entry.officialUrl !== '') {
          const url = text(entry.officialUrl, `basis[${index}].officialUrl`, 500);
          if (!/^https?:\/\/[^\s]+$/u.test(url)) fail(400, 'INQUIRY_IDENTITY_INVALID', `basis[${index}].officialUrl must be http(s).`);
        }
      }
      return await command(actor, 'inquiry.identity', body, db => {
        const lead = db.leads.find(item => item.leadId === leadId);
        if (!lead) fail(404, 'INQUIRY_NOT_FOUND', 'The imported lead was not found.');
        if (body.sourceHash !== lead.sourceHash) fail(409, 'INQUIRY_SOURCE_CHANGED', 'The lead changed; re-review the current imported version.');
        if (status === 'confirmed' && !basis.length) fail(400, 'INQUIRY_IDENTITY_BASIS', 'Confirming an identity requires at least one recorded basis.');
        lead.identity = { status, reviewerConfirmed: status === 'confirmed', basis, reviewedBy: actor.subject, reviewedAt: now(clock) };
        lead.updatedAt = now(clock);
        event(db, 'inquiry.identity_reviewed', actor, { leadId, status });
        return { leadId, identity: lead.identity };
      });
    },

    /** Selecting a lead produces an unsent draft and a non-enabled Goal draft. It never sends or enables anything. */
    async selectLead(leadId, body, actor) {
      requireMember(actor);
      // Ownership is checked before anything is written.
      const conversationId = ownedConversationId(body?.conversationId, actor);
      const selection = await command(actor, 'inquiry.select', body, db => {
        const { lead, decision, draft, asOfMs } = planSelection(leadId, body, db);
        const record = {
          id: randomUUID(), leadId, at: now(clock), actor: actor.subject, requestId: body.requestId,
          sourceId: lead.sourceId, importId: lead.importId,
          leadRevision: lead.revision, leadSourceHash: lead.sourceHash, asOf: new Date(asOfMs).toISOString(),
          decision: decision.decision, daysStale: decision.daysStale,
          draft: { ...draft, sent: false, humanReviewRequired: true, humanReviewed: false },
          artifact: null,
          goalDraft: {
            draft: true, enabled: false, notWritten: true,
            title: `复联：${lead.companyName || lead.leadId}`,
            description: `基于 ${lead.sourceId}@${lead.revision} 的历史记录，向 ${lead.companyName || lead.leadId} 发出一次人工审核后的跟进。`,
            maxSteps: 3, maxOutputTokens: 12000,
            authorityRequired: '发送、报价与任何对外承诺需要单独的人工审批；本 Goal 草稿未启用、未写入 Runtime。',
          },
        };
        db.selections.push(record);
        if (db.selections.length > 500) db.selections.shift();
        event(db, 'inquiry.selected', actor, { leadId, selectionId: record.id, daysStale: decision.daysStale, artifactId: null });
        return record;
      });
      if (!artifacts) return selection;
      // The artifact is written only after the selection committed, so a rejected
      // or stale select can never leave an orphan draft file behind. A crash
      // between the two steps leaves a selection with `artifact: null`, which the
      // idempotent replay below repairs.
      const created = await artifacts.create({
        requestId: `inquiry-recovery-${selection.requestId}`,
        filename: selection.draft.filename,
        content: selection.draft.content,
        title: `未发送复联草稿 · ${selection.leadId}`,
        description: 'Unreviewed follow-up draft generated from imported inquiry history. NOT SENT.',
        metadata: {
          inquiryRecovery: {
            workspaceId,
            leadId: selection.leadId, sourceId: selection.sourceId, revision: selection.leadRevision,
            sourceHash: selection.leadSourceHash, importId: selection.importId, decision: selection.decision,
            sent: false, humanReviewRequired: true, humanReviewed: false, independentlyVerified: false,
          },
        },
        ...(conversationId ? { sourceConversationId: conversationId } : {}),
      });
      const reference = { artifactId: created.artifact.id, version: created.artifact.currentVersion, sha256: created.artifact.sha256, filename: created.artifact.filename };
      selection.artifact = await store.update(state => {
        const db = database(state);
        const stored = db.selections.find(item => item.id === selection.id);
        if (!stored) return reference;
        stored.artifact ??= reference;
        return stored.artifact;
      });
      return selection;
    },

    selections(actor) {
      requireActor(actor);
      return { selections: snapshot().selections.slice(-50).reverse() };
    },

    conflicts(actor) {
      requireActor(actor);
      return { conflicts: snapshot().conflicts.slice(-100).reverse() };
    },

    commandReceipt(action, body, actor) {
      requireActor(actor);
      if (typeof body?.requestId !== 'string' || !UUID.test(body.requestId)) fail(400, 'INQUIRY_REQUEST_ID_REQUIRED', 'A stable UUID requestId is required.');
      const receipt = snapshot().commands.find(item => item.requestId === body.requestId && item.actor === actor.subject);
      if (!receipt) return null;
      if (receipt.action !== action || receipt.digest !== hash({ action, actor: actor.subject, input: body }))
        fail(409, 'INQUIRY_IDEMPOTENCY_CONFLICT', 'The request ID was used with a different scope.');
      return receipt.result;
    },
  });
  return bridgeInjectedErrors(service, ErrorClass);
}

/**
 * Public-surface error bridge: internally the domain always throws its own
 * InquiryError; a host that injects its legacy error class receives every thrown
 * domain error (sync throw or async rejection) as an instance of that class.
 */
function bridgeInjectedErrors(service, ErrorClass) {
  if (ErrorClass === InquiryError) return service;
  const convert = error => {
    if (!(error instanceof InquiryError) || error instanceof ErrorClass) return error;
    const converted = new ErrorClass(error.status, error.code, error.message);
    for (const key of Object.keys(error)) if (!Object.hasOwn(converted, key)) converted[key] = error[key];
    return converted;
  };
  const bridged = {};
  for (const [name, method] of Object.entries(service)) {
    bridged[name] = (...args) => {
      try {
        const result = method.apply(service, args);
        return result && typeof result.then === 'function' ? result.catch(error => { throw convert(error); }) : result;
      } catch (error) { throw convert(error); }
    };
  }
  return Object.freeze(bridged);
}

/** HTTP mapping kept separate from the Host router, mirroring supply-http.mjs. */
function decodeLeadId(value, ErrorClass = InquiryError) {
  try { return decodeURIComponent(value); }
  catch { throw new ErrorClass(400, 'INQUIRY_PATH_INVALID', 'Invalid identifier encoding.'); }
}

export async function inquiryRecoveryHttp({ recovery, method, pathname, body = {}, query = {}, actor, ApiError: ErrorClass = InquiryError }) {
  if (method === 'GET') {
    if (pathname === '/api/inquiry-recovery/status') return { status: 200, body: recovery.status(actor) };
    if (pathname === '/api/inquiry-recovery/opportunities')
      return { status: 200, body: recovery.opportunities({ asOfDate: query.asOf }, actor) };
    if (pathname === '/api/inquiry-recovery/selections') return { status: 200, body: recovery.selections(actor) };
    if (pathname === '/api/inquiry-recovery/conflicts') return { status: 200, body: recovery.conflicts(actor) };
    const lead = pathname.match(/^\/api\/inquiry-recovery\/leads\/([^/]+)$/u);
    if (lead) {
      const leadId = decodeLeadId(lead[1], ErrorClass);
      return { status: 200, body: recovery.lead(leadId, actor) };
    }
  }
  if (method === 'POST') {
    if (pathname === '/api/inquiry-recovery/import') {
      // Per-row rejections must reach the operator, not only the thrown error.
      // The Host serializes the injected error class as {error:{code,message}}, so carry rows here.
      try { return { status: 201, body: await recovery.importInquiries(body, actor) }; }
      catch (error) {
        if (error?.code === 'INQUIRY_IMPORT_REJECTED' && Array.isArray(error.rejected))
          return { status: 400, body: { error: { code: error.code, message: error.message, rejected: error.rejected } } };
        throw error;
      }
    }
    const identity = pathname.match(/^\/api\/inquiry-recovery\/leads\/([^/]+)\/identity$/u);
    if (identity) return { status: 200, body: await recovery.reviewIdentity(decodeLeadId(identity[1], ErrorClass), body, actor) };
    const select = pathname.match(/^\/api\/inquiry-recovery\/leads\/([^/]+)\/select$/u);
    if (select) return { status: 201, body: await recovery.selectLead(decodeLeadId(select[1], ErrorClass), body, actor) };
  }
  return null;
}

export { InquiryError, parseCsv };
export default InquiryError;
