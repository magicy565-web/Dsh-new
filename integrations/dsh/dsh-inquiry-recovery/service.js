import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createInquiryRecoveryService, validateInquiryRecoveryState, inquiryRowSourceHash, normalizeInquiryRow, parseCsv, InquiryError } from '@workspace/domain-inquiry-recovery';

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const fail = (code, message, status = 400) => { throw new InquiryError(status, code, message); };
export function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    fail('INQUIRY_INPUT', 'Request contains unsupported fields.');
}
const check = signal => { if (signal?.aborted) fail('INQUIRY_CANCELLED', 'Inquiry operation cancelled.', 409); };
function sourceShape(source) {
  if (!source || !SHA.test(source.sha256 ?? '') || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > 65_536
    || !['csv', 'json'].includes(source.format) || source.attachment?.attachmentId !== `sha256:${source.sha256}` || source.attachment.bytes !== source.bytes)
    fail('INQUIRY_STORE_INVALID', 'Stored native source reference is invalid.', 500);
}
export function validateRoot(root) {
  keys(root, ['workspaces']);
  if (root.workspaces === undefined) return true;
  if (!root.workspaces || typeof root.workspaces !== 'object' || Array.isArray(root.workspaces)) fail('INQUIRY_STORE_INVALID', 'Invalid workspace partitions.', 500);
  for (const [id, partition] of Object.entries(root.workspaces)) {
    if (!UUID.test(id)) fail('INQUIRY_STORE_INVALID', 'Invalid native workspace id.', 500);
    keys(partition, ['inquiryRecovery']);
    const db = validateInquiryRecoveryState(partition, id);
    if (!db) continue;
    for (const entry of db.imports) sourceShape(entry.nativeSource);
    for (const item of db.selections) {
      if (item.contentReviews !== undefined && (!Array.isArray(item.contentReviews) || item.contentReviews.length > 100)) fail('INQUIRY_STORE_INVALID', 'Invalid draft review history.', 500);
      for (const [index, review] of (item.contentReviews ?? []).entries()) {
        if (review.revision !== index + 1 || !UUID.test(review.requestId ?? '') || !['approved', 'needs_changes'].includes(review.decision)
          || review.actor !== 'dsh-browser-admin' || review.draftSha256 !== item.draft?.sha256 || review.sourceHash !== item.leadSourceHash
          || typeof review.note !== 'string' || review.note.length > 2000)
          fail('INQUIRY_STORE_INVALID', 'Invalid draft review record.', 500);
      }
      if (!item.draft || item.draft.sent !== false || item.draft.humanReviewed !== false || item.draft.humanReviewRequired !== true
        || item.draft.sha256 !== digest(Buffer.from(item.draft.content ?? '', 'utf8'))
        || item.goalDraft?.enabled !== false || item.goalDraft?.notWritten !== true)
        fail('INQUIRY_STORE_INVALID', 'Stored drafts must remain unreviewed and unsent.', 500);
      if (item.nativeAttachment && (item.nativeAttachment.attachmentId !== `sha256:${item.draft.sha256}` || item.nativeAttachment.bytes !== Buffer.byteLength(item.draft.content)))
        fail('INQUIRY_STORE_INVALID', 'Stored draft attachment reference is invalid.', 500);
    }
    if (Buffer.byteLength(JSON.stringify(partition)) > 8 * 1024 * 1024) fail('INQUIRY_CAPACITY_LIMIT', 'Native inquiry workspace storage exceeds 8 MiB.', 409);
  }
  return true;
}
export function createStorageAdapter(global) {
  let tail = Promise.resolve();
  return {
    read: () => structuredClone(global.get()),
    update(mutator) {
      const job = tail.then(async () => {
        const root = structuredClone(global.get());
        const result = mutator(root);
        validateRoot(root);
        await global.set(root);
        return structuredClone(result);
      });
      tail = job.catch(() => {});
      return job;
    },
    drain: () => tail,
  };
}
function bounded(value) {
  const wire = JSON.stringify(value);
  if (wire.length > 64_000 || Buffer.byteLength(wire) > 192_000) fail('INQUIRY_CONTEXT_TOO_LARGE', 'Result exceeds the bounded context. Reduce the list limit or inspect the source file in the panel.', 413);
  return value;
}
function cardView(card) {
  const { draft, nextStep, evidence, ...rest } = card;
  return { ...rest, evidenceCount: evidence.length, assessmentKind: 'optional-business-rule', authorizationToSend: false };
}
const count = value => {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > 50) fail('INQUIRY_INPUT', 'Use a limit from 1 to 50.');
  return value;
};

export function createRecoveryService({ storage, registry, attachments, clock = Date.now, staleDays = 7 }) {
  if (!Number.isInteger(staleDays) || staleDays < 1 || staleDays > 365) throw new TypeError('staleDays must be from 1 to 365.');
  const lifetime = new AbortController(), pending = new Set();
  let mutationTail = Promise.resolve();
  function run(operation, signal) {
    const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    const job = Promise.resolve().then(() => { check(combined); return operation(combined); });
    pending.add(job); job.then(() => pending.delete(job), () => pending.delete(job));
    return job;
  }
  function mutate(operation, signal) {
    return run(combined => {
      const job = mutationTail.then(() => { check(combined); return operation(combined); });
      mutationTail = job.catch(() => {}); return job;
    }, signal);
  }
  function workspace(id) {
    if (typeof id !== 'string' || !UUID.test(id) || !registry.get(id)) fail('INQUIRY_WORKSPACE_REQUIRED', 'Select an existing native DSH workspace.', 404);
    return id;
  }
  const browser = id => ({ subject: 'dsh-browser-admin', role: 'admin', workspaceId: workspace(id) });
  function toolActor(execution) {
    const sessionId = execution?.agent?.session?.id;
    const owner = sessionId && registry.list().find(row => row.sessionIds.includes(sessionId));
    if (!owner) fail('INQUIRY_WORKSPACE_REQUIRED', 'This Agent must belong to a native DSH workspace.', 403);
    return { subject: `agent:${sessionId}`, role: 'operator', workspaceId: owner.id };
  }
  function currentOwner(execution, id) {
    if (toolActor(execution).workspaceId !== id) fail('INQUIRY_WORKSPACE_REQUIRED', 'The native session workspace changed.', 403);
  }
  const partition = id => storage.read().workspaces?.[id] ?? {};
  function core(id, signal, { importedSource, origin, reviewRevision } = {}) {
    return createInquiryRecoveryService({ workspaceId: id, clock, staleDays, store: {
      read: () => partition(id),
      update: mutator => storage.update(root => {
        check(signal); workspace(id);
        if (origin && !registry.get(id).sessionIds.includes(origin.sessionId)) fail('INQUIRY_WORKSPACE_REQUIRED', 'The native session workspace changed.', 403);
        root.workspaces ??= {}; root.workspaces[id] ??= {};
        const result = mutator(root.workspaces[id]);
        if (importedSource && result.importId) {
          const entry = root.workspaces[id].inquiryRecovery.imports.find(row => row.importId === result.importId);
          if (!entry) fail('INQUIRY_NOT_FOUND', 'This import receipt is outside retained history.', 404);
          if (entry.nativeSource && entry.nativeSource.sha256 !== importedSource.sha256) fail('INQUIRY_IDEMPOTENCY_CONFLICT', 'This request ID belongs to different original bytes.', 409);
          entry.nativeSource ??= importedSource;
          result.nativeSource = entry.nativeSource;
        }
        if (origin && result.draft) result.nativeOrigin ??= origin;
        if (reviewRevision !== undefined && result.identity) result.identity.reviewRevision = reviewRevision + 1;
        return result;
      }),
    } });
  }
  async function fileBytes(ref, sha256, bytes, signal) {
    check(signal);
    if (!attachments?.readFileStream) fail('INQUIRY_SOURCE_UNAVAILABLE', 'The native attachment service is unavailable.', 503);
    const chunks = []; let size = 0;
    try {
      for await (const chunk of attachments.readFileStream(ref, signal)) {
        check(signal); size += chunk.length;
        if (size > bytes) fail('INQUIRY_SOURCE_CHANGED', 'Native attachment size changed.', 409);
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) {
      check(signal); if (error instanceof InquiryError) throw error;
      fail('INQUIRY_SOURCE_UNAVAILABLE', 'The native source attachment cannot be read.', 503);
    }
    check(signal);
    const data = Buffer.concat(chunks);
    if (data.length !== bytes || digest(data) !== sha256) fail('INQUIRY_SOURCE_CHANGED', 'Native attachment bytes do not match the source hash.', 409);
    return data;
  }
  async function verifySource(id, leadId, signal) {
    const db = partition(id).inquiryRecovery;
    const lead = db?.leads.find(row => row.leadId === leadId);
    if (!lead) fail('INQUIRY_NOT_FOUND', 'The imported inquiry does not exist.', 404);
    const source = db.imports.find(entry => entry.importId === lead.importId)?.nativeSource;
    sourceShape(source);
    const bytes = await fileBytes(source.attachment, source.sha256, source.bytes, signal);
    let rows;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
      rows = source.format === 'csv' ? parseCsv(text) : JSON.parse(text).inquiries;
    } catch { fail('INQUIRY_SOURCE_CHANGED', 'The stored source no longer parses as imported.', 409); }
    const matching = Array.isArray(rows) && rows.find(row => { try { return inquiryRowSourceHash(row) === lead.sourceHash; } catch { return false; } });
    if (!matching)
      fail('INQUIRY_SOURCE_CHANGED', 'The current normalized row is not backed by the stored original.', 409);
    const normalized = normalizeInquiryRow(matching);
    const carriedForward = Object.keys(normalized).filter(key => !isDeepStrictEqual(normalized[key], lead[key]));
    if (carriedForward.some(key => !(lead.carriedForward ?? []).includes(key))) fail('INQUIRY_SOURCE_CHANGED', 'Stored inquiry fields no longer match their imported row.', 409);
    const current = partition(id).inquiryRecovery.leads.find(row => row.leadId === leadId);
    if (current?.revision !== lead.revision || current.sourceHash !== lead.sourceHash) fail('INQUIRY_SOURCE_CHANGED', 'Inquiry changed during source verification.', 409);
    return { ...source, importId: lead.importId, normalizedRowHash: lead.sourceHash, rawBytesVerified: true, normalizedRowMatched: true,
      carriedForward, effectiveRowMatchesOriginal: carriedForward.length === 0, independentlyVerified: false };
  }
  async function read(id, leadId, actor, signal) {
    workspace(id);
    const source = await verifySource(id, leadId, signal);
    const data = core(id, signal).lead(leadId, actor);
    check(signal);
    if (data.card.sourceHash !== source.normalizedRowHash) fail('INQUIRY_SOURCE_CHANGED', 'Inquiry changed before the verified context could be returned.', 409);
    return bounded({ workspaceId: id, ...data, card: cardView(data.card), source, contentRole: 'reference-data' });
  }
  function draftView(id, item, actor) {
    const current = core(id).lead(item.leadId, actor).card;
    const { goalDraft, artifact, ...draft } = item;
    const latest = item.contentReviews?.at(-1);
    const identity = core(id).lead(item.leadId, actor).identity;
    const reviewCurrent = current.revision === item.leadRevision && current.sourceHash === item.leadSourceHash
      && current.decision === 'follow_up' && latest?.identityReviewRevision === (identity.reviewRevision ?? 0);
    return { ...draft, contentReview: { revision: item.contentReviews?.length ?? 0, latest: latest ?? null,
      state: !latest ? 'pending' : latest.decision === 'approved' && !reviewCurrent ? 'stale' : latest.decision }, authorizationToSend: false,
      sourceRevisionMatches: current.revision === item.leadRevision && current.sourceHash === item.leadSourceHash,
      ruleEligibleNow: current.decision === 'follow_up',
      verification: { originalSourceBytes: 'not-rechecked-by-history-list', draftAttachmentBytes: 'not-rechecked-by-history-list' }, contentRole: 'unreviewed-draft' };
  }
  function drafts(id, actor, leadId) {
    const window = core(id).selections(actor).selections;
    const matches = window.filter(item => !leadId || item.leadId === leadId);
    return bounded({ workspaceId: id, historyOnly: true, retainedWindow: window.length, matching: matches.length,
      items: matches.slice(0, 10).map(item => draftView(id, item, actor)) });
  }
  const service = {
    workspaces: () => registry.list().map(row => ({ id: row.id, title: row.title })),
    status(id) { const actor = browser(id); return { workspaceId: id, ...core(id).status(actor) }; },
    list(id, query = {}, actor = browser(id)) {
      workspace(id); keys(query, ['q', 'decision', 'limit']);
      if (query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 200)) fail('INQUIRY_INPUT', 'Use a short search phrase.');
      if (query.decision && !['follow_up', 'need_evidence', 'nurture', 'hold'].includes(query.decision)) fail('INQUIRY_INPUT', 'Unknown assessment filter.');
      const result = core(id).opportunities({}, actor), q = (query.q ?? '').trim().toLowerCase();
      const matches = result.cards.filter(card => (!query.decision || card.decision === query.decision)
        && (!q || [card.leadId, card.company.name, card.request.product].join('\n').toLowerCase().includes(q)));
      return bounded({ workspaceId: id, asOf: result.asOf, staleDays, summary: result.summary, total: matches.length,
        items: matches.slice(0, count(query.limit)).map(cardView), sourceCheck: 'metadata-only', contentRole: 'reference-data' });
    },
    read(id, leadId, signal) { const actor = browser(id); return run(combined => read(id, leadId, actor, combined), signal); },
    drafts(id) { return drafts(workspace(id), browser(id)); },
    reviewDraft(id, draftId, body, signal) {
      const actor = browser(id);
      keys(body, ['requestId', 'expectedReviewRevision', 'draftSha256', 'sourceHash', 'decision', 'note']);
      if (!UUID.test(body.requestId ?? '') || !['approved', 'needs_changes'].includes(body.decision)
        || typeof body.note !== 'string' || !body.note.trim() || body.note.length > 2000)
        fail('INQUIRY_INPUT', 'Provide a review decision, note and stable UUID.');
      return mutate(async combined => {
        const item = partition(id).inquiryRecovery?.selections.find(row => row.id === draftId);
        if (!item) fail('INQUIRY_NOT_FOUND', 'Draft not found.', 404);
        if (body.draftSha256 !== item.draft.sha256 || body.sourceHash !== item.leadSourceHash) fail('INQUIRY_SOURCE_CHANGED', 'The selected draft/source does not match.', 409);
        const prior = item.contentReviews?.find(row => row.requestId === body.requestId);
        if (prior) {
          if (prior.decision !== body.decision || prior.note !== body.note || prior.revision !== body.expectedReviewRevision + 1)
            fail('INQUIRY_IDEMPOTENCY_CONFLICT', 'This review request was already used with different content.', 409);
          return draftView(id, item, actor);
        }
        if (body.expectedReviewRevision !== (item.contentReviews?.length ?? 0)) fail('INQUIRY_REVIEW_CHANGED', 'Draft review changed. Reload before reviewing.', 409);
        if ((item.contentReviews?.length ?? 0) >= 100) fail('INQUIRY_CAPACITY_LIMIT', 'This draft has reached its 100-review history limit.', 409);
        const current = core(id).lead(item.leadId, actor);
        if (body.decision === 'approved') {
          await read(id, item.leadId, actor, combined);
          if (current.card.sourceHash !== item.leadSourceHash || current.card.revision !== item.leadRevision || current.card.decision !== 'follow_up')
            fail('INQUIRY_NOT_ELIGIBLE', 'The current source, identity or business conditions no longer support this draft.', 409);
          if (!item.nativeAttachment) fail('INQUIRY_SOURCE_UNAVAILABLE', 'The draft attachment is unavailable.', 409);
          await fileBytes(item.nativeAttachment, item.draft.sha256, Buffer.byteLength(item.draft.content), combined);
        }
        await storage.update(root => {
          check(combined); workspace(id);
          const stored = root.workspaces[id].inquiryRecovery.selections.find(row => row.id === draftId);
          stored.contentReviews ??= [];
          stored.contentReviews.push({ revision: stored.contentReviews.length + 1, requestId: body.requestId, decision: body.decision, note: body.note,
            draftSha256: body.draftSha256, sourceHash: body.sourceHash, identityReviewRevision: current.identity.reviewRevision ?? 0,
            actor: actor.subject, at: new Date(clock()).toISOString() });
        });
        return draftView(id, partition(id).inquiryRecovery.selections.find(row => row.id === draftId), actor);
      }, signal);
    },
    import(id, body, signal) {
      const actor = browser(id); keys(body, ['requestId', 'format', 'sourceName', 'dataBase64', 'authorized']);
      if (body.authorized !== true) fail('INQUIRY_IMPORT_AUTHORITY', 'Confirm that you may import this file.');
      if (!['csv', 'json'].includes(body.format) || typeof body.sourceName !== 'string' || !/^[^/\\\u0000-\u001f]{1,120}$/u.test(body.sourceName)) fail('INQUIRY_INPUT', 'Use a CSV/JSON filename.');
      if (typeof body.dataBase64 !== 'string' || body.dataBase64.length > 87_384) fail('INQUIRY_IMPORT_TOO_LARGE', 'Import files are limited to 64 KiB.', 413);
      const bytes = Buffer.from(body.dataBase64, 'base64');
      if (bytes.length < 1 || bytes.length > 65_536 || bytes.toString('base64') !== body.dataBase64) fail('INQUIRY_INPUT', 'Use canonical base64 file bytes.');
      let content; try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''); } catch { fail('INQUIRY_INPUT', 'The source must be UTF-8 text.'); }
      return mutate(async combined => {
        if (!attachments?.saveFile) fail('INQUIRY_SOURCE_UNAVAILABLE', 'Native attachments are unavailable.', 503);
        const attachment = await attachments.saveFile({ data: bytes, name: body.sourceName }); check(combined);
        const nativeSource = { attachment, sha256: digest(bytes), bytes: bytes.length, name: body.sourceName, format: body.format };
        sourceShape(nativeSource);
        return core(id, combined, { importedSource: nativeSource }).importInquiries({ requestId: body.requestId, format: body.format, sourceName: body.sourceName, content }, actor);
      }, signal);
    },
    review(id, leadId, body, signal) {
      const actor = browser(id); keys(body, ['requestId', 'sourceHash', 'status', 'basis', 'expectedReviewRevision']);
      return mutate(async combined => {
        const recovery = core(id, combined), current = recovery.lead(leadId, actor);
        if (body.sourceHash !== current.card.sourceHash) fail('INQUIRY_SOURCE_CHANGED', 'The inquiry source changed. Reload before reviewing.', 409);
        const input = { ...body, leadId }, receipt = recovery.commandReceipt('inquiry.identity', input, actor);
        if (receipt) return receipt;
        const revision = current.identity.reviewRevision ?? 0;
        if (body.expectedReviewRevision !== revision) fail('INQUIRY_REVIEW_CHANGED', 'Identity review changed. Reload before reviewing.', 409);
        if (body.status === 'confirmed') await verifySource(id, leadId, combined);
        return core(id, combined, { reviewRevision: revision }).reviewIdentity(leadId, input, actor);
      }, signal);
    },
    toolRead(body, execution) {
      keys(body, ['action', 'leadId', 'q', 'decision', 'limit']);
      const actor = toolActor(execution), id = actor.workspaceId;
      return run(async combined => {
        let result;
        if (!body.action || body.action === 'list') result = service.list(id, { q: body.q, decision: body.decision, limit: body.limit }, actor);
        else if (body.action === 'read') result = await read(id, body.leadId, actor, combined);
        else if (body.action === 'drafts') result = drafts(id, actor, body.leadId);
        else fail('INQUIRY_INPUT', 'Use list, read or drafts.');
        currentOwner(execution, id); return result;
      }, execution?.signal);
    },
    proposeDraft(body, execution) {
      keys(body, ['requestId', 'leadId', 'expectedRevision', 'sourceHash', 'content']);
      if (typeof body.content !== 'string' || !body.content.trim() || [...body.content].length > 4000) fail('INQUIRY_INPUT', 'Provide your own draft text, at most 4000 characters.');
      const actor = toolActor(execution), id = actor.workspaceId;
      const sessionId = execution.agent.session.id;
      if (typeof execution.callId !== 'string' || execution.callId.length > 150) fail('INQUIRY_INPUT', 'A native tool-call identity is required.');
      return mutate(async combined => {
        const context = await read(id, body.leadId, actor, combined);
        currentOwner(execution, id);
        if (context.card.revision !== body.expectedRevision || context.card.sourceHash !== body.sourceHash) fail('INQUIRY_SOURCE_CHANGED', 'The selected inquiry revision/source changed.', 409);
        if (context.card.decision !== 'follow_up') fail('INQUIRY_NOT_ELIGIBLE', 'The optional recovery rules do not allow a draft for this record.', 409);
        if (context.source.carriedForward.length) fail('INQUIRY_CARRIED_FIELDS', 'This imported revision carries older fields. Reimport a complete current row before creating a draft.', 409);
        const origin = { kind: 'native-agent-proposal', sessionId, callId: execution.callId, independentlyVerified: false };
        const recovery = core(id, combined, { origin });
        const selected = await recovery.selectLead(body.leadId, { requestId: body.requestId, leadId: body.leadId,
          expectedRevision: body.expectedRevision, sourceHash: body.sourceHash, draftContent: body.content }, actor);
        const stored = partition(id).inquiryRecovery.selections.find(row => row.id === selected.id);
        if (!stored) fail('INQUIRY_NOT_FOUND', 'This draft receipt is outside the retained history.', 404);
        if (!stored.nativeAttachment) {
          check(combined);
          if (!attachments?.saveFile) fail('INQUIRY_SOURCE_UNAVAILABLE', 'Native attachments are unavailable.', 503);
          const attachment = await attachments.saveFile({ data: Buffer.from(selected.draft.content), name: selected.draft.filename });
          check(combined);
          await storage.update(root => {
            check(combined);
            const stored = root.workspaces[id].inquiryRecovery.selections.find(row => row.id === selected.id);
            stored.nativeAttachment ??= attachment;
          });
        }
        const complete = partition(id).inquiryRecovery.selections.find(row => row.id === selected.id);
        await fileBytes(complete.nativeAttachment, complete.draft.sha256, Buffer.byteLength(complete.draft.content), combined);
        currentOwner(execution, id);
        return bounded({ ...draftView(id, complete, actor),
          verification: { originalSourceBytes: 'verified-during-this-proposal', draftAttachmentBytes: 'verified-during-this-proposal' }, attachmentBytesVerified: true });
      }, execution?.signal);
    },
    sourceFile(id, importId, signal) {
      browser(id);
      return run(async combined => {
        const source = partition(id).inquiryRecovery?.imports.find(row => row.importId === importId)?.nativeSource;
        sourceShape(source);
        return { name: source.name, data: await fileBytes(source.attachment, source.sha256, source.bytes, combined) };
      }, signal);
    },
    draftFile(id, selectionId, signal) {
      const actor = browser(id);
      return run(async combined => {
        const selected = core(id).selections(actor).selections.find(row => row.id === selectionId);
        if (!selected?.nativeAttachment) fail('INQUIRY_NOT_FOUND', 'The native draft attachment is unavailable.', 404);
        return { name: selected.draft.filename, data: await fileBytes(selected.nativeAttachment, selected.draft.sha256, Buffer.byteLength(selected.draft.content), combined) };
      }, signal);
    },
    async close() { lifetime.abort(); await Promise.allSettled([...pending]); await storage.drain?.(); },
  };
  return service;
}
