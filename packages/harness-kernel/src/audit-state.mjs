// Append unified audit entries to a storage state file without mounting a harness.
// Used by the offline installer so package operations land in the same durable
// stream that `wh audit` and ctx.audit read. Entries are metadata only; the write is
// atomic (same-directory temp file + rename) and the log is capped like ctx.audit.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { ERROR, HarnessError } from '../../harness-contracts/src/index.mjs';

const KIND = /^[a-z][a-z0-9_.-]{0,63}$/u;
const ACTION = /^[a-z][a-z0-9_.:-]{0,127}$/u;
const MAX_DETAIL_BYTES = 2048;
const DEFAULT_LIMIT = 1000;

const invalid = message => { throw new HarnessError(ERROR.storageInvalid, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeEntry(entry) {
  if (!isPlain(entry)) invalid('audit entry must be a plain object.');
  for (const key of Object.keys(entry)) {
    if (!['kind', 'action', 'actor', 'ok', 'code', 'detail', 'ref'].includes(key)) invalid(`audit entry has an unsupported field ${key}.`);
  }
  if (typeof entry.kind !== 'string' || !KIND.test(entry.kind)) invalid('audit kind must be a bounded identifier.');
  if (typeof entry.action !== 'string' || !ACTION.test(entry.action)) invalid('audit action must be a bounded identifier.');
  const ok = entry.ok === undefined ? true : entry.ok;
  if (typeof ok !== 'boolean') invalid('audit ok must be a boolean.');
  let actor = null;
  if (entry.actor !== undefined && entry.actor !== null) {
    if (!isPlain(entry.actor) || typeof entry.actor.subject !== 'string' || !entry.actor.subject || entry.actor.subject.length > 200)
      invalid('audit actor must be {subject, role?}.');
    actor = { subject: entry.actor.subject, role: typeof entry.actor.role === 'string' ? entry.actor.role.slice(0, 40) : null };
  }
  const code = entry.code === undefined || entry.code === null ? null : String(entry.code);
  if (code !== null && !/^[A-Z][A-Z0-9_]{1,63}$/u.test(code)) invalid('audit code must be an upper-case error code.');
  let ref = null;
  if (entry.ref !== undefined && entry.ref !== null) {
    if (typeof entry.ref !== 'string' || !entry.ref.trim() || entry.ref.length > 200) invalid('audit ref must be bounded text.');
    ref = entry.ref;
  }
  let detail = null;
  if (entry.detail !== undefined && entry.detail !== null) {
    if (!isPlain(entry.detail)) invalid('audit detail must be a plain object.');
    if (Buffer.byteLength(JSON.stringify(entry.detail), 'utf8') > MAX_DETAIL_BYTES) invalid(`audit detail must be at most ${MAX_DETAIL_BYTES} bytes.`);
    detail = entry.detail;
  }
  return {
    id: randomUUID(), at: new Date().toISOString(),
    kind: entry.kind, action: entry.action, actor, ok, code, detail, ref,
  };
}

/**
 * Append one entry to the state file's harnessAudit stream.
 * @returns {Promise<{file:string, entry:object, total:number}>}
 */
export async function appendAuditEntry(stateFile, entry, { root = process.cwd(), limit = DEFAULT_LIMIT } = {}) {
  if (typeof stateFile !== 'string' || !stateFile.trim()) throw new TypeError('appendAuditEntry requires a state file path.');
  const file = isAbsolute(stateFile) ? stateFile : resolvePath(root, stateFile);
  const normalized = normalizeEntry(entry);
  await mkdir(dirname(file), { recursive: true });
  let document = { version: 1 };
  let raw = null;
  try { raw = await readFile(file, 'utf8'); }
  catch { /* first write creates the state file */ }
  if (raw !== null) {
    try { document = JSON.parse(raw); }
    catch { invalid(`audit state ${file} is not valid JSON; refusing to overwrite it.`); }
    if (!isPlain(document)) invalid(`audit state ${file} must be a JSON object.`);
  }
  if (document.harnessAudit !== undefined && !Array.isArray(document.harnessAudit)) invalid(`audit state ${file}: harnessAudit must be an array.`);
  const log = Array.isArray(document.harnessAudit) ? document.harnessAudit : [];
  log.push(normalized);
  const capacity = Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  if (log.length > capacity) log.splice(0, log.length - capacity);
  document.harnessAudit = log;
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
  return Object.freeze({ file, entry: Object.freeze(normalized), total: log.length });
}

/** Stable digest helper shared with the installer journal. */
export const digestOf = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
