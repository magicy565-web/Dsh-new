import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './runtime.mjs';
import { acquireWriterLock, openPrivateFile, privateDirectory, syncDirectory, validateJson } from './store.mjs';
import { isArtifactReferencedByLibrary } from './business-library.mjs';
import { isBusinessLibraryArtifact } from './business-library-policy.mjs';
import { isBrainArtifact, mayWriteBrainArtifact } from './brain-artifact-policy.mjs';

export const ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;
export const ARTIFACT_TYPES = Object.freeze({ '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' });
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const idPattern = new RegExp(`^${UUID}$`, 'u');
const blobPattern = new RegExp(`^${UUID}\\.v[1-9][0-9]*\\.[a-f0-9]{64}\\.blob$`, 'u');
const tempPattern = new RegExp(`^\\.${UUID}\\.upload$`, 'u');
const sources = { sourceGoalId: 'goals', sourceConversationId: 'conversations', sourceRunId: 'runs' };
const createFields = new Set(['filename', 'content', 'base64', 'mimeType', 'title', 'description', 'metadata', ...Object.keys(sources), 'requestId']);
const updateFields = new Set([...createFields].filter(key => key !== 'requestId').concat('expectedRevision'));
const fail = (code, message, status = 400) => { throw new ApiError(status, code, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : object(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const textual = mime => mime.startsWith('text/') || mime === 'application/json';
const blobName = (artifact, version) => `${artifact.id}.v${version.version}.${version.sha256}.blob`;
const copy = value => structuredClone(value);

function bodyObject(body, fields) {
  if (!object(body)) fail('INVALID_INPUT', 'Artifact input must be a JSON object.');
  try { validateJson(body); } catch { fail('INVALID_INPUT', 'Artifact input must contain safe JSON values.'); }
  for (const key of Object.keys(body)) if (!fields.has(key)) fail('INVALID_INPUT', `Unsupported artifact field: ${key}.`);
}
function boundedString(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('INVALID_INPUT', `${label} must be ${allowEmpty ? '0' : '1'}–${max} characters.`);
  return value.trim();
}
export function sanitizeArtifactFilename(input) {
  const raw = boundedString(input, 'filename', 160);
  if (/[\\/]/u.test(raw) || raw.startsWith('.') || /[\r\n\t]/u.test(raw)) fail('INVALID_FILENAME', 'Use a filename without paths, hidden-file prefixes, or control characters.');
  const name = raw.normalize('NFC').replace(/[^\p{L}\p{N}\p{M} ._()\-]/gu, '_').replace(/[ .]+$/u, '');
  if (!name || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(name)) fail('INVALID_FILENAME', 'This filename is reserved or invalid.');
  if (!Object.hasOwn(ARTIFACT_TYPES, path.extname(name).toLowerCase())) fail('UNSUPPORTED_ARTIFACT_TYPE', 'Supported artifact files: txt, md, csv, json, pdf, png, jpg, jpeg, webp.');
  return name;
}
function metadata(value) {
  if (!object(value)) fail('INVALID_INPUT', 'metadata must be a JSON object.');
  try { validateJson(value); } catch { fail('INVALID_INPUT', 'metadata must contain safe JSON values.'); }
  if (Buffer.byteLength(JSON.stringify(value)) > 16_384) fail('INVALID_INPUT', 'Artifact metadata must be at most 16 KiB.');
  if (value.businessLibrary !== undefined && (!object(value.businessLibrary) || value.businessLibrary.visibility !== 'internal' || Object.keys(value.businessLibrary).some(key => key !== 'visibility'))) fail('INVALID_INPUT', 'Business library files must retain internal visibility.');
  return copy(value);
}
function sourceValues(body, current = {}) {
  return Object.fromEntries(Object.keys(sources).map(key => {
    const value = Object.hasOwn(body, key) ? body[key] : current[key] ?? null;
    if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value))) fail('INVALID_INPUT', `${key} must be an existing source ID or null.`);
    return [key, value];
  }));
}
function checkSources(state, associations, changedKeys = Object.keys(sources)) {
  for (const key of changedKeys) if (associations[key] !== null && !state[sources[key]].some(item => item.id === associations[key])) fail('SOURCE_NOT_FOUND', `The selected ${key} no longer exists.`, 404);
  const goal = associations.sourceGoalId && state.goals.find(item => item.id === associations.sourceGoalId);
  const run = associations.sourceRunId && state.runs.find(item => item.id === associations.sourceRunId);
  if ((goal && associations.sourceConversationId && goal.conversationId && goal.conversationId !== associations.sourceConversationId) || (run && associations.sourceConversationId && run.conversationId && run.conversationId !== associations.sourceConversationId) || (run && associations.sourceGoalId && run.goalId && run.goalId !== associations.sourceGoalId)) fail('SOURCE_MISMATCH', 'Artifact sources must refer to the same goal and conversation.');
}
function decodeContent(body, filename, maxBytes) {
  if (Object.hasOwn(body, 'content') === Object.hasOwn(body, 'base64')) fail('INVALID_INPUT', 'Supply exactly one of content (UTF-8 text) or base64.');
  const mimeType = ARTIFACT_TYPES[path.extname(filename).toLowerCase()];
  if (body.mimeType !== undefined && body.mimeType !== mimeType) fail('UNSUPPORTED_ARTIFACT_TYPE', 'mimeType must match the supported filename extension.');
  let bytes;
  if (Object.hasOwn(body, 'content')) {
    if (typeof body.content !== 'string') fail('INVALID_INPUT', 'content must be UTF-8 text.');
    if (!textual(mimeType)) fail('INVALID_INPUT', 'Binary artifacts must use base64.');
    if (Buffer.byteLength(body.content) > maxBytes) fail('ARTIFACT_TOO_LARGE', `Artifact content must be at most ${maxBytes} bytes.`, 413);
    bytes = Buffer.from(body.content, 'utf8');
    if (bytes.toString('utf8') !== body.content) fail('INVALID_INPUT', 'content must not contain unpaired Unicode surrogate characters.');
  } else {
    if (typeof body.base64 !== 'string') fail('INVALID_INPUT', 'base64 must be a string.');
    if (body.base64.length > Math.ceil(maxBytes / 3) * 4) fail('ARTIFACT_TOO_LARGE', `Artifact content must be at most ${maxBytes} bytes.`, 413);
    // The exact canonical round-trip below also checks alphabet and padding.
    // Avoid a repeated-group regexp whose stack grows with valid large input.
    bytes = Buffer.from(body.base64, 'base64');
    if (bytes.toString('base64') !== body.base64) fail('INVALID_INPUT', 'base64 must use canonical padding and characters.');
    if (bytes.length > maxBytes) fail('ARTIFACT_TOO_LARGE', `Artifact content must be at most ${maxBytes} bytes.`, 413);
  }
  if (textual(mimeType)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('INVALID_INPUT', 'Text artifacts must contain valid UTF-8.'); }
    if (text.includes('\0')) fail('INVALID_INPUT', 'Text artifacts cannot contain NUL bytes.');
    if (mimeType === 'application/json') { try { JSON.parse(text); } catch { fail('INVALID_INPUT', 'JSON artifacts must contain valid JSON.'); } }
  } else {
    const valid = mimeType === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
      : mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mimeType === 'image/jpeg' ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!valid) fail('INVALID_INPUT', 'Binary artifact signature does not match its file type.');
  }
  return { bytes, mimeType, size: bytes.length, sha256: hash(bytes) };
}
function selectedVersion(artifact, requested) {
  let number = requested ?? artifact.currentVersion;
  if (typeof number === 'string' && /^[1-9][0-9]*$/u.test(number)) number = Number(number);
  if (!Number.isSafeInteger(number) || number < 1) fail('INVALID_INPUT', 'version must be a positive integer.');
  const version = artifact.versions.find(item => item.version === number);
  if (!version) fail('NOT_FOUND', 'Artifact version not found.', 404);
  return version;
}
function required(state, id) {
  if (typeof id !== 'string' || !idPattern.test(id)) fail('NOT_FOUND', 'Artifact not found.', 404);
  const artifact = state.artifacts.find(item => item.id === id);
  if (!artifact) fail('NOT_FOUND', 'Artifact not found.', 404);
  return artifact;
}
function validateRecord(artifact) {
  try {
    if (!idPattern.test(artifact.id) || !Array.isArray(artifact.versions) || !artifact.versions.length || !Number.isSafeInteger(artifact.revision) || artifact.revision < artifact.versions.length || artifact.versions.length > 100 || artifact.currentVersion !== artifact.versions.length) throw new Error();
    if (sanitizeArtifactFilename(artifact.filename) !== artifact.filename) throw new Error();
    boundedString(artifact.title, 'title', 200); boundedString(artifact.description, 'description', 4000, true); metadata(artifact.metadata); sourceValues(artifact);
    if (artifact.workerOwner !== undefined) workerOwner(artifact.workerOwner);
    if (![artifact.createdAt, artifact.updatedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) throw new Error();
    if (artifact.requestId !== null && typeof artifact.requestId !== 'string' || !/^[a-f0-9]{64}$/u.test(artifact.requestFingerprint)) throw new Error();
    artifact.versions.forEach((version, index) => {
      if (!object(version) || version.version !== index + 1 || !/^[a-f0-9]{64}$/u.test(version.sha256) || !Number.isSafeInteger(version.size) || version.size < 0 || version.size > ARTIFACT_MAX_BYTES || version.mimeType !== ARTIFACT_TYPES[path.extname(version.filename || '').toLowerCase()] || typeof version.createdAt !== 'string' || !Number.isFinite(Date.parse(version.createdAt))) throw new Error();
      if (sanitizeArtifactFilename(version.filename) !== version.filename) throw new Error();
    });
    const latest = artifact.versions.at(-1);
    if (artifact.size !== latest.size || artifact.sha256 !== latest.sha256 || artifact.mimeType !== latest.mimeType || ARTIFACT_TYPES[path.extname(artifact.filename).toLowerCase()] !== artifact.mimeType) throw new Error();
  } catch { throw new Error('Invalid artifact metadata; no files have been changed.'); }
}
// Trusted Host admission only. The public artifact body still rejects this
// field; ownership is committed with the first version, never in a second write.
function workerOwner(value) {
  if (!object(value) || Object.keys(value).length !== 2 ||
      typeof value.subject !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u.test(value.subject) ||
      ['__proto__', 'constructor', 'prototype'].includes(value.subject) || !idPattern.test(value.workerId))
    fail('INVALID_INPUT', 'A trusted Worker owner requires an exact subject and Worker UUID.');
  return copy(value);
}
function activity(state, type, artifact) {
  state.activity.push({ id: randomUUID(), type, title: type === 'artifact_deleted' ? 'Artifact deleted' : type === 'artifact_created' ? 'Artifact saved' : 'Artifact updated', detail: artifact.filename, artifactId: artifact.id, createdAt: new Date().toISOString() });
  state.activity = state.activity.slice(-2000);
}

/** Local, private artifact storage. Content is inert data and is never executed or sent externally. */
export async function createArtifactService({ store, directory, maxBytes = ARTIFACT_MAX_BYTES, maxTotalBytes = 100 * 1024 * 1024, maxArtifacts = 1000 } = {}) {
  if (!store || typeof store.update !== 'function' || typeof store.read !== 'function') throw new TypeError('An open workspace store is required.');
  directory ??= path.join(store.directory, 'artifacts');
  for (const value of [maxBytes, maxTotalBytes, maxArtifacts]) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Artifact limits must be positive integers.');
  if (maxBytes > ARTIFACT_MAX_BYTES || maxTotalBytes < maxBytes || maxArtifacts > 10_000) throw new TypeError('Artifact limits exceed the supported bounds.');
  const root = await privateDirectory(directory);
  directory = root.directory;
  if (directory === store.directory) throw new Error('Artifacts require their own private directory.');
  const lock = await acquireWriterLock(directory, 'artifacts.lock');
  let queue = Promise.resolve(); let closed = false; let closePromise;
  const recovery = { orphanFilesRemoved: 0, unavailableVersions: [] };
  function enqueue(callback) {
    if (closed) return Promise.reject(new ApiError(503, 'ARTIFACTS_CLOSED', 'Artifact storage is closing.'));
    const task = queue.then(async () => { await root.verify(); await lock.verify(); return callback(); });
    queue = task.catch(() => {}); return task;
  }
  function checkQuota(state, additionalBytes, additionalArtifact = false) {
    if ((additionalArtifact && state.artifacts.length >= maxArtifacts) || state.artifacts.reduce((total, item) => total + item.versions.reduce((n, version) => n + version.size, 0), 0) + additionalBytes > maxTotalBytes) fail('ARTIFACT_QUOTA', 'The local artifact storage limit has been reached. Remove unneeded artifacts before adding more.', 409);
  }
  async function readBytes(artifact, version) {
    let handle;
    try {
      await root.verify();
      handle = await openPrivateFile(path.join(directory, blobName(artifact, version)));
      const info = await handle.stat();
      if (info.size !== version.size || info.size > maxBytes) fail('ARTIFACT_INTEGRITY', 'Artifact bytes do not match their saved metadata.', 409);
      // Bound the read even if another local process grows a file after stat().
      const buffer = Buffer.alloc(version.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== version.size) fail('ARTIFACT_INTEGRITY', 'Artifact length changed while being read.', 409);
      const bytes = buffer.subarray(0, offset);
      if (hash(bytes) !== version.sha256) fail('ARTIFACT_INTEGRITY', 'Artifact bytes failed the saved SHA-256 integrity check.', 409);
      return bytes;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      fail(error.code === 'ENOENT' ? 'ARTIFACT_UNAVAILABLE' : 'ARTIFACT_UNSAFE', error.code === 'ENOENT' ? 'Artifact bytes are missing. Restore the workspace backup to recover this version.' : 'Artifact storage is unsafe or inaccessible. Inspect the data directory before continuing.', 409);
    } finally { if (handle) await handle.close(); }
  }
  async function writeBlob(artifact, version, bytes) {
    const temporary = path.join(directory, `.${randomUUID()}.upload`);
    const final = path.join(directory, blobName(artifact, version));
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await root.verify(); await lock.verify();
      // link() publishes without overwriting any existing file, including a symlink.
      await fs.link(temporary, final); await fs.unlink(temporary); await syncDirectory(directory);
    } catch (error) { if (handle) await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); throw error; }
    return final;
  }
  async function removeBlob(filename) { await root.verify(); await fs.unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  try {
    const records = store.read().artifacts;
    for (const record of records) validateRecord(record);
    const referenced = new Set(records.flatMap(item => item.versions.map(version => blobName(item, version))));
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if ((tempPattern.test(entry.name) || (blobPattern.test(entry.name) && !referenced.has(entry.name))) && (entry.isFile() || entry.isSymbolicLink())) { await removeBlob(path.join(directory, entry.name)); recovery.orphanFilesRemoved += 1; }
    }
    if (recovery.orphanFilesRemoved) await syncDirectory(directory);
    for (const artifact of records) for (const version of artifact.versions) {
      try { await readBytes(artifact, version); }
      catch (error) { recovery.unavailableVersions.push({ artifactId: artifact.id, version: version.version, code: error.code }); }
    }
  } catch (error) { await lock.release(); throw error; }
  const service = {
    limits: { maxBytes, maxTotalBytes, maxArtifacts, maxVersions: 100 },
    recovery: copy(recovery),
    list(filters = {}) {
      bodyObject(filters, new Set([...Object.keys(sources), 'q']));
      let artifacts = store.read().artifacts;
      for (const key of Object.keys(sources)) if (filters[key] !== undefined) { if (typeof filters[key] !== 'string') fail('INVALID_INPUT', `${key} must be a string.`); artifacts = artifacts.filter(item => item[key] === filters[key]); }
      if (filters.q !== undefined) { const query = boundedString(filters.q, 'q', 200, true).toLocaleLowerCase(); artifacts = artifacts.filter(item => `${item.title}\n${item.filename}\n${item.description}`.toLocaleLowerCase().includes(query)); }
      return { artifacts: artifacts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)) };
    },
    get(id) { return { artifact: required(store.read(), id) }; },
    create(body, admission = {}) {
      if (admission.check !== undefined && typeof admission.check !== 'function') throw new TypeError('Artifact admission check must be a function.');
      const owner = admission.workerOwner === undefined ? undefined : workerOwner(admission.workerOwner);
      return enqueue(async () => {
        bodyObject(body, createFields);
        const filename = sanitizeArtifactFilename(body.filename);
        const decoded = decodeContent(body, filename, maxBytes);
        const associations = sourceValues(body);
        const info = { filename, title: body.title === undefined ? filename : boundedString(body.title, 'title', 200), description: body.description === undefined ? '' : boundedString(body.description, 'description', 4000, true), metadata: body.metadata === undefined ? {} : metadata(body.metadata), ...associations, ...(owner ? { workerOwner: owner } : {}) };
        if (!mayWriteBrainArtifact(null, info.metadata, admission)) fail('BRAIN_ARTIFACT_PROTECTED', 'Enterprise brain artifacts require original Host admission.', 403);
        const requestId = body.requestId === undefined ? null : boundedString(body.requestId, 'requestId', 128);
        const requestFingerprint = hash(canonical({ ...info, sha256: decoded.sha256, mimeType: decoded.mimeType }));
        const snapshot = store.read();
        admission.check?.(snapshot);
        if (requestId !== null) {
          const previous = snapshot.artifacts.find(item => item.requestId === requestId);
          if (previous) { if (previous.requestFingerprint !== requestFingerprint) fail('IDEMPOTENCY_CONFLICT', 'This requestId was already used for a different artifact.', 409); return { artifact: previous, duplicate: true }; }
        }
        checkSources(snapshot, associations); checkQuota(snapshot, decoded.size, true);
        const time = new Date().toISOString();
        const version = { version: 1, filename, mimeType: decoded.mimeType, size: decoded.size, sha256: decoded.sha256, createdAt: time };
        const artifact = { id: randomUUID(), ...info, mimeType: decoded.mimeType, size: decoded.size, sha256: decoded.sha256, currentVersion: 1, revision: 1, versions: [version], createdAt: time, updatedAt: time, requestId, requestFingerprint };
        const file = await writeBlob(artifact, version, decoded.bytes);
        try { return await store.update(state => { admission.check?.(state); checkSources(state, associations); checkQuota(state, decoded.size, true); state.artifacts.push(artifact); activity(state, 'artifact_created', artifact); return { artifact }; }); }
        catch (error) {
          // An uncertain disk commit may already reference the bytes. Never remove those bytes.
          if (!store.read().artifacts.some(item => item.id === artifact.id)) await removeBlob(file).catch(() => {});
          throw error;
        }
      });
    },
    update(id, body, admission = {}) {
      if (admission.check !== undefined && typeof admission.check !== 'function') throw new TypeError('Artifact admission check must be a function.');
      return enqueue(async () => {
        bodyObject(body, updateFields);
        if (!Object.keys(body).some(key => key !== 'expectedRevision')) fail('INVALID_INPUT', 'Provide an artifact field to update.');
        const snapshot = store.read(); admission.check?.(snapshot); const original = required(snapshot, id);
        if (!mayWriteBrainArtifact(original, body.metadata ?? original.metadata, admission)) fail('BRAIN_ARTIFACT_PROTECTED', 'Enterprise brain records cannot be modified through generic artifact access.', 403);
        if (body.metadata !== undefined && isBusinessLibraryArtifact(snapshot, original) && body.metadata?.businessLibrary?.visibility !== 'internal') fail('INVALID_INPUT', 'Internal library visibility cannot be removed from this file.');
        if (body.expectedRevision !== undefined && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1)) fail('INVALID_INPUT', 'expectedRevision must be a positive integer.');
        if (body.expectedRevision !== undefined && body.expectedRevision !== original.revision) fail('REVISION_CONFLICT', 'This artifact changed. Reload it before saving.', 409);
        const filename = body.filename === undefined ? original.filename : sanitizeArtifactFilename(body.filename);
        const withContent = Object.hasOwn(body, 'content') || Object.hasOwn(body, 'base64');
        if (!withContent && (body.mimeType !== undefined && body.mimeType !== original.mimeType || ARTIFACT_TYPES[path.extname(filename).toLowerCase()] !== original.mimeType)) fail('INVALID_INPUT', 'Changing the file type requires new content.');
        const decoded = withContent ? decodeContent(body, filename, maxBytes) : null;
        if (decoded && original.versions.length >= 100) fail('ARTIFACT_VERSION_LIMIT', 'This artifact has reached its 100-version limit.', 409);
        const associations = sourceValues(body, original);
        const changedSources = Object.keys(sources).filter(key => Object.hasOwn(body, key));
        checkSources(snapshot, associations, changedSources); if (decoded) checkQuota(snapshot, decoded.size);
        const time = new Date().toISOString();
        const artifact = { ...original, filename, title: body.title === undefined ? original.title : boundedString(body.title, 'title', 200), description: body.description === undefined ? original.description : boundedString(body.description, 'description', 4000, true), metadata: body.metadata === undefined ? original.metadata : metadata(body.metadata), ...associations, updatedAt: time, revision: original.revision + 1 };
        let file;
        if (decoded) {
          const version = { version: original.currentVersion + 1, filename, mimeType: decoded.mimeType, size: decoded.size, sha256: decoded.sha256, createdAt: time };
          artifact.versions = [...original.versions, version]; artifact.currentVersion = version.version;
          artifact.mimeType = version.mimeType; artifact.size = version.size; artifact.sha256 = version.sha256;
          file = await writeBlob(artifact, version, decoded.bytes);
        }
        try {
          return await store.update(state => {
            admission.check?.(state);
            const current = required(state, id);
            if (!mayWriteBrainArtifact(current, artifact.metadata, admission)) fail('BRAIN_ARTIFACT_PROTECTED', 'The enterprise brain artifact ownership changed.', 403);
            if (body.metadata !== undefined && isBusinessLibraryArtifact(state, current) && body.metadata?.businessLibrary?.visibility !== 'internal') fail('INVALID_INPUT', 'Internal library visibility cannot be removed from this file.');
            if (current.revision !== original.revision) fail('REVISION_CONFLICT', 'This artifact changed. Reload it before saving.', 409);
            checkSources(state, associations, changedSources); if (decoded) checkQuota(state, decoded.size);
            state.artifacts[state.artifacts.findIndex(item => item.id === id)] = artifact;
            activity(state, 'artifact_updated', artifact); return { artifact };
          });
        } catch (error) { if (file && !store.read().artifacts.find(item => item.id === id)?.versions.some(version => blobName(artifact, version) === path.basename(file))) await removeBlob(file).catch(() => {}); throw error; }
      });
    },
    delete(id) {
      return enqueue(async () => {
        const artifact = required(store.read(), id);
        if (isBrainArtifact(artifact)) fail('BRAIN_ARTIFACT_PROTECTED', 'Enterprise brain memory cannot be deleted using generic artifact access.', 403);
        await store.update(state => { if (isBrainArtifact(required(state, id))) fail('BRAIN_ARTIFACT_PROTECTED', 'Enterprise brain memory requires its original Host.', 403); if (isArtifactReferencedByLibrary(state, id)) fail('REFERENCED_ASSET', 'This file is used by a product image or a document version. All historical document versions retain their files.', 409); state.artifacts = state.artifacts.filter(item => item.id !== id); activity(state, 'artifact_deleted', artifact); });
        let pendingCleanup = false;
        for (const version of artifact.versions) { try { await removeBlob(path.join(directory, blobName(artifact, version))); } catch { pendingCleanup = true; } }
        try { await syncDirectory(directory); } catch { pendingCleanup = true; }
        return { ok: true, ...(pendingCleanup ? { cleanupPending: true } : {}) };
      });
    },
    download(id, options = {}) {
      return enqueue(async () => {
        bodyObject(options, new Set(['version']));
        const artifact = required(store.read(), id); const version = selectedVersion(artifact, options.version);
        const bytes = await readBytes(artifact, version);
        return { artifact, version, bytes, filename: version.version === artifact.currentVersion ? artifact.filename : version.filename, mimeType: version.mimeType };
      });
    },
    async read(id, options = {}) {
      bodyObject(options, new Set(['version', 'encoding']));
      const download = await service.download(id, options.version === undefined ? {} : { version: options.version });
      const encoding = options.encoding ?? (textual(download.mimeType) ? 'utf8' : 'base64');
      if (!['utf8', 'base64'].includes(encoding) || encoding === 'utf8' && !textual(download.mimeType)) fail('INVALID_INPUT', 'encoding must be base64, or utf8 for text artifacts.');
      return { artifact: download.artifact, version: download.version, encoding, content: download.bytes.toString(encoding) };
    },
    export(id, options = {}) { return service.download(id, options); },
    inspect(id) {
      return enqueue(async () => {
        const artifact = required(store.read(), id); const versions = [];
        for (const version of artifact.versions) { try { await readBytes(artifact, version); versions.push({ version: version.version, available: true, verified: true }); } catch (error) { versions.push({ version: version.version, available: false, verified: false, code: error.code }); } }
        return { artifact, versions };
      });
    },
    close() {
      if (closePromise) return closePromise;
      closed = true; closePromise = (async () => { await queue; await lock.release(); })(); return closePromise;
    },
  };
  return service;
}
