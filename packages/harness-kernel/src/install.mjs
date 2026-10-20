// Offline plugin package installer: controlled target directory, manifest and entry
// validation, content digest, optional ed25519 signature verification, atomic
// staging + rename, one-step backup and rollback, and an append-only install journal.
// No network, no archive extraction and no execution of package code here.
import { createHash, randomUUID, verify as verifySignatureBytes } from 'node:crypto';
import { appendFile, cp, mkdir, readFile, readdir, readlink, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve as resolvePath, relative, sep } from 'node:path';
import { ERROR, HarnessError, validateManifest } from '../../harness-contracts/src/index.mjs';

const TARGET_DEFAULT = 'plugins';
const PACKAGE_META = 'harness.package.json';
const JOURNAL_NAME = '.install-journal.jsonl';
const MAX_FILES = 512;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 4096;
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SIGNATURE = /^[A-Za-z0-9+/=]{16,512}$/u;

const fail = (message, details = undefined) => { throw new HarnessError(ERROR.pluginFailed, message, details); };
const statSafe = async path => { try { return await stat(path); } catch { return null; } };

function ensureInside(directory, candidate, label) {
  const base = resolvePath(directory);
  const value = resolvePath(candidate);
  const rel = relative(base, value);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail(`${label} must stay inside the package directory.`);
  return value;
}

function assertId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new HarnessError(ERROR.manifestInvalid, `plugin id ${JSON.stringify(id)} is not a bounded identifier.`);
  return id;
}

async function digestDirectory(directory, { exclude = [PACKAGE_META] } = {}) {
  const files = [];
  let total = 0;
  const walk = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await readlink(absolute).catch(() => '?');
        fail(`package must not contain symlinks (${relative(directory, absolute)} -> ${target}).`);
      }
      if (entry.isDirectory()) { await walk(absolute); continue; }
      if (!entry.isFile()) continue;
      const relativePath = relative(directory, absolute).split(sep).join('/');
      if (exclude.includes(relativePath)) continue;
      const info = await stat(absolute);
      total += info.size;
      if (total > MAX_BYTES) fail(`package exceeds ${MAX_BYTES} bytes.`);
      files.push({ path: relativePath, sha256: createHash('sha256').update(await readFile(absolute)).digest('hex'), size: info.size });
      if (files.length > MAX_FILES) fail(`package contains more than ${MAX_FILES} files.`);
    }
  };
  await walk(directory);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

const isPlainDocument = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Optional `harness.package.json`: `{ version: 1, digest?, signature?, signer? }`.
 * The digest covers every package file except this metadata file itself.
 */
async function readPackageMeta(directory) {
  let raw;
  try { raw = await readFile(join(directory, PACKAGE_META), 'utf8'); }
  catch { return null; }
  if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) fail(`${PACKAGE_META} is too large.`);
  let document;
  try { document = JSON.parse(raw); }
  catch { fail(`${PACKAGE_META} is not valid JSON.`); }
  if (!isPlainDocument(document) || document.version !== 1) fail(`${PACKAGE_META} must be { version: 1 }.`);
  for (const key of Object.keys(document)) {
    if (!['version', 'digest', 'signature', 'signer'].includes(key)) fail(`${PACKAGE_META} has an unsupported field ${key}.`);
  }
  if (document.digest !== undefined && (typeof document.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(document.digest)))
    fail(`${PACKAGE_META}.digest must be a sha256 hex digest.`);
  if (document.signature !== undefined && (typeof document.signature !== 'string' || document.signature.length > MAX_SIGNATURE_BYTES || !SIGNATURE.test(document.signature)))
    fail(`${PACKAGE_META}.signature must be bounded base64 text.`);
  if (document.signer !== undefined && (typeof document.signer !== 'string' || !document.signer.trim() || document.signer.length > 200))
    fail(`${PACKAGE_META}.signer must be bounded text.`);
  return Object.freeze({ version: 1, digest: document.digest ?? null, signature: document.signature ?? null, signer: document.signer ?? null });
}

/**
 * Verify the optional signature offline. An unsigned package is accepted (and
 * reported as unsigned); a signed package requires a public key and must match the
 * computed content digest.
 */
export function verifyPackageSignature(pkg, { publicKey = null } = {}) {
  const meta = pkg?.signature;
  if (!meta) return Object.freeze({ signed: false, verified: false, signer: null });
  if (meta.digest && meta.digest !== pkg.digest)
    fail(`package ${pkg.id}: declared digest does not match its content digest.`);
  if (!meta.signature) fail(`package ${pkg.id}: declares a digest but no signature.`);
  if (!publicKey) fail(`package ${pkg.id} is signed; pass --public-key <pem> for offline verification.`);
  const verified = verifySignatureBytes(null, Buffer.from(pkg.digest, 'utf8'), publicKey, Buffer.from(meta.signature, 'base64'));
  if (!verified) fail(`package ${pkg.id}: signature does not match its content digest.`);
  return Object.freeze({ signed: true, verified: true, signer: meta.signer });
}

export const installJournalPath = ({ root = process.cwd(), target = TARGET_DEFAULT } = {}) => join(resolvePath(root, target), JOURNAL_NAME);

async function appendJournal({ root, target, entry }) {
  try { await appendFile(installJournalPath({ root, target }), `${JSON.stringify(entry)}\n`, { mode: 0o600 }); }
  catch { /* journaling is best effort; the installation already succeeded */ }
}

/** Read the install journal (newest last, bounded). */
export async function readInstallJournal({ root = process.cwd(), target = TARGET_DEFAULT, limit = 50 } = {}) {
  let raw;
  try { raw = await readFile(installJournalPath({ root, target }), 'utf8'); }
  catch { return Object.freeze([]); }
  const size = Number.isSafeInteger(limit) && limit > 0 ? limit : 50;
  const entries = [];
  for (const line of raw.split('\n').filter(Boolean).slice(-size)) {
    try { entries.push(JSON.parse(line)); } catch { /* skip a torn line */ }
  }
  return Object.freeze(entries);
}

/**
 * Read and validate a plugin package directory.
 * @returns {Promise<{id:string, version:string, manifest:object, dir:string, entry:string, digest:string}>}
 */
export async function readPackage(sourceDir, { requireEntry = true } = {}) {
  if (typeof sourceDir !== 'string' || !sourceDir.trim()) throw new TypeError('readPackage requires a package directory.');
  const dir = resolvePath(sourceDir);
  let raw;
  try { raw = await readFile(join(dir, 'harness.plugin.json'), 'utf8'); }
  catch { fail(`package ${dir} has no harness.plugin.json.`); }
  let document;
  try { document = JSON.parse(raw); }
  catch (error) { fail(`package ${dir}: harness.plugin.json is not valid JSON (${error?.message ?? error}).`); }
  let manifest;
  try { manifest = validateManifest(document); }
  catch (error) {
    if (error instanceof HarnessError) throw error;
    fail(`package ${dir}: invalid manifest (${error?.message ?? error}).`);
  }
  const entry = ensureInside(dir, join(dir, manifest.entry), 'manifest.entry');
  if (requireEntry) {
    const info = await statSafe(entry);
    if (!info?.isFile()) fail(`package ${manifest.id}: entry ${manifest.entry} does not exist.`);
  }
  return Object.freeze({
    id: manifest.id, version: manifest.version, manifest, dir, entry,
    digest: await digestDirectory(dir), signature: await readPackageMeta(dir),
  });
}

/** Installed packages in a target directory, skipping staging/backup directories. */
export async function listInstalled({ root = process.cwd(), target = TARGET_DEFAULT } = {}) {
  const targetDir = resolvePath(root, target);
  let entries;
  try { entries = await readdir(targetDir, { withFileTypes: true }); }
  catch { return []; }
  const installed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const pkg = await readPackage(join(targetDir, entry.name));
      installed.push(Object.freeze({ id: pkg.id, version: pkg.version, directory: entry.name, digest: pkg.digest }));
    } catch {
      // A directory that is not a valid package is not an installation.
    }
  }
  return Object.freeze(installed.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)));
}

/**
 * Install or upgrade a package into `<root>/<target>/<id>`.
 * The copy is staged under a dot-directory, digest-checked, then renamed into place;
 * an existing installation is moved to a timestamped backup first.
 */
export async function installPlugin({
  sourceDir, root = process.cwd(), target = TARGET_DEFAULT, upgrade = false,
  publicKey = null, actor = 'local-operator',
} = {}) {
  const pkg = await readPackage(sourceDir);
  const signature = verifyPackageSignature(pkg, { publicKey });
  const targetDir = resolvePath(root, target);
  await mkdir(targetDir, { recursive: true });
  const destination = join(targetDir, pkg.id);
  const existing = await statSafe(destination);
  if (existing && !upgrade)
    throw new HarnessError(ERROR.pluginDuplicate, `Plugin ${pkg.id} is already installed at ${destination}; pass upgrade to replace it.`, { pluginId: pkg.id });
  if (existing && !existing.isDirectory())
    fail(`Cannot install ${pkg.id}: ${destination} exists and is not a directory.`);
  let previousDigest = null;
  if (existing) {
    try { previousDigest = (await readPackage(destination)).digest; } catch { previousDigest = null; }
  }

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const staging = join(targetDir, `.staging-${pkg.id}-${suffix}`);
  await cp(pkg.dir, staging, { recursive: true, errorOnExist: false });
  try {
    const staged = await readPackage(staging);
    if (staged.digest !== pkg.digest || staged.id !== pkg.id) fail(`Staged copy of ${pkg.id} does not match the source package.`);
    let backup = null;
    if (existing) {
      backup = join(targetDir, `.backup-${pkg.id}-${suffix}`);
      await rename(destination, backup);
    }
    try {
      await rename(staging, destination);
    } catch (error) {
      if (backup) await rename(backup, destination).catch(() => {});
      throw error;
    }
    await appendJournal({ root, target, entry: {
      at: new Date().toISOString(), action: existing ? 'upgrade' : 'install', actor,
      id: pkg.id, version: pkg.version, digest: pkg.digest, previousDigest,
      signed: signature.signed, verified: signature.verified, signer: signature.signer,
      backup: backup ? relative(targetDir, backup).split(sep).join('/') : null,
    } });
    return Object.freeze({ id: pkg.id, version: pkg.version, digest: pkg.digest, destination, backup, signature });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    if (error instanceof HarnessError) throw error;
    fail(`Installing ${pkg.id} failed: ${error?.message ?? error}`);
  }
}

/** Move an installed package out of the way, keeping a restorable backup. */
export async function uninstallPlugin({ id, root = process.cwd(), target = TARGET_DEFAULT, actor = 'local-operator' } = {}) {
  const pluginId = assertId(id);
  const targetDir = resolvePath(root, target);
  const destination = join(targetDir, pluginId);
  const info = await statSafe(destination);
  if (!info?.isDirectory()) throw new HarnessError(ERROR.pluginFailed, `Plugin ${pluginId} is not installed in ${targetDir}.`);
  let digest = null;
  try { digest = (await readPackage(destination)).digest; } catch { digest = null; }
  const backup = join(targetDir, `.backup-${pluginId}-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await rename(destination, backup);
  await appendJournal({ root, target, entry: {
    at: new Date().toISOString(), action: 'uninstall', actor, id: pluginId, digest,
    backup: relative(targetDir, backup).split(sep).join('/'),
  } });
  return Object.freeze({ id: pluginId, backup });
}

/**
 * Restore an explicit backup, or the newest backup for the id when `backup` is null.
 * The current installation (if any) is moved to a `.rollback-` directory first.
 */
export async function rollbackPlugin({ id, root = process.cwd(), target = TARGET_DEFAULT, backup = null, actor = 'local-operator' } = {}) {
  const pluginId = assertId(id);
  const targetDir = resolvePath(root, target);
  let source = backup ? ensureInside(targetDir, backup, 'backup') : null;
  if (!source) {
    const prefix = `.backup-${pluginId}-`;
    const candidates = (await readdir(targetDir).catch(() => []))
      .filter(name => name.startsWith(prefix))
      .sort();
    if (!candidates.length) throw new HarnessError(ERROR.pluginFailed, `No backup is available for plugin ${pluginId}.`);
    source = join(targetDir, candidates[candidates.length - 1]);
  }
  const info = await statSafe(source);
  if (!info?.isDirectory()) throw new HarnessError(ERROR.pluginFailed, `Backup ${source} does not exist.`);
  const destination = join(targetDir, pluginId);
  let displaced = null;
  let restoredDigest = null;
  try { restoredDigest = (await readPackage(source)).digest; } catch { restoredDigest = null; }
  const current = await statSafe(destination);
  if (current) {
    displaced = join(targetDir, `.rollback-${pluginId}-${Date.now()}`);
    await rename(destination, displaced);
  }
  await rename(source, destination);
  await appendJournal({ root, target, entry: {
    at: new Date().toISOString(), action: 'rollback', actor, id: pluginId,
    digest: restoredDigest, restoredFrom: relative(targetDir, source).split(sep).join('/'),
    displaced: displaced ? relative(targetDir, displaced).split(sep).join('/') : null,
  } });
  return Object.freeze({ id: pluginId, restoredFrom: source, displaced });
}
