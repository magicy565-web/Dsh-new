/**
 * Optional self-hosted Mem0/Docling adapters for the original Workspace Library.
 * ERPNext exact-record reads are owned by PR #86 (workspace-free-trade), not here.
 * This module never creates an Agent loop, policy registry, private store or grant.
 * Production Host/session integration and any vector-memory approval are absent.
 */
import { createHash } from 'node:crypto';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const own = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[\p{L}\p{N}_.:/@ -]+$/u.test(value);
const smallText = (value, max = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value);
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const isVersion = value => Number.isSafeInteger(value) && value > 0;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const CANONICAL_CONTEXT_STORE = 'Workspace Library';

/** Length-prefix-safe tuple encoding, unlike `workspace:${id}:customer:${id}`. */
export function memoryPartitionKey(workspaceId, customerId) {
  if (!identifier(workspaceId) || !identifier(customerId)) fail('OSS_MEMORY_PARTITION_INVALID');
  return 'workspace-customer-v2:' + Buffer.from(JSON.stringify([workspaceId, customerId]), 'utf8').toString('base64url');
}

function origin(raw) {
  if (typeof raw !== 'string') fail('OSS_URL_NOT_CONFIGURED');
  let parsed;
  try { parsed = new URL(raw); } catch { fail('OSS_URL_INVALID'); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '') ||
    !(parsed.protocol === 'https:' || parsed.protocol === 'http:' && ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(parsed.hostname))) fail('OSS_URL_UNSAFE');
  return parsed.origin;
}
function credentials(config, parts) {
  if (!own(config)) fail('OSS_CONFIGURATION_REQUIRED');
  for (const part of parts) if (typeof config[part] !== 'string' || !config[part] || /[\r\n]/u.test(config[part])) fail('OSS_CREDENTIAL_REQUIRED');
  return origin(config.baseURL);
}
async function json(response, signal, max = 2 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) fail('OSS_RESPONSE_INVALID');
  let size = 0; const chunks = [];
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > max) fail('OSS_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally { signal?.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('OSS_RESPONSE_INVALID'); }
}
function transport({ baseURL, headers = {}, fetchImpl = globalThis.fetch, timeoutMs = 60000, label }) {
  if (typeof fetchImpl !== 'function') fail('OSS_FETCH_REQUIRED');
  const base = origin(baseURL);
  return async (pathname, { method = 'GET', body, signal, multipart = false } = {}) => {
    if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) fail('OSS_PATH_INVALID');
    const stop = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, stop]) : stop;
    let response;
    try {
      response = await fetchImpl(base + pathname, { method, headers: { Accept: 'application/json', ...headers,
        ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}), redirect: 'error', signal: requestSignal });
    } catch { if(signal?.aborted)fail(`${label}_CANCELLED`);if(stop.aborted)fail(`${label}_TIMEOUT`);fail(`${label}_UNAVAILABLE`); }
    try {
      if (!response.ok || response.redirected) fail(`${label}_UPSTREAM_REFUSED`);
      return await json(response,requestSignal);
    } catch(error){if(signal?.aborted)fail(`${label}_CANCELLED`);if(stop.aborted)fail(`${label}_TIMEOUT`);throw error;}
    finally{if(response.body&&!response.body.locked)void response.body.cancel().catch(()=>{});}
  };
}

/**
 * Mem0 OSS `/search` is embedding/semantic search, not a non-vector history DB.
 * The trusted Host MUST keep this entire client unconfigured until the owner
 * expressly approves that behavior. Low-level methods are for isolated tests
 * and a future explicit owner-reviewed integration, not Pi tools by default.
 */
export function createMem0Reader({ baseURL, apiKey, fetchImpl } = {}) {
  const url = credentials({ baseURL, apiKey }, ['apiKey']);
  const request = transport({ baseURL: url, label: 'MEM0', fetchImpl, headers: { 'X-API-Key': apiKey } });
  return Object.freeze({
    async remember({ userId, note, sourceRef, sourceVersion, sourceSha256, customerId, workspaceId }, signal) {
      if (!identifier(userId) || !smallText(note, 4000) || !identifier(sourceRef) || !isVersion(sourceVersion)
        || !isSha(sourceSha256) || !identifier(customerId) || !identifier(workspaceId)
        || userId !== memoryPartitionKey(workspaceId, customerId)) fail('MEM0_INPUT_INVALID');
      const result = await request('/memories', { method: 'POST', signal, body: {
        user_id: userId, messages: [{ role: 'user', content: note }],
        metadata: { provenance: 'workspace-approved-source', sourceRef, sourceVersion, sourceSha256,
          customerId, workspaceId, authority: 'noncanonical-business-note' },
      } });
      return { status: 'stored', sourceRef, sourceVersion, eventCount: Array.isArray(result?.results) ? result.results.length : null };
    },
    async search({ userId, query, limit = 10 }, signal) {
      if (!identifier(userId) || !smallText(query, 500) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) fail('MEM0_SEARCH_INVALID');
      const response = await request('/search', { method: 'POST', signal, body: { user_id: userId, query, limit } });
      const rows = Array.isArray(response) ? response : response?.results;
      if (!Array.isArray(rows) || rows.length > limit) fail('MEM0_RESPONSE_INVALID');
      // Never quietly filter unsafe upstream memories and return a partial answer.
      return { notes: rows };
    },
    async history({ userId, memoryId }, signal) {
      if (!identifier(userId) || !identifier(memoryId)) fail('MEM0_HISTORY_INVALID');
      const item = await request('/memories/' + encodeURIComponent(memoryId), { signal });
      const history = await request('/memories/' + encodeURIComponent(memoryId) + '/history', { signal });
      if (!Array.isArray(history) || history.length > 100) fail('MEM0_HISTORY_RESPONSE_INVALID');
      // No historical text is disclosed before every event's lineage is checked.
      return { memoryId, item, history };
    },
  });
}

const mimeToExt = new Map([
  ['application/pdf', 'pdf'], ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'], ['text/csv', 'csv'],
  ['text/plain', 'txt'], ['image/png', 'png'], ['image/jpeg', 'jpg'],
]);
export function createDoclingSourceReader({ baseURL, apiKey, fetchImpl, timeoutMs=15000 } = {}) {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail('DOCLING_TIMEOUT_INVALID');
  const url = credentials({ baseURL, apiKey }, ['apiKey']);
  const request = transport({ baseURL: url, label: 'DOCLING', fetchImpl, timeoutMs,
    headers: { 'X-API-Key': apiKey } });
  return async function doclingSourceReader({ bytes, mimeType, signal }) {
    signal?.throwIfAborted();
    const ext = mimeToExt.get(mimeType);
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 5 * 1024 * 1024 || !ext) fail('DOCLING_UPLOAD_UNSUPPORTED');
    const form = new FormData();
    form.append('files', new Blob([bytes], { type: mimeType }), 'selected.' + ext);
    form.append('to_formats', 'md');
    form.append('to_formats', 'text');
    form.append('image_export_mode', 'placeholder');
    const result = await request('/v1/convert/file', { method: 'POST', body: form, multipart: true, signal });
    const text = result?.document?.text_content || result?.document?.md_content;
    if (!['success', 'partial_success'].includes(result?.status) || typeof text !== 'string' || !text.trim() || text.length > 200000) fail('DOCLING_RESULT_UNVERIFIED');
    return { status: result.status === 'success' ? 'available' : 'partial', text, nativeContent: [],
      textTruncated: result.status !== 'success', extractionPolicy: 'self-hosted-docling-serve-v1',
      sourceSha256: sha256(bytes), errors: Array.isArray(result.errors) ? result.errors.length : 0 };
  };
}

/**
 * The original trusted Host must inject live enterprise session authorization.
 * assertSourceCurrent checks actual current Library version/SHA AND present
 * grant for this customer/receiver, not merely metadata in a static scope.
 * assertUploadCurrent checks the exact original artifact version and access.
 */
export function createEnterpriseContextClient({ scope, authorize, assertSourceCurrent, assertUploadCurrent,
  mem0, doclingReader, artifacts, memoryApproval = null, clock = Date.now } = {}) {
  if (!own(scope) || scope.enabled !== true || scope.reviewed !== true || !identifier(scope.workspaceId)
    || !identifier(scope.subject) || !['admin', 'operator'].includes(scope.role)
    || typeof scope.expiresAt !== 'string' || !Number.isFinite(Date.parse(scope.expiresAt))
    || !Array.isArray(scope.customerIds) || !Array.isArray(scope.uploads) || !Array.isArray(scope.memoryIds)
    || !Array.isArray(scope.sourceRefs) || typeof authorize !== 'function') fail('OSS_ORIGINAL_SCOPE_REQUIRED');
  const selected = structuredClone(scope);
  const allowed = (values, value) => Array.isArray(values) && values.includes(value) && identifier(value);
  // No vector/RAG permission has been given. A future owner decision plus
  // reviewed original Host integration must explicitly supply BOTH flags.
  const memoryApproved = memoryApproval?.enabled === true && memoryApproval?.semanticVectorApproved === true
    && identifier(memoryApproval?.decisionId);
  async function gate(action, signal, model, target = null) {
    signal?.throwIfAborted();
    if (clock() >= Date.parse(selected.expiresAt) || !model || await authorize({ action, scope: selected, model, signal, target }) !== true)
      fail('OSS_ORIGINAL_AUTHORIZATION_REQUIRED');
    signal?.throwIfAborted();
  }
  async function withGate(action, signal, model, execute) {
    await gate(action, signal, model);
    const result = await execute();
    await gate(action, signal, model);
    return result;
  }
  function requireMemory(customerId) {
    if (!memoryApproved) fail('OSS_MEM0_VECTOR_NOT_APPROVED');
    if (!allowed(selected.customerIds, customerId) || !mem0 || typeof assertSourceCurrent !== 'function') fail('OSS_MEMORY_NOT_AUTHORIZED');
  }
  async function verifySource(meta, customerId, action, signal, model) {
    if (!own(meta) || meta.provenance !== 'workspace-approved-source' || meta.authority !== 'noncanonical-business-note'
      || meta.workspaceId !== selected.workspaceId || meta.customerId !== customerId || !identifier(meta.sourceRef)
      || !isVersion(meta.sourceVersion) || !isSha(meta.sourceSha256)
      || !selected.sourceRefs.some(s => own(s) && s.customerId === customerId && s.ref === meta.sourceRef
        && s.version === meta.sourceVersion && s.sha256 === meta.sourceSha256)) fail('OSS_MEMORY_SOURCE_NOT_APPROVED');
    const target = { workspaceId: selected.workspaceId, subject: selected.subject, customerId,
      sourceRef: meta.sourceRef, sourceVersion: meta.sourceVersion, sourceSha256: meta.sourceSha256 };
    await gate(action, signal, model, target);
    if (await assertSourceCurrent({ ...target, action, model, signal }) !== true) fail('OSS_MEMORY_SOURCE_REVOKED');
    await gate(action, signal, model, target);
    return target;
  }
  function memoryRow(row, userId, customerId) {
    if (!own(row) || !identifier(row.id) || row.user_id !== userId || !smallText(row.memory, 4000)) fail('OSS_MEMORY_SCOPE_MISMATCH');
    return { id: row.id, note: row.memory, ...row.metadata && own(row.metadata) ? {
      sourceRef: row.metadata.sourceRef, sourceVersion: row.metadata.sourceVersion, sourceSha256: row.metadata.sourceSha256
    } : {}, metadata: row.metadata };
  }
  const client = {
    async status(_input, signal, model) {
      return withGate('status', signal, model, () => ({ status: 'available', providers: {
        erpnext: 'delegate-to-pr86', mem0: memoryApproved && !!mem0 ? 'reviewed-not-live-verified' : 'disabled',
        docling: !!doclingReader }, canonical: CANONICAL_CONTEXT_STORE, migration: 'no-cutover', memory: 'noncanonical' }));
    },
    async memorySearch({ customerId, query }, signal, model) {
      requireMemory(customerId);
      return withGate('memory.read', signal, model, async () => {
        const userId = memoryPartitionKey(selected.workspaceId, customerId);
        const rows = (await mem0.search({ userId, query }, signal)).notes;
        if (!Array.isArray(rows) || rows.length > 20) fail('OSS_MEMORY_RESPONSE_INVALID');
        const records = [];
        for (const row of rows) {
          const record = memoryRow(row, userId, customerId);
          await verifySource(row.metadata, customerId, 'memory.read.source', signal, model);
          records.push({ id: record.id, note: record.note, sourceRef: record.sourceRef,
            sourceVersion: record.sourceVersion, sourceSha256: record.sourceSha256 });
        }
        // Recheck even if the source was revoked while validating a later row.
        for (const row of rows) await verifySource(row.metadata, customerId, 'memory.read.return', signal, model);
        return { notes: records };
      });
    },
    async memoryAdd({ customerId, note, sourceRef, sourceVersion, sourceSha256 }, signal, model) {
      requireMemory(customerId);
      if (selected.allowMemoryWrite !== true || !smallText(note, 4000)) fail('OSS_MEMORY_WRITE_NOT_AUTHORIZED');
      return withGate('memory.write', signal, model, async () => {
        const metadata = { authority: 'noncanonical-business-note', provenance: 'workspace-approved-source',
          workspaceId: selected.workspaceId, customerId, sourceRef, sourceVersion, sourceSha256 };
        await verifySource(metadata, customerId, 'memory.write.source', signal, model);
        const result = await mem0.remember({ userId: memoryPartitionKey(selected.workspaceId, customerId),
          note, sourceRef, sourceVersion, sourceSha256, customerId, workspaceId: selected.workspaceId }, signal);
        await verifySource(metadata, customerId, 'memory.write.return', signal, model);
        return result;
      });
    },
    async memoryHistory({ customerId, memoryId }, signal, model) {
      requireMemory(customerId);
      if (!allowed(selected.memoryIds, memoryId)) fail('OSS_MEMORY_HISTORY_NOT_AUTHORIZED');
      return withGate('memory.history', signal, model, async () => {
        const userId = memoryPartitionKey(selected.workspaceId, customerId);
        const { item, history } = await mem0.history({ userId, memoryId }, signal);
        if (!own(item) || item.id !== memoryId || item.user_id !== userId || !own(item.metadata)
          || !Array.isArray(history) || history.length > 100) fail('OSS_MEMORY_HISTORY_SCOPE_MISMATCH');
        await verifySource(item.metadata, customerId, 'memory.history.current', signal, model);
        const events = [];
        for (const entry of history) {
          if (!own(entry) || !own(entry.metadata) || entry.user_id !== userId
            || entry.memory_id !== memoryId || (entry.old_memory != null && !smallText(entry.old_memory, 4000))
            || (entry.new_memory != null && !smallText(entry.new_memory, 4000))) fail('OSS_MEMORY_HISTORY_PROVENANCE_MISSING');
          await verifySource(entry.metadata, customerId, 'memory.history.event', signal, model);
          events.push({ event: entry.event ?? null, createdAt: entry.created_at ?? null,
            oldMemory: entry.old_memory ?? null, newMemory: entry.new_memory ?? null,
            sourceRef: entry.metadata.sourceRef, sourceVersion: entry.metadata.sourceVersion,
            sourceSha256: entry.metadata.sourceSha256 });
        }
        // Even an item whose event metadata changed after insertion must not
        // redisclose historical text without each historical version's grant.
        await verifySource(item.metadata, customerId, 'memory.history.return', signal, model);
        for (const entry of history) await verifySource(entry.metadata, customerId, 'memory.history.return', signal, model);
        return { memoryId, sourceRef: item.metadata.sourceRef, sourceVersion: item.metadata.sourceVersion, history: events };
      });
    },
    async parseUpload({ artifactId, version, sha256: expected }, signal, model) {
      if (!doclingReader || !artifacts || !identifier(artifactId) || !isVersion(version) || !isSha(expected)
        || !selected.uploads.some(s => s.artifactId === artifactId && s.version === version && s.sha256 === expected)
        || typeof assertUploadCurrent !== 'function') fail('OSS_UPLOAD_NOT_AUTHORIZED');
      return withGate('upload.read', signal, model, async () => {
        const target = { workspaceId: selected.workspaceId, subject: selected.subject, artifactId, version, sha256: expected };
        if (await assertUploadCurrent({ ...target, action: 'upload.read', signal, model }) !== true) fail('OSS_UPLOAD_REVOKED');
        const original = await artifacts.download(artifactId, { version });
        if (original.version?.sha256 !== expected || !Buffer.isBuffer(original.bytes)
          || sha256(original.bytes) !== expected) fail('OSS_SOURCE_VERSION_CHANGED');
        // Mandatory post-download, pre-external-file-dispatch live re-check.
        await gate('upload.dispatch', signal, model, target);
        if (await assertUploadCurrent({ ...target, action: 'upload.dispatch', signal, model }) !== true) fail('OSS_UPLOAD_REVOKED');
        signal?.throwIfAborted();
        const parsed = await doclingReader({ bytes: original.bytes, mimeType: original.mimeType, signal });
        await gate('upload.return', signal, model, target);
        if (await assertUploadCurrent({ ...target, action: 'upload.return', signal, model }) !== true) fail('OSS_UPLOAD_REVOKED');
        return parsed;
      });
    },
  };
  return Object.freeze(client);
}
