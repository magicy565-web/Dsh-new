// Composition patch layers: override, insert or disable rows without editing the
// base composition. Same idea as dsh's cordis.patch.yml, reduced to the parts the
// Workspace Harness actually needs and validated fail-closed.
import { createHash } from 'node:crypto';
import { appendFile, copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ERROR, HarnessError, validateComposition, validateRow } from '../../harness-contracts/src/index.mjs';

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_PATCH_BYTES = 64 * 1024;

const fail = (message) => { throw new HarnessError(ERROR.compositionInvalid, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** A patch entry targets an existing row by id; fields are replaced wholesale. */
function validateEntry(entry, index) {
  if (!isPlain(entry)) fail(`patch entry ${index} must be an object.`);
  if (typeof entry.id !== 'string' || !NAME.test(entry.id) && !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(entry.id))
    fail(`patch entry ${index}.id must be a row id.`);
  const output = { id: entry.id };
  for (const key of Object.keys(entry)) {
    if (key === 'id') continue;
    if (!['disabled', 'config', 'name'].includes(key)) fail(`patch entry ${entry.id} has an unsupported field ${key}.`);
  }
  if (entry.disabled !== undefined) {
    if (typeof entry.disabled !== 'boolean') fail(`patch entry ${entry.id}.disabled must be a boolean.`);
    output.disabled = entry.disabled;
  }
  if (entry.config !== undefined) {
    if (!isPlain(entry.config)) fail(`patch entry ${entry.id}.config must be an object (it replaces the row config wholesale).`);
    output.config = structuredClone(entry.config);
  }
  if (entry.name !== undefined) {
    if (typeof entry.name !== 'string' || !entry.name.trim()) fail(`patch entry ${entry.id}.name must be a non-empty string.`);
    output.name = entry.name;
  }
  if (output.disabled === undefined && output.config === undefined && output.name === undefined)
    fail(`patch entry ${entry.id} changes nothing.`);
  return output;
}

export function validatePatch(document, { file = null } = {}) {
  if (!isPlain(document)) fail('a patch must be a YAML mapping.');
  if (document.version !== 1) fail('patch.version must be 1.');
  const name = document.name === undefined ? null : document.name;
  if (name !== null && (typeof name !== 'string' || !name.trim())) fail('patch.name must be non-empty text.');
  const insert = document.insert === undefined ? [] : document.insert;
  if (!Array.isArray(insert) || insert.length > 64) fail('patch.insert must be an array of at most 64 rows.');
  const entries = document.entries === undefined ? [] : document.entries;
  if (!Array.isArray(entries) || entries.length > 64) fail('patch.entries must be an array of at most 64 entries.');
  const rows = insert.map((row, index) => validateRow(row, index));
  const changes = entries.map((entry, index) => validateEntry(entry, index));
  if (new Set(changes.map(change => change.id)).size !== changes.length) fail('patch.entries targets the same row twice.');
  if (!rows.length && !changes.length) fail('the patch is empty.');
  return Object.freeze({ version: 1, name, insert: Object.freeze(rows), entries: Object.freeze(changes), file });
}

export async function readPatch(patchPath, { root = process.cwd() } = {}) {
  if (typeof patchPath !== 'string' || !patchPath.trim()) fail('a patch path is required.');
  const file = isAbsolute(patchPath) ? patchPath : resolvePath(root, patchPath);
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch { throw new HarnessError(ERROR.compositionInvalid, `patch not found: ${file}`); }
  if (Buffer.byteLength(raw, 'utf8') > MAX_PATCH_BYTES) fail(`patch ${file} exceeds ${MAX_PATCH_BYTES} bytes.`);
  let document;
  try { document = parseYaml(raw); }
  catch (error) { throw new HarnessError(ERROR.compositionInvalid, `patch ${file} is not valid YAML: ${error?.message ?? error}`); }
  return { file, patch: validatePatch(document, { file }) };
}

const rowDocument = row => ({
  id: row.id,
  name: row.name,
  config: structuredClone(row.config ?? {}),
  ...(row.disabled ? { disabled: true } : {}),
  ...(row.isolate && Object.keys(row.isolate).length ? { isolate: row.isolate } : {}),
});

/**
 * Apply validated patches over a validated composition.
 * A patch may disable a row, replace its config, or insert a new row. Unknown
 * targets and duplicate inserts fail closed so a typo cannot silently do nothing.
 */
export function applyPatches(composition, patches = []) {
  if (!composition || !Array.isArray(composition.rows)) fail('applyPatches requires a validated composition.');
  if (!Array.isArray(patches)) fail('patches must be an array.');
  const rows = composition.rows.map(rowDocument);
  const byId = new Map(rows.map(row => [row.id, row]));
  const applied = [];
  for (const patch of patches) {
    if (!patch || !Array.isArray(patch.entries) || !Array.isArray(patch.insert)) fail('applyPatches received an unvalidated patch.');
    for (const entry of patch.entries) {
      const row = byId.get(entry.id);
      if (!row) throw new HarnessError(ERROR.compositionInvalid, `patch ${patch.file ?? patch.name ?? ''} targets unknown row ${JSON.stringify(entry.id)}.`, { rowId: entry.id });
      if (entry.name !== undefined && entry.name !== row.name)
        throw new HarnessError(ERROR.compositionInvalid, `patch may not rename row ${entry.id} (${row.name} -> ${entry.name}).`, { rowId: entry.id });
      if (entry.config !== undefined) row.config = structuredClone(entry.config);
      if (entry.disabled !== undefined) {
        if (entry.disabled) row.disabled = true;
        else delete row.disabled;
      }
      applied.push({ patch: patch.file ?? patch.name ?? null, id: entry.id, action: entry.disabled === undefined ? 'config' : entry.disabled ? 'disable' : 'enable' });
    }
    for (const inserted of patch.insert) {
      if (byId.has(inserted.id)) throw new HarnessError(ERROR.compositionInvalid, `patch inserts duplicate row ${JSON.stringify(inserted.id)}.`, { rowId: inserted.id });
      const row = { id: inserted.id, name: inserted.name, config: structuredClone(inserted.config ?? {}), ...(inserted.disabled ? { disabled: true } : {}) };
      rows.push(row);
      byId.set(row.id, row);
      applied.push({ patch: patch.file ?? patch.name ?? null, id: row.id, action: 'insert' });
    }
  }
  const document = { version: 1, name: composition.name, server: composition.server, plugins: rows };
  const result = validateComposition(document);
  return Object.freeze({
    composition: result,
    applied: Object.freeze(applied),
    files: Object.freeze(patches.map(patch => patch.file).filter(Boolean)),
  });
}

/** Stable digest of the effective composition, for audit and drift comparison. */
export function digestComposition(composition) {
  const rows = (composition?.rows ?? []).map(row => ({ id: row.id, name: row.name, config: row.config ?? {}, disabled: Boolean(row.disabled) }));
  return createHash('sha256').update(JSON.stringify({ name: composition?.name ?? null, server: composition?.server ?? null, rows })).digest('hex');
}

const rowsForWrite = patch => patch.insert.map(row => ({
  id: row.id, name: row.name, config: structuredClone(row.config ?? {}), ...(row.disabled ? { disabled: true } : {}),
}));

const entriesForWrite = patch => patch.entries.map(entry => ({
  id: entry.id,
  ...(entry.disabled !== undefined ? { disabled: entry.disabled } : {}),
  ...(entry.config !== undefined ? { config: structuredClone(entry.config) } : {}),
  ...(entry.name !== undefined ? { name: entry.name } : {}),
}));

/**
 * Write a validated patch layer atomically. The previous bytes are copied to
 * `<file>.bak` first so a reviewable, reversible edit always exists. Comments in
 * the old file are not preserved (YAML re-serialisation); the backup keeps them.
 * Every write appends one line to `<file>.journal.jsonl` (no message bodies).
 */
export async function writePatch(patchPath, document, { root = process.cwd(), backup = true, note = null } = {}) {
  const file = isAbsolute(patchPath) ? patchPath : resolvePath(root, patchPath);
  const patch = validatePatch(document, { file });
  const text = stringifyYaml({
    version: 1,
    ...(patch.name ? { name: patch.name } : {}),
    entries: entriesForWrite(patch),
    ...(patch.insert.length ? { insert: rowsForWrite(patch) } : {}),
  });
  if (Buffer.byteLength(text, 'utf8') > MAX_PATCH_BYTES) fail(`the rewritten patch would exceed ${MAX_PATCH_BYTES} bytes.`);
  let backupFile = null;
  let beforeDigest = null;
  try {
    const previous = await readFile(file);
    beforeDigest = digestText(previous);
    if (backup) {
      backupFile = `${file}.bak`;
      await copyFile(file, backupFile);
    }
  } catch { /* first write: no previous layer to back up */ }
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, file);
  const afterDigest = digestText(Buffer.from(text, 'utf8'));
  await appendPatchJournal(file, {
    at: new Date().toISOString(), event: 'patch.write', file,
    beforeDigest, afterDigest, backup: backupFile,
    ...(isPlain(note) ? note : {}),
  });
  return Object.freeze({ file, backup: backupFile, patch, digest: afterDigest, beforeDigest });
}

const digestText = value => createHash('sha256').update(value).digest('hex');

export const patchJournalPath = file => `${file}.journal.jsonl`;

/** Append one metadata-only audit line; a journal failure never breaks the write. */
export async function appendPatchJournal(file, entry) {
  try {
    await appendFile(patchJournalPath(file), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch { /* the audit trail is best-effort; the layer write already succeeded */ }
}

/** Read the journal for a patch layer (bounded, newest last). */
export async function readPatchJournal(patchPath, { root = process.cwd(), limit = 200 } = {}) {
  const file = isAbsolute(patchPath) ? patchPath : resolvePath(root, patchPath);
  let raw;
  try { raw = await readFile(patchJournalPath(file), 'utf8'); } catch { return []; }
  const lines = raw.split('\n').filter(Boolean).slice(-limit);
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch { /* skip a torn line, keep the rest */ }
  }
  return entries;
}

/**
 * Set (or clear) the `disabled` override for one row inside an existing patch
 * layer. The whole layer is re-validated before writing; a malformed file is
 * refused instead of being silently rewritten.
 */
export async function setRowDisabled(patchPath, rowId, disabled, { root = process.cwd() } = {}) {
  if (typeof rowId !== 'string' || !rowId.trim()) fail('a row id is required.');
  if (typeof disabled !== 'boolean') fail('disabled must be a boolean.');
  const file = isAbsolute(patchPath) ? patchPath : resolvePath(root, patchPath);
  let document = { version: 1, name: 'local-overrides', entries: [] };
  let existing = null;
  try { existing = await readFile(file, 'utf8'); } catch { /* create a new layer */ }
  if (existing !== null) {
    if (Buffer.byteLength(existing, 'utf8') > MAX_PATCH_BYTES) fail(`patch ${file} exceeds ${MAX_PATCH_BYTES} bytes.`);
    let parsed;
    try { parsed = parseYaml(existing); } catch (error) { throw new HarnessError(ERROR.compositionInvalid, `patch ${file} is not valid YAML: ${error?.message ?? error}`); }
    const validated = validatePatch(parsed, { file });
    document = {
      version: 1,
      ...(validated.name ? { name: validated.name } : {}),
      entries: entriesForWrite(validated),
      ...(validated.insert.length ? { insert: rowsForWrite(validated) } : {}),
    };
  }
  const entries = document.entries.filter(entry => entry.id !== rowId);
  if (disabled) entries.push({ id: rowId, disabled: true });
  if (!entries.length && !(document.insert?.length)) {
    // Removing the last override leaves an empty layer; delete the file instead of
    // writing a patch that validatePatch would reject as empty.
    if (existing === null) return Object.freeze({ file, removed: false, action: 'enable', rowId, patch: null });
    const backupFile = `${file}.bak`;
    await copyFile(file, backupFile);
    await appendPatchJournal(file, { at: new Date().toISOString(), event: 'patch.remove', file, action: 'enable', rowId, backup: backupFile });
    await rm(file, { force: true });
    return Object.freeze({ file, removed: true, backup: backupFile, action: 'enable', rowId, patch: null });
  }
  const written = await writePatch(file, { ...document, entries }, { root, backup: true, note: { action: disabled ? 'disable' : 'enable', rowId } });
  return Object.freeze({ ...written, action: disabled ? 'disable' : 'enable', rowId });
}
