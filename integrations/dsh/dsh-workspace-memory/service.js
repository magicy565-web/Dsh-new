import { createBusinessMemoryService, validateMemoryState, STATE_KEY, BusinessMemoryError } from '@workspace/domain-business-memory';

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
export const fail = (code, message, status = 400) => { throw new BusinessMemoryError(status, code, message); };
export const assertKeys = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('MEMORY_INPUT', 'Expected a request object.');
  const unexpected = Object.keys(value).filter(key => !keys.includes(key));
  if (unexpected.length) fail('MEMORY_INPUT', `Unsupported fields: ${unexpected.slice(0, 8).map(key => key.slice(0, 80)).join(', ')}.`);
};
const check = signal => { if (signal?.aborted) fail('MEMORY_CANCELLED', 'Memory operation cancelled.', 409); };

// Keep the retained domain key. Native storage owns media, validation on load, durability and change events.
export function validateRoot(root) {
  assertKeys(root, ['workspaces']);
  if (root.workspaces === undefined) return true;
  if (!root.workspaces || typeof root.workspaces !== 'object' || Array.isArray(root.workspaces)) fail('MEMORY_STATE_INVALID', 'Invalid memory partitions.', 500);
  for (const [id, partition] of Object.entries(root.workspaces)) {
    if (!UUID.test(id)) fail('MEMORY_STATE_INVALID', 'Invalid native workspace identity.', 500);
    assertKeys(partition, [STATE_KEY]);
    validateMemoryState(partition[STATE_KEY]);
    if ([...partition[STATE_KEY].records, ...partition[STATE_KEY].receipts].some(record => record.workspaceId !== id)) fail('MEMORY_STATE_INVALID', 'Memory partition mismatch.', 500);
  }
  return true;
}

export function createStorageAdapter(global) {
  let tail = Promise.resolve();
  return {
    read: () => structuredClone(global.get()),
    update(mutator) {
      const operation = tail.then(async () => {
        const draft = structuredClone(global.get());
        const result = mutator(draft);
        validateRoot(draft);
        await global.set(draft);
        return structuredClone(result);
      });
      tail = operation.catch(() => {});
      return operation;
    },
    drain: () => tail,
  };
}

const proposalKeys = ['requestId', 'subjectType', 'subjectId', 'subjectLabel', 'factKey', 'kind', 'statement', 'detail', 'confidence', 'tags', 'source', 'expiresAt', 'supersedesId'];
const queryKeys = ['q', 'subjectType', 'subjectId', 'factKey', 'kind', 'limit'];

export function createMemoryService({ storage, registry, getLibrary = () => null, clock = Date.now }) {
  const lifetime = new AbortController();
  const pending = new Set();
  let mutationTail = Promise.resolve();
  function run(operation, signal) {
    const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    const job = Promise.resolve().then(() => { check(combined); return operation(combined); });
    pending.add(job);
    job.then(() => pending.delete(job), () => pending.delete(job));
    return job;
  }
  function mutate(operation, signal) {
    return run(combined => {
      const job = mutationTail.then(() => { check(combined); return operation(combined); });
      mutationTail = job.catch(() => {});
      return job;
    }, signal);
  }
  function workspace(id) {
    if (typeof id !== 'string' || !UUID.test(id) || !registry.get(id)) fail('MEMORY_WORKSPACE_REQUIRED', 'Select an existing native DSH workspace.', 404);
    return registry.get(id);
  }
  function browser(id) {
    workspace(id);
    // DSH Web currently represents one authenticated local administrator, not a member/role table.
    return { actor: { subject: 'dsh-browser-admin', role: 'admin', workspaceId: id } };
  }
  function toolContext(execution) {
    const sessionId = execution?.agent?.session?.id;
    const owner = sessionId && registry.list().find(item => item.sessionIds.includes(sessionId));
    if (!owner) fail('MEMORY_WORKSPACE_REQUIRED', 'This tool requires an Agent session attached to a native workspace.', 403);
    return { actor: { subject: `agent:${sessionId}`, role: 'operator', workspaceId: owner.id }, sessionId };
  }
  async function verifyDocument(source, signal) {
    check(signal);
    const library = getLibrary();
    if (!library) fail('MEMORY_SOURCE_UNAVAILABLE', 'The native Workspace Library plugin is unavailable.', 503);
    let result;
    try { result = await library.readReferences([{ documentId: `doc_${source.documentId}`, version: source.version, sha256: source.sha256 }], { signal }); }
    catch (error) { check(signal); throw error; }
    check(signal);
    if (!getLibrary()) fail('MEMORY_SOURCE_UNAVAILABLE', 'The source plugin was unloaded during verification.', 503);
    return { verified: true, sha256: result.items[0].source.sha256, label: result.items[0].source.title };
  }
  function core(signal) {
    return createBusinessMemoryService({
      storage: { read: storage.read, update: mutator => storage.update(draft => { check(signal); return mutator(draft); }) },
      resolveWorkspace: actor => { workspace(actor.workspaceId); return actor; },
      verifySource: (source) => {
        if (source.kind !== 'document') fail('MEMORY_SOURCE_UNSUPPORTED', 'This source adapter is not installed.');
        return verifyDocument(source, signal);
      }, clock,
    });
  }
  function normalizeProposal(body, context, execution) {
    assertKeys(body, proposalKeys); // activate, actor, role, workspaceId and proof flags are never accepted.
    let source = body.source;
    if (execution && (!source || source.kind === 'conversation')) {
      if (source) {
        assertKeys(source, ['kind', 'label']);
        if (source.label !== undefined && (typeof source.label !== 'string' || source.label.length > 200)) fail('MEMORY_SOURCE_INVALID', 'Source label must be bounded text.');
      }
      if (typeof execution.callId !== 'string' || execution.callId.length > 150) fail('MEMORY_SOURCE_INVALID', 'A native tool-call identity is required.');
      source = { kind: 'conversation', ref: `${context.sessionId}#tool:${execution.callId}`, label: 'DSH conversation / tool call' };
    } else {
      if (!source) fail('MEMORY_SOURCE_INVALID', 'Provide an exact source.');
      if (source.kind === 'document') {
        assertKeys(source, ['kind', 'documentId', 'version', 'sha256', 'label']);
        if (typeof source.documentId !== 'string' || !source.documentId.startsWith('doc_')) fail('MEMORY_SOURCE_INVALID', 'Select a native library document version.');
        source = { ...source, documentId: source.documentId.slice(4) };
      } else if (!execution && source.kind === 'operator') {
        assertKeys(source, ['kind', 'basis', 'label']);
      } else fail('MEMORY_SOURCE_UNSUPPORTED', 'Use a native document, or the current conversation for Agent proposals.');
    }
    return { ...body, source };
  }
  async function availability(record, signal) {
    if (record.source.kind !== 'document') return { available: true };
    const match = /^document:([a-f0-9-]{36})@([1-9][0-9]*)$/u.exec(record.source.ref);
    if (!match) return { available: false, code: 'MEMORY_SOURCE_INVALID' };
    try {
      await verifyDocument({ documentId: match[1], version: Number(match[2]), sha256: record.source.sha256 }, signal);
      return { available: true };
    } catch (error) {
      check(signal);
      return { available: false, code: error.code ?? 'MEMORY_SOURCE_UNAVAILABLE' };
    }
  }
  function checkRevision(context, body) {
    const prior = storage.read().workspaces?.[context.actor.workspaceId]?.[STATE_KEY]?.receipts
      .some(item => item.subject === context.actor.subject && item.requestId === body.requestId);
    if (!prior && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== core().status(context).revision))
      fail('MEMORY_REVISION_CONFLICT', 'Memory changed. Refresh before reviewing it.', 409);
  }
  return {
    workspaces: () => registry.list().map(item => ({ id: item.id, title: item.title })),
    state(id, query = {}, signal) {
      assertKeys(query, [...queryKeys, 'status']);
      return run(async combined => {
        const context = browser(id), service = core(combined);
        const rows = service.recall(context, { ...query, ...(query.q ? {} : { q: undefined }), status: query.status ?? 'proposed' });
        const items = [];
        for (const row of rows.items) items.push({ ...row, sourceState: await availability(row, combined) });
        check(combined);
        return { ...rows, items, ...service.status(context), sourceLibraryAvailable: !!getLibrary(), verifiableSources: getLibrary() ? ['document'] : [] };
      }, signal);
    },
    sources(id, signal) {
      browser(id);
      return run(async combined => { const result = await getLibrary()?.referenceCandidates({ limit: 100 }); check(combined); return result ?? { items: [], total: 0 }; }, signal);
    },
    read(id, recordId, signal) {
      return run(async combined => { const { record } = core(combined).read(browser(id), recordId); return { record, sourceState: await availability(record, combined) }; }, signal);
    },
    propose(id, body, signal) {
      return mutate(combined => { const context = browser(id); return core(combined).propose(context, normalizeProposal(body, context)); }, signal);
    },
    review(id, recordId, body, signal) {
      assertKeys(body, ['requestId', 'expectedRevision', 'decision', 'note']);
      return mutate(combined => {
        const context = browser(id); checkRevision(context, body);
        const service = core(combined), { record } = service.read(context, recordId);
        if (body.decision === 'approve' && record.expiresAt && Date.parse(record.expiresAt) <= clock()) fail('MEMORY_EXPIRED', 'The proposed memory has already expired.', 409);
        return service.review(context, recordId, { requestId: body.requestId, decision: body.decision, note: body.note });
      }, signal);
    },
    revoke(id, recordId, body, signal) {
      assertKeys(body, ['requestId', 'expectedRevision', 'reason']);
      return mutate(combined => { const context = browser(id); checkRevision(context, body); return core(combined).revoke(context, recordId, { requestId: body.requestId, reason: body.reason }); }, signal);
    },
    toolPropose(body, execution) {
      return mutate(combined => { const context = toolContext(execution); return core(combined).propose(context, normalizeProposal(body, context, execution)); }, execution?.signal);
    },
    recall(query = {}, execution) {
      assertKeys(query, queryKeys);
      return run(async combined => {
        const context = toolContext(execution), service = core(combined);
        const matches = service.recall(context, { ...query, ...(query.q ? {} : { q: undefined }), status: 'active' });
        const items = [], excluded = [];
        let bytes = 0;
        for (const row of matches.items) {
          check(combined);
          const source = await availability(row, combined);
          if (!row.usable || !source.available || !service.assertFacts(context, { ids: [row.id] }).current) {
            excluded.push({ id: row.id, code: !row.usable ? 'MEMORY_EXPIRED' : source.code ?? 'MEMORY_CHANGED' });
            continue;
          }
          const { detail, ...item } = row;
          const size = Buffer.byteLength(JSON.stringify(item), 'utf8');
          if (bytes + size > 24_000) continue;
          bytes += size; items.push(item);
        }
        check(combined);
        // Later source IO may outlive an earlier document's availability. Finish on one
        // native library snapshot, deduplicating pins shared by multiple memory facts.
        const pins = new Map();
        for (const item of items.filter(item => item.source.kind === 'document')) {
          const match = /^document:([a-f0-9-]{36})@([1-9][0-9]*)$/u.exec(item.source.ref);
          const pin = { documentId: `doc_${match[1]}`, version: Number(match[2]), sha256: item.source.sha256 };
          pins.set(JSON.stringify(pin), pin);
        }
        if (pins.size) {
          const library = getLibrary();
          if (!library?.checkReferenceSet) fail('MEMORY_SOURCE_UNAVAILABLE', 'The native source validation service is unavailable.', 503);
          try { await library.checkReferenceSet([...pins.values()]); } catch (error) { check(combined); throw error; }
          check(combined);
        }
        // A replacement/revocation landing during a later source read invalidates earlier selections too.
        const current = service.assertFacts(context, { ids: items.map(item => item.id) });
        if (!current.current) fail('MEMORY_CHANGED', 'Memory changed during recall. Read it again.', 409);
        const status = service.status(context);
        const population = Object.fromEntries(['records', 'active', 'proposed', 'rejected', 'superseded', 'revoked', 'expired'].map(key => [key, status[key]]));
        return { workspaceId: context.actor.workspaceId, revision: current.revision, items, matching: matches.total, scanned: matches.items.length,
          omitted: matches.total - items.length, excluded, searchScope: 'approved-active-only', population, contentRole: 'reference-data' };
      }, execution?.signal);
    },
    async close() { lifetime.abort(); await Promise.allSettled([...pending]); await storage.drain?.(); },
  };
}
