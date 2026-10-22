// Bundle installation: a bundle is a directory with `harness.bundle.json` listing
// plugin packages that must be installed together. The bundle is validated, then
// installed plugin-by-plugin; if any install fails, the already-installed plugins are
// rolled back so the target returns to its previous state. Offline only.
import { promises as fs } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { ERROR, HarnessError } from '../../harness-contracts/src/index.mjs';
import { appendInstallJournal, installPlugin, listInstalled, readPackage, rollbackPlugin, uninstallPlugin } from './install.mjs';

const BUNDLE_MANIFEST = 'harness.bundle.json';
const MAX_PLUGINS = 32;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const KIND_SERVICES = new Set(['http', 'health']);

const fail = (message, details = undefined) => { throw new HarnessError(ERROR.pluginFailed, message, details); };

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Read and validate a bundle manifest; plugin directories stay inside the bundle. */
export async function readBundle(bundleDir) {
  const dir = resolvePath(bundleDir);
  let raw;
  try { raw = await fs.readFile(join(dir, BUNDLE_MANIFEST), 'utf8'); }
  catch { fail(`bundle ${dir} has no ${BUNDLE_MANIFEST}.`); }
  if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) fail(`${BUNDLE_MANIFEST} is too large.`);
  let document;
  try { document = JSON.parse(raw); }
  catch { fail(`${BUNDLE_MANIFEST} is not valid JSON.`); }
  if (!isPlain(document) || document.version !== 1) fail(`${BUNDLE_MANIFEST} must be { version: 1 }.`);
  if (typeof document.name !== 'string' || !NAME.test(document.name)) fail(`${BUNDLE_MANIFEST}.name must be a bounded identifier.`);
  for (const key of Object.keys(document)) {
    if (!['version', 'name', 'description', 'plugins'].includes(key)) fail(`${BUNDLE_MANIFEST} has an unsupported field ${key}.`);
  }
  const plugins = document.plugins;
  if (!Array.isArray(plugins) || plugins.length === 0 || plugins.length > MAX_PLUGINS)
    fail(`${BUNDLE_MANIFEST}.plugins must be an array of 1..${MAX_PLUGINS} entries.`);
  const ids = new Set();
  const entries = plugins.map((entry, index) => {
    if (!isPlain(entry)) fail(`bundle plugin ${index} must be an object.`);
    for (const key of Object.keys(entry)) {
      if (!['id', 'dir', 'version'].includes(key)) fail(`bundle plugin ${index} has an unsupported field ${key}.`);
    }
    if (typeof entry.id !== 'string' || !NAME.test(entry.id)) fail(`bundle plugin ${index}.id must be a bounded identifier.`);
    if (ids.has(entry.id)) fail(`bundle repeats plugin ${entry.id}.`);
    ids.add(entry.id);
    if (typeof entry.dir !== 'string' || !entry.dir.trim()) fail(`bundle plugin ${entry.id}.dir is required.`);
    const pluginDir = resolvePath(dir, entry.dir);
    const relative = pluginDir.startsWith(dir) ? pluginDir.slice(dir.length + 1) : null;
    if (!relative || relative.startsWith('..')) fail(`bundle plugin ${entry.id}.dir must stay inside the bundle.`);
    return Object.freeze({ id: entry.id, dir: pluginDir, version: entry.version ?? null });
  });
  return Object.freeze({ name: document.name, description: document.description ?? '', plugins: entries, dir });
}

/**
 * Validate dependency reconciliation for a bundle against what is already installed.
 * Returns the provider map the bundle would produce.
 */
export async function validateBundle({ bundleDir, root = process.cwd(), target = 'plugins' } = {}) {
  const bundle = await readBundle(bundleDir);
  const packages = [];
  for (const entry of bundle.plugins) {
    const pkg = await readPackage(entry.dir);
    if (pkg.id !== entry.id) fail(`bundle entry ${entry.id} contains package ${pkg.id}.`);
    if (entry.version !== null && entry.version !== pkg.version)
      fail(`bundle entry ${entry.id} expects version ${entry.version} but the package is ${pkg.version}.`);
    packages.push(pkg);
  }
  const installed = await listInstalled({ root, target });
  const installedPackages = [];
  for (const item of installed) {
    try { installedPackages.push(await readPackage(join(resolvePath(root, target), item.directory))); } catch { /* skip broken */ }
  }
  const providers = new Map();
  const addProvider = (service, pluginId) => {
    const existing = providers.get(service);
    if (existing && existing !== pluginId) fail(`bundle conflict: ${existing} and ${pluginId} both provide ${service}.`);
    providers.set(service, pluginId);
  };
  for (const pkg of installedPackages) for (const service of pkg.manifest.provides) addProvider(service, pkg.id);
  for (const pkg of packages) for (const service of pkg.manifest.provides) addProvider(service, pkg.id);
  const available = new Set([...providers.keys(), ...KIND_SERVICES]);
  const missing = [];
  for (const pkg of packages) {
    for (const service of pkg.manifest.requires) {
      if (!available.has(service)) missing.push(`${pkg.id} requires ${service}`);
    }
  }
  if (missing.length) fail(`bundle cannot be satisfied: ${missing.join('; ')}.`);
  return Object.freeze({ bundle, packages: Object.freeze(packages), providers: Object.freeze([...providers.keys()].sort()) });
}

/**
 * Install every plugin in a bundle; on any failure roll the target back to the state
 * captured before the bundle started, then rethrow with the failing plugin named.
 */
export async function installBundle({
  bundleDir, root = process.cwd(), target = 'plugins', upgrade = false,
  publicKey = null, actor = 'local-operator',
} = {}) {
  const validation = await validateBundle({ bundleDir, root, target });
  const applied = [];
  try {
    for (const pkg of validation.packages) {
      const result = await installPlugin({ sourceDir: pkg.dir, root, target, upgrade, publicKey, actor });
      applied.push({ result, upgraded: Boolean(result.backup) });
    }
  } catch (error) {
    const rolledBack = [];
    for (const item of applied.reverse()) {
      try {
        if (item.upgraded && item.result.backup) await rollbackPlugin({ id: item.result.id, root, target, backup: item.result.backup, actor });
        else await uninstallPlugin({ id: item.result.id, root, target, actor });
        rolledBack.push(item.result.id);
      } catch (rollbackError) {
        // Keep the original failure as the primary error; report the rollback gap.
        rolledBack.push(`${item.result.id}:rollback-failed:${rollbackError?.message ?? rollbackError}`);
      }
    }
    await appendInstallJournal({ root, target, entry: {
      at: new Date().toISOString(), action: 'bundle-failed', actor,
      bundle: validation.bundle.name, failed: applied.length ? null : error?.pluginId ?? null,
      rolledBack, error: error?.code ?? null,
    } });
    const failure = error instanceof HarnessError ? error : new HarnessError(ERROR.pluginFailed, error?.message ?? String(error));
    throw new HarnessError(failure.code, `bundle ${validation.bundle.name} failed: ${failure.message}${rolledBack.length ? ` (rolled back: ${rolledBack.join(', ')})` : ''}`, {
      bundle: validation.bundle.name, rolledBack,
    });
  }
  await appendInstallJournal({ root, target, entry: {
    at: new Date().toISOString(), action: 'bundle-install', actor, bundle: validation.bundle.name,
    plugins: applied.map(item => ({ id: item.result.id, version: item.result.version, digest: item.result.digest, backup: item.result.backup ? 'kept' : null })),
  } });
  return Object.freeze({
    bundle: validation.bundle.name,
    providers: validation.providers,
    installed: Object.freeze(applied.map(item => ({
      id: item.result.id, version: item.result.version, digest: item.result.digest,
      backup: item.result.backup, signed: item.result.signature?.signed === true,
    }))),
  });
}
