// Exact document versions for native DSH references. No separate state or session store.
import { createHash } from 'node:crypto';

const MAX_REFERENCES = 8;
const MAX_CHARS = 24_000;
const MAX_BYTES = 96_000;
const SHA = /^[a-f0-9]{64}$/u;
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);

export class ReferenceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const fail = (code, message, status) => { throw new ReferenceError(code, message, status); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readable = version => TEXT_TYPES.has(String(version.mimeType).split(';', 1)[0].trim().toLowerCase());
const checkSignal = signal => {
  if (signal?.aborted) fail('REFERENCE_CANCELLED', 'Reference reading was cancelled.', 409);
};

function metadata(document, version) {
  const review = [...document.reviews].reverse().find(item => item.documentVersion === version.version && item.sha256 === version.sha256);
  return {
    documentId: document.id, version: version.version, sha256: version.sha256,
    title: document.title, fileName: version.fileName, mimeType: version.mimeType,
    bytes: version.bytes, currentVersion: document.currentVersion,
    reviewState: review?.decision ?? 'unreviewed', certificate: version.certificate,
  };
}

/** Resolve every pin before returning any content; a missing/stale pin rejects the whole request. */
function resolve(state, references) {
  if (!Array.isArray(references) || references.length < 1 || references.length > MAX_REFERENCES)
    fail('REFERENCE_INPUT', `Select 1–${MAX_REFERENCES} exact document versions.`);
  const seen = new Set();
  return references.map(ref => {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)
      || Object.keys(ref).some(key => !['documentId', 'version', 'sha256'].includes(key))
      || typeof ref.documentId !== 'string' || !/^doc_[a-f0-9-]{36}$/u.test(ref.documentId)
      || !Number.isSafeInteger(ref.version) || ref.version < 1 || typeof ref.sha256 !== 'string' || !SHA.test(ref.sha256))
      fail('REFERENCE_INPUT', 'Use a document id, positive version and exact SHA-256.');
    const key = `${ref.documentId}:${ref.version}`;
    if (seen.has(key)) fail('REFERENCE_INPUT', 'A document version was selected more than once.');
    seen.add(key);
    const document = state.documents.find(item => item.id === ref.documentId);
    if (!document) fail('REFERENCE_NOT_FOUND', 'The selected document no longer exists.', 404);
    if (document.status !== 'active') fail('REFERENCE_ARCHIVED', 'The selected document is archived. Select another reference.', 409);
    const version = document.versions.find(item => item.version === ref.version);
    if (!version) fail('REFERENCE_NOT_FOUND', 'The selected document version no longer exists.', 404);
    if (version.sha256 !== ref.sha256) fail('REFERENCE_CHANGED', 'The selected document version does not match its hash. Select it again.', 409);
    if (!readable(version)) fail('REFERENCE_UNSUPPORTED', 'Only TXT, Markdown, CSV and JSON text references can be read.');
    return { document, version, source: metadata(document, version) };
  });
}

/** Metadata-only discovery, including older versions; binary documents are not offered as readable references. */
export function listReferenceCandidates(state, { q = '', limit = 50 } = {}) {
  if (typeof q !== 'string' || q.length > 200 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    fail('REFERENCE_INPUT', 'Use a bounded search query and limit.');
  const needle = q.trim().toLowerCase();
  const items = [];
  for (const document of [...state.documents].filter(item => item.status === 'active')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))) {
    for (const version of [...document.versions].sort((a, b) => b.version - a.version)) {
      if (!readable(version) || !`${document.title}\n${version.fileName}`.toLowerCase().includes(needle)) continue;
      items.push(metadata(document, version));
    }
  }
  return { items: items.slice(0, limit), total: items.length };
}

/** Validate a draft's pins without returning document bytes to the browser. */
export function checkReferences(state, references) {
  return { references: resolve(state, references).map(item => item.source) };
}

/** Read verified UTF-8 bytes through the host attachment service; never parse binary formats or fetch URLs. */
export async function readReferences({ readState, attachments, references, signal }) {
  checkSignal(signal);
  const selected = resolve(structuredClone(await readState()), references);
  const items = [];
  let totalChars = 0;
  let totalBytes = 0;
  for (const { version, source } of selected) {
    checkSignal(signal);
    if (!Number.isSafeInteger(version.bytes) || version.bytes < 1 || totalBytes + version.bytes > MAX_BYTES)
      fail('REFERENCE_TOO_LARGE', 'The selected reference bytes exceed the bounded context. Select fewer or shorter documents.', 413);
    let bytes;
    if (version.attachment) {
      if (!attachments?.readFileStream) fail('REFERENCE_UNAVAILABLE', 'The native attachment service is unavailable.', 503);
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of attachments.readFileStream(version.attachment, signal)) {
          checkSignal(signal);
          const value = Buffer.from(chunk);
          size += value.length;
          if (size > version.bytes || totalBytes + size > MAX_BYTES)
            fail('REFERENCE_CHANGED', 'Stored attachment bytes do not match the selected version.', 409);
          chunks.push(value);
        }
      } catch (error) {
        checkSignal(signal);
        if (error instanceof ReferenceError) throw error;
        fail('REFERENCE_UNAVAILABLE', 'The selected attachment could not be read.', 503);
      }
      bytes = Buffer.concat(chunks);
    } else {
      bytes = Buffer.from(version.content, 'utf8');
    }
    checkSignal(signal);
    if (bytes.length !== version.bytes || digest(bytes) !== source.sha256)
      fail('REFERENCE_CHANGED', 'Stored document bytes do not match the selected version.', 409);
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail('REFERENCE_UNSUPPORTED', 'The selected file is not valid UTF-8 text.'); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content))
      fail('REFERENCE_UNSUPPORTED', 'The selected file contains binary control bytes.');
    totalChars += content.length;
    totalBytes += bytes.length;
    if (totalChars > MAX_CHARS)
      fail('REFERENCE_TOO_LARGE', 'The selected references exceed 24000 characters. Select fewer or shorter documents.', 413);
    items.push({ source, content });
  }
  checkSignal(signal);
  const current = checkReferences(await readState(), references).references;
  checkSignal(signal);
  return {
    items: items.map((item, index) => ({ ...item, source: current[index] })),
    totalChars, totalBytes, contentRole: 'reference-data',
  };
}
