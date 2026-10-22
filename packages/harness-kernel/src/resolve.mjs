// Composition loading and plugin-entry resolution for the Workspace Harness kernel.
//
// This module deliberately separates *resolution* (locate an entry, read/derive its
// manifest, import the module without applying it) from *mounting* (app.mjs). The CLI
// uses it for `wh list`/`wh doctor` so a missing package is reported as `missing`
// instead of crashing the process.
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  ERROR,
  HarnessError,
  validateComposition,
  validateManifest,
} from '../../harness-contracts/src/index.mjs';

/** Services the kernel itself provides on every context before plugins are mounted. */
export const KERNEL_SERVICES = Object.freeze(['http', 'health']);

const WORKSPACE_PREFIX = '@workspace-harness/';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** Forward-slashed path relative to `root`, for display and synthetic manifests. */
export function displayPath(root, target) {
  const rel = relative(root, target);
  return (rel || '.').split(sep).join('/');
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string' && item.length > 0);
}

async function statOrNull(target) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}

/**
 * Read + parse + validate a composition document.
 * @returns {Promise<{file: string, composition: ReturnType<typeof validateComposition>}>}
 */
export async function readComposition(compositionPath, { root = process.cwd() } = {}) {
  if (typeof compositionPath !== 'string' || !compositionPath.trim())
    throw new HarnessError(ERROR.compositionInvalid, 'createHarness requires a compositionPath.');
  const file = isAbsolute(compositionPath) ? compositionPath : resolvePath(root, compositionPath);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT')
      throw new HarnessError(ERROR.compositionInvalid, `composition file not found: ${file}`);
    throw new HarnessError(ERROR.compositionInvalid, `cannot read composition file ${file}: ${error?.message ?? error}`);
  }
  let document;
  try {
    document = parseYaml(text);
  } catch (error) {
    throw new HarnessError(ERROR.compositionInvalid, `composition is not valid YAML (${file}): ${error?.message ?? error}`);
  }
  try {
    return { file, composition: validateComposition(document) };
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(ERROR.compositionInvalid, `composition is invalid (${file}): ${error?.message ?? error}`);
  }
}

/**
 * Locate the plugin entry described by a composition row, without importing it yet.
 * Implements the three `name` resolution rules from CONTRACT.md §2.
 */
export function locateRow(row, { root = process.cwd(), compositionFile } = {}) {
  const name = row.name;
  if (name.startsWith(WORKSPACE_PREFIX)) {
    const parts = name.slice(WORKSPACE_PREFIX.length).split('/').filter(Boolean);
    if (!parts.length) {
      return {
        kind: 'module',
        expected: join(root, 'packages', 'harness-', 'src', 'index.mjs'),
        error: new HarnessError(ERROR.pluginFailed, `cannot resolve "${name}": expected @workspace-harness/<package>/<entry>.`),
      };
    }
    const first = parts[0];
    const tail = parts.slice(1);
    let rel = tail.length ? tail.join('/') : 'index.mjs';
    if (!/\.[cm]?js$/u.test(rel)) rel += '.mjs';
    const entryPath = join(root, 'packages', `harness-${first}`, 'src', rel);
    return { kind: 'module', entryPath, expected: entryPath };
  }
  if (
    name.startsWith('./') ||
    name.startsWith('../') ||
    name.startsWith('.\\') ||
    name.startsWith('..\\') ||
    isAbsolute(name)
  ) {
    if (!compositionFile) {
      return {
        kind: 'path',
        expected: name,
        error: new HarnessError(ERROR.pluginFailed, `cannot resolve relative plugin "${name}" without a composition file.`),
      };
    }
    return {
      kind: 'path',
      entryPath: isAbsolute(name) ? name : resolvePath(dirname(compositionFile), name),
      expected: name,
    };
  }
  // Rule 2: a plain name refers to a directory under `<root>/plugins/` with a manifest.
  const pluginDir = join(root, 'plugins', name);
  return { kind: 'plugin', pluginDir, expected: join(pluginDir, 'harness.plugin.json') };
}

async function loadManifestFile(manifestPath) {
  let raw;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT')
      throw new HarnessError(ERROR.pluginFailed, `plugin manifest not found: ${manifestPath}`);
    throw new HarnessError(ERROR.pluginFailed, `cannot read plugin manifest ${manifestPath}: ${error?.message ?? error}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new HarnessError(ERROR.manifestInvalid, `plugin manifest is not valid JSON (${manifestPath}): ${error?.message ?? error}`);
  }
  try {
    return validateManifest(parsed);
  } catch (error) {
    if (error instanceof HarnessError)
      throw new HarnessError(error.code, `${error.message} (${manifestPath})`);
    throw error;
  }
}

/**
 * Best-effort manifest lookup for a row without importing its module. Used by the
 * read-only capability inventory so a disabled row can still describe what it
 * would contribute. Returns null when the row has no manifest file or it is invalid.
 */
export async function readRowManifest(row, options = {}) {
  const located = locateRow(row, options);
  if (located.error || !located.expected || located.kind !== 'plugin') return null;
  try { return await loadManifestFile(located.expected); }
  catch { return null; }
}

/** Derive a manifest for entry modules that do not ship a harness.plugin.json. */
function synthesizeManifest(module, row, entryPath, { root }) {
  const provides = stringList(module.provides);
  const requires = stringList(module.requires);
  const routes = stringList(module.routes);
  const tools = stringList(module.tools);
  return validateManifest({
    id: row.id,
    version: typeof module.version === 'string' && SEMVER.test(module.version) ? module.version : '0.1.0',
    kind: 'provider',
    entry: displayPath(root, entryPath),
    requires,
    provides: provides.length ? provides : [row.id],
    routes,
    tools,
    configSchema: isPlainObject(module.configSchema) ? module.configSchema : undefined,
    description: typeof module.description === 'string' ? module.description : '',
  });
}

function pickApplyExport(module) {
  if (typeof module.apply === 'function') return { kind: 'apply', fn: module.apply, thisArg: module };
  if (typeof module.default === 'function') return { kind: 'apply', fn: module.default, thisArg: undefined };
  if (module.default && typeof module.default === 'object' && typeof module.default.apply === 'function')
    return { kind: 'apply', fn: module.default.apply, thisArg: module.default };
  if (typeof module.plugin === 'function') return { kind: 'apply', fn: module.plugin, thisArg: undefined };
  if (module.plugin && typeof module.plugin === 'object' && typeof module.plugin.apply === 'function')
    return { kind: 'apply', fn: module.plugin.apply, thisArg: module.plugin };
  return null;
}

function pickFactoryExport(module) {
  const isFactoryName = key => /^create[A-Z][A-Za-z0-9]*$/u.test(key);
  let candidates = Object.entries(module).filter(
    ([key, value]) => isFactoryName(key) && typeof value === 'function',
  );
  const providers = candidates.filter(([key]) => key.endsWith('Provider'));
  if (providers.length) candidates = providers;
  if (candidates.length === 1) return { kind: 'factory', factory: candidates[0][1], factoryName: candidates[0][0] };
  if (candidates.length > 1) {
    return {
      kind: 'factory',
      ambiguous: candidates.map(([key]) => key),
    };
  }
  return null;
}

function inspectModule(module, context) {
  const { row, root, compositionFile, entryPath, manifest: declaredManifest } = context;
  let manifest = declaredManifest;
  if (!manifest) {
    if (isPlainObject(module.manifest)) {
      try {
        manifest = validateManifest(module.manifest);
      } catch (error) {
        if (error instanceof HarnessError)
          throw new HarnessError(error.code, `${error.message} (${displayPath(root, entryPath)})`);
        throw error;
      }
    } else {
      manifest = synthesizeManifest(module, row, entryPath, { root, compositionFile });
    }
  }
  const apply = pickApplyExport(module);
  if (apply) return { manifest, plugin: apply };
  const factory = pickFactoryExport(module);
  if (factory?.ambiguous) {
    return {
      manifest,
      plugin: null,
      error: new HarnessError(
        ERROR.pluginFailed,
        `entry ${displayPath(root, entryPath)} exports multiple factories (${factory.ambiguous.join(', ')}); name one seam explicitly, e.g. @workspace-harness/seams/storage.`,
      ),
    };
  }
  if (factory) return { manifest, plugin: factory };
  return {
    manifest,
    plugin: null,
    error: new HarnessError(
      ERROR.pluginFailed,
      `entry ${displayPath(root, entryPath)} exports neither apply(ctx, config) nor a create*Provider factory.`,
    ),
  };
}

async function loadModuleEntry(entryPath, context) {
  let module;
  try {
    module = await import(pathToFileURL(entryPath).href);
  } catch (error) {
    return {
      status: 'invalid',
      entryPath,
      entry: context.display,
      manifest: context.manifest ?? null,
      plugin: null,
      error: new HarnessError(
        ERROR.pluginFailed,
        `cannot import plugin entry ${context.display}: ${error?.message ?? error}`,
      ),
    };
  }
  const { manifest, plugin, error } = inspectModule(module, { ...context, entryPath });
  return {
    status: error ? 'invalid' : 'resolved',
    entryPath,
    entry: context.display,
    manifest,
    module,
    plugin,
    ...(error ? { error } : {}),
    kind: context.kind,
  };
}

function resolveManifestEntry(manifest, pluginDir, { kind, display }) {
  const target = typeof manifest.entry === 'string' ? manifest.entry : '';
  const entryPath = isAbsolute(target) ? target : resolvePath(pluginDir, target);
  return { entryPath, kind, display: `${display}#${target}` };
}

async function inspectPluginTarget(target, { root, compositionFile, row }) {
  const s = await statOrNull(target.entryPath);
  if (!s) {
    return {
      status: 'missing',
      entryPath: target.entryPath,
      entry: displayPath(root, target.entryPath),
      manifest: null,
      error: new HarnessError(ERROR.pluginFailed, `plugin entry not found: ${target.entryPath}`),
    };
  }
  if (s.isDirectory()) {
    const manifestPath = join(target.entryPath, 'harness.plugin.json');
    return inspectManifestTarget(manifestPath, { root, compositionFile, row, dir: target.entryPath });
  }
  if (/\.(json)$/u.test(target.entryPath) || target.entryPath.endsWith('harness.plugin.json')) {
    return inspectManifestTarget(target.entryPath, { root, compositionFile, row, dir: dirname(target.entryPath) });
  }
  return inspectModuleTarget(target.entryPath, { root, compositionFile, row });
}

async function inspectManifestTarget(manifestPath, { root, compositionFile, row, dir }) {
  let manifest;
  try {
    manifest = await loadManifestFile(manifestPath);
  } catch (error) {
    const missing = /not found/u.test(error?.message ?? '');
    return {
      status: missing ? 'missing' : 'invalid',
      entryPath: manifestPath,
      entry: displayPath(root, manifestPath),
      manifest: null,
      error,
    };
  }
  const entry = resolveManifestEntry(manifest, dir, { kind: 'manifest', display: displayPath(root, manifestPath) });
  const s = await statOrNull(entry.entryPath);
  if (!s || s.isDirectory()) {
    return {
      status: 'missing',
      entryPath: entry.entryPath,
      entry: displayPath(root, entry.entryPath),
      manifest,
      error: new HarnessError(ERROR.pluginFailed, `plugin entry not found: ${entry.entryPath}`),
    };
  }
  return loadModuleEntry(entry.entryPath, {
    row,
    root,
    compositionFile,
    manifest,
    kind: 'manifest',
    display: displayPath(root, entry.entryPath),
  });
}

async function inspectModuleTarget(entryPath, { root, compositionFile, row, manifest = null }) {
  const s = await statOrNull(entryPath);
  if (!s) {
    return {
      status: 'missing',
      entryPath,
      entry: displayPath(root, entryPath),
      manifest,
      error: new HarnessError(ERROR.pluginFailed, `plugin entry not found: ${entryPath}`),
    };
  }
  if (s.isDirectory()) {
    return inspectManifestTarget(join(entryPath, 'harness.plugin.json'), {
      root,
      compositionFile,
      row,
      dir: entryPath,
    });
  }
  return loadModuleEntry(entryPath, {
    row,
    root,
    compositionFile,
    manifest,
    kind: 'module',
    display: displayPath(root, entryPath),
  });
}

/**
 * Resolve one composition row to an inspectable entry.
 * Never throws for a missing/invalid plugin: the failure is reported via `status`.
 * HarnessError instances (invalid composition-level data) are preserved in `error`.
 */
export async function resolveRow(row, { root = process.cwd(), compositionFile } = {}) {
  if (row.disabled) {
    return { row, status: 'disabled', disabled: true, entryPath: null, entry: null, manifest: null, plugin: null };
  }
  const target = locateRow(row, { root, compositionFile });
  if (target.error) {
    return {
      row,
      status: 'invalid',
      disabled: false,
      entryPath: target.entryPath ?? null,
      entry: target.entryPath ? displayPath(root, target.entryPath) : String(target.expected ?? row.name),
      manifest: null,
      plugin: null,
      error: target.error,
    };
  }
  let result;
  try {
    if (target.kind === 'plugin') {
      result = await inspectManifestTarget(target.expected, {
        root,
        compositionFile,
        row,
        dir: target.pluginDir,
      });
    } else if (target.kind === 'path') {
      result = await inspectPluginTarget(target, { root, compositionFile, row });
    } else {
      result = await inspectModuleTarget(target.entryPath, { root, compositionFile, row });
    }
  } catch (error) {
    result = {
      status: 'invalid',
      entryPath: target.entryPath ?? target.expected ?? null,
      entry: target.entryPath ? displayPath(root, target.entryPath) : String(target.expected ?? row.name),
      manifest: null,
      plugin: null,
      error:
        error instanceof HarnessError
          ? error
          : new HarnessError(ERROR.pluginFailed, `cannot resolve plugin row "${row.id}": ${error?.message ?? error}`),
    };
  }
  return { row, disabled: false, ...result };
}

/** Resolve every row in composition order (sequential: deterministic imports). */
export async function resolveRows(rows, options) {
  const resolved = [];
  for (const row of rows) resolved.push(await resolveRow(row, options));
  return resolved;
}

/** Parse a route path into segments, validating one-segment `:param` names. */
export function parseRoutePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/'))
    throw new HarnessError(ERROR.pluginFailed, `route path must start with "/": ${String(path)}`);
  if (path.includes('?') || path.includes('#'))
    throw new HarnessError(ERROR.pluginFailed, `route path must not contain a query or fragment: ${path}`);
  const segments = path.split('/');
  const names = new Set();
  let hasParams = false;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (index === 0) continue;
    if (!segment.startsWith(':')) continue;
    const name = segment.slice(1);
    if (!PARAM_NAME.test(name))
      throw new HarnessError(ERROR.pluginFailed, `invalid route parameter ":${name}" in "${path}" (expected :[A-Za-z_][A-Za-z0-9_]*).`);
    if (names.has(name))
      throw new HarnessError(ERROR.pluginFailed, `duplicate route parameter ":${name}" in "${path}".`);
    names.add(name);
    hasParams = true;
  }
  return { segments, names, hasParams };
}
