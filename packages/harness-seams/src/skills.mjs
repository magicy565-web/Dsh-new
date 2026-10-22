// Skills seam: a bounded, in-memory agent-skill registry with strict, read-only
// discovery of `SKILL.md` files under configured roots.
//
// Contract (packages/harness-contracts/CONTRACT.md §5, SERVICE.skills):
//
//   createSkills({ roots, maxSkills, maxBytes })            -> service
//   createSkillsProvider({ roots, maxSkills, maxBytes })    -> { apply(ctx, config) }
//   manifest = { id: 'skills', kind: 'provider', provides: ['skills'], requires: [] }
//
//   ctx.skills.register({ name, description, body, source, pluginId? }) -> frozen skill record
//   ctx.skills.list({ pluginId?, limit? }) -> [{ name, description, source, pluginId, bytes }]
//   ctx.skills.load(name)                  -> { name, description, body, source }
//   ctx.skills.scan()                      -> { skills: [...summaries], errors: [...] }
//   ctx.skills.remove(name)                -> true
//   ctx.skills.close()                     -> void
//
// Safety rules implemented here:
//   * skill bodies are opaque data: this module never imports, evaluates or
//     otherwise executes them, and no network I/O exists anywhere in the seam;
//   * every body is capped by `maxBytes` (default 64 KiB) and the registry is
//     capped by `maxSkills` (default 200);
//   * discovery is confined to the configured roots. Relative roots resolve
//     against the repository root and MUST stay inside it; absolute roots are
//     honoured as explicit operator intent (tests/CI/dedicated checkouts);
//   * symbolic links are refused (root components, skill directories and
//     SKILL.md files): `lstat` is used on every path the scanner visits, so a
//     link can never redirect a read outside the configured root tree;
//   * the frontmatter parser is deliberately tiny and strict: one `---` line,
//     only `name:` and `description:` scalar lines, no nesting/block scalars/
//     duplicate keys/unknown keys. Malformed skills are reported as error
//     entries by `scan()` instead of failing the whole scan.
//
// Error codes (reported to the Lead; the three core ones already exist in
// `harness-contracts/src/index.mjs`'s ERROR table):
//   HARNESS_SKILL_INVALID      (ERROR.skillInvalid)   invalid registration or frontmatter
//   HARNESS_SKILL_DUPLICATE    (ERROR.skillDuplicate) duplicate skill name
//   HARNESS_SKILL_NOT_FOUND    (ERROR.skillNotFound)  unknown name in load()/remove()
//   HARNESS_SKILL_TOO_LARGE    seam-local: body/file exceeds `maxBytes`
//   HARNESS_SKILL_LIMIT        seam-local: registry is full (`maxSkills`)
//   HARNESS_SKILL_ROOT_INVALID seam-local: unsafe/refused scan root or symlink
//   HARNESS_SKILL_CLOSED       seam-local: operation after close()

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR, HarnessError, SERVICE } from '../../harness-contracts/src/index.mjs';
import { provideService, serviceFromContext } from './ctx.mjs';

/** This checkout's root: the boundary for relative scan roots. */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
/** Default scan patterns, resolved against REPO_ROOT: one directory per skill. */
export const DEFAULT_ROOTS = Object.freeze(['plugins/*/skills/*']);
export const DEFAULT_MAX_SKILLS = 200;
export const DEFAULT_MAX_BYTES = 64 * 1024;
/** The frontmatter block itself is tiny; a giant file is refused without reading. */
export const MAX_FRONTMATTER_BYTES = 8 * 1024;
const MAX_FRONTMATTER_LINES = 64;
const SKILL_FILE = 'SKILL.md';

/** Stable, documented codes for failures the frozen ERROR table does not cover. */
export const SKILL_ERROR = Object.freeze({
  invalid: ERROR.skillInvalid,
  duplicate: ERROR.skillDuplicate,
  notFound: ERROR.skillNotFound,
  tooLarge: 'HARNESS_SKILL_TOO_LARGE',
  limit: 'HARNESS_SKILL_LIMIT',
  rootInvalid: 'HARNESS_SKILL_ROOT_INVALID',
  closed: 'HARNESS_SKILL_CLOSED',
});

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_DESCRIPTION_CHARS = 4096;
const MAX_SOURCE_CHARS = 1024;
const UNSUPPORTED_SCALAR_FIRST = new Set(['|', '>', '&', '*', '!', '{', '[', ']', '}']);

/** Lightweight provider manifest (optional for the kernel; used for topo/list if honoured). */
export const manifest = Object.freeze({
  id: 'skills',
  version: '0.1.0',
  kind: 'provider',
  description: 'Agent skill registry with strict, read-only SKILL.md discovery',
  entry: './src/skills.mjs',
  requires: Object.freeze([]),
  provides: Object.freeze([SERVICE.skills]),
});

const isPlain = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

const toPosix = value => value.split(path.sep).join('/');
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const byteLength = value => Buffer.byteLength(value, 'utf8');

/** Stable display form of a source: repo-relative when inside the repo, else absolute POSIX. */
function displaySource(file) {
  const resolved = path.resolve(file);
  if (isInside(REPO_ROOT, resolved)) return toPosix(path.relative(REPO_ROOT, resolved));
  return toPosix(resolved);
}

/** Best-effort owning plugin id for a skill directory inside `<repo>/plugins/<id>/...`. */
function pluginIdFor(directory) {
  const relative = path.relative(REPO_ROOT, directory);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep);
  if (parts[0] !== 'plugins' || parts.length < 2 || !parts[1]) return null;
  return ID.test(parts[1]) ? parts[1] : null;
}

const invalid = (message, details = undefined) => new HarnessError(SKILL_ERROR.invalid, message, details);
const rootInvalid = (message, details = undefined) => new HarnessError(SKILL_ERROR.rootInvalid, message, details);

function validateName(value) {
  if (typeof value !== 'string' || !SKILL_NAME.test(value))
    throw invalid(`skill.name must match ${String(SKILL_NAME)}; got ${JSON.stringify(value)}.`, { field: 'name' });
  return value;
}

/**
 * Parse a SKILL.md document: a leading `---` frontmatter block with exactly the
 * two scalar keys `name` and `description`, then the body (opaque data).
 * Throws HARNESS_SKILL_INVALID for anything the tiny grammar does not allow.
 */
export function parseSkillDocument(text, { source = null } = {}) {
  const where = source ? ` (${source})` : '';
  if (typeof text !== 'string') throw invalid(`A skill document must be a string${where}.`);
  const normalized = text.replace(/\r\n?/gu, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') throw invalid(`A skill document must start with a "---" frontmatter line${where}.`);
  let closing = -1;
  for (let index = 1; index <= Math.min(lines.length - 1, MAX_FRONTMATTER_LINES); index += 1) {
    if (lines[index] === '---') {
      closing = index;
      break;
    }
  }
  if (closing < 0) throw invalid(`A skill document must close its frontmatter with a "---" line${where}.`);
  const frontmatter = lines.slice(1, closing);
  if (byteLength(frontmatter.join('\n')) > MAX_FRONTMATTER_BYTES)
    throw invalid(`Skill frontmatter must not exceed ${MAX_FRONTMATTER_BYTES} bytes${where}.`);
  const fields = new Map();
  for (const [offset, rawLine] of frontmatter.entries()) {
    const line = rawLine.trimEnd();
    if (line === '' || line.startsWith('#')) continue;
    if (/^\s/u.test(rawLine))
      throw invalid(`Frontmatter line ${offset + 2} must not be indented; nested YAML is not supported${where}.`);
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/u.exec(line);
    if (!match) throw invalid(`Unsupported frontmatter line ${offset + 2}: ${JSON.stringify(rawLine)}${where}.`);
    const key = match[1];
    if (key !== 'name' && key !== 'description')
      throw invalid(`Unsupported frontmatter key ${JSON.stringify(key)}; only name and description are allowed${where}.`);
    if (fields.has(key)) throw invalid(`Duplicate frontmatter key ${JSON.stringify(key)}${where}.`);
    let value = (match[2] ?? '').trim();
    if (!value) throw invalid(`Frontmatter.${key} must be a non-empty scalar${where}.`);
    if (UNSUPPORTED_SCALAR_FIRST.has(value[0]))
      throw invalid(`Frontmatter.${key} uses unsupported YAML syntax${where}; only plain scalars are allowed.`);
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))))
      value = value.slice(1, -1);
    fields.set(key, value);
  }
  const name = fields.get('name');
  if (name === undefined) throw invalid(`Frontmatter.name is required${where}.`);
  if (!SKILL_NAME.test(name))
    throw invalid(`Frontmatter.name ${JSON.stringify(name)} must match ${String(SKILL_NAME)}${where}.`, { field: 'name' });
  const description = fields.get('description');
  if (description === undefined) throw invalid(`Frontmatter.description is required${where}.`);
  if (description.length > MAX_DESCRIPTION_CHARS)
    throw invalid(`Frontmatter.description must not exceed ${MAX_DESCRIPTION_CHARS} characters${where}.`);
  return Object.freeze({ name, description, body: lines.slice(closing + 1).join('\n') });
}

/** Validate a registration payload into a frozen skill record. */
function validateSkillInput(payload, maxBytes) {
  if (!isPlain(payload)) throw invalid('skills.register requires a plain object { name, description, body, source, pluginId? }.');
  const name = validateName(payload.name);
  if (typeof payload.description !== 'string' || !payload.description.trim())
    throw invalid(`skill ${name}: description must be a non-empty string.`, { field: 'description' });
  if (payload.description.length > MAX_DESCRIPTION_CHARS)
    throw invalid(`skill ${name}: description must not exceed ${MAX_DESCRIPTION_CHARS} characters.`, { field: 'description' });
  if (/[\r\n]/u.test(payload.description))
    throw invalid(`skill ${name}: description must be a single line.`, { field: 'description' });
  if (typeof payload.body !== 'string') throw invalid(`skill ${name}: body must be a string.`, { field: 'body' });
  const bytes = byteLength(payload.body);
  if (bytes > maxBytes)
    throw new HarnessError(
      SKILL_ERROR.tooLarge,
      `skill ${name}: body is ${bytes} bytes, exceeding maxBytes (${maxBytes}).`,
      { skill: name, bytes, maxBytes },
    );
  if (typeof payload.source !== 'string' || !payload.source.trim())
    throw invalid(`skill ${name}: source must be a non-empty string.`, { field: 'source' });
  if (payload.source.length > MAX_SOURCE_CHARS)
    throw invalid(`skill ${name}: source must not exceed ${MAX_SOURCE_CHARS} characters.`, { field: 'source' });
  if (/[\r\n]/u.test(payload.source)) throw invalid(`skill ${name}: source must be a single line.`, { field: 'source' });
  let pluginId = null;
  if (payload.pluginId !== undefined && payload.pluginId !== null) {
    if (typeof payload.pluginId !== 'string' || !ID.test(payload.pluginId))
      throw invalid(`skill ${name}: pluginId must match ${String(ID)}.`, { field: 'pluginId' });
    pluginId = payload.pluginId;
  }
  return Object.freeze({ name, description: payload.description, body: payload.body, source: payload.source, pluginId, bytes });
}

const summary = record =>
  Object.freeze({
    name: record.name,
    description: record.description,
    source: record.source,
    pluginId: record.pluginId,
    bytes: record.bytes,
  });

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const wildcardMatcher = segment =>
  new RegExp(`^${segment.split('*').map(escapeRegExp).join('[^\\\\/]*')}$`, 'u');

async function lstatSafe(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

/**
 * Expand one root pattern (only `*` per path segment) to candidate skill
 * directories. Symbolic links anywhere on the walk are refused and reported.
 */
async function expandPattern(pattern, errors) {
  const parsed = path.parse(pattern);
  const segments = pattern.slice(parsed.root.length).split(path.sep).filter(segment => segment !== '');
  let currentPaths = [parsed.root];
  for (const segment of segments) {
    const wildcard = segment.includes('*');
    let matcher = null;
    if (wildcard) {
      if (segment.includes('**')) {
        errors.push({ source: displaySource(pattern), code: SKILL_ERROR.rootInvalid, message: 'Globstars (**) are not supported; use one * per path segment.' });
        return [];
      }
      matcher = wildcardMatcher(segment);
    }
    const next = [];
    for (const current of currentPaths) {
      if (wildcard) {
        let entries;
        try {
          entries = await fs.readdir(current, { withFileTypes: true });
        } catch (error) {
          if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR')
            errors.push({ source: displaySource(current), code: SKILL_ERROR.rootInvalid, message: `Cannot read scan directory: ${error?.message ?? error}` });
          continue;
        }
        entries.sort((left, right) => compareText(left.name, right.name));
        for (const entry of entries) {
          if (!matcher.test(entry.name)) continue;
          const joined = path.join(current, entry.name);
          let stats;
          try {
            stats = await lstatSafe(joined);
          } catch (error) {
            errors.push({ source: displaySource(joined), code: SKILL_ERROR.rootInvalid, message: `Cannot inspect path: ${error?.message ?? error}` });
            continue;
          }
          if (!stats) continue;
          if (stats.isSymbolicLink()) {
            errors.push({ source: displaySource(joined), code: SKILL_ERROR.rootInvalid, message: 'Symbolic links are refused by the skills scanner.' });
            continue;
          }
          if (stats.isDirectory()) next.push(joined);
        }
      } else {
        const joined = path.join(current, segment);
        let stats;
        try {
          stats = await lstatSafe(joined);
        } catch (error) {
          errors.push({ source: displaySource(joined), code: SKILL_ERROR.rootInvalid, message: `Cannot inspect path: ${error?.message ?? error}` });
          continue;
        }
        if (!stats) continue;
        if (stats.isSymbolicLink()) {
          errors.push({ source: displaySource(joined), code: SKILL_ERROR.rootInvalid, message: 'Symbolic links are refused by the skills scanner.' });
          continue;
        }
        if (stats.isDirectory()) next.push(joined);
      }
    }
    currentPaths = next;
    if (!currentPaths.length) break;
  }
  return currentPaths;
}

/** Read at most one SKILL.md below `directory`; never follows links. */
async function readSkillDirectory(directory, maxBytes) {
  const file = path.join(directory, SKILL_FILE);
  const source = displaySource(file);
  let stats;
  try {
    stats = await fs.lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null; // not a skill directory
    return { error: { source, code: SKILL_ERROR.invalid, message: `Cannot stat ${source}: ${error?.message ?? error}` } };
  }
  if (stats.isSymbolicLink()) return { error: { source, code: SKILL_ERROR.rootInvalid, message: `Refusing symbolic link ${source}.` } };
  if (!stats.isFile()) return null;
  if (stats.size > maxBytes + MAX_FRONTMATTER_BYTES)
    return {
      error: {
        source,
        code: SKILL_ERROR.tooLarge,
        message: `File ${source} is ${stats.size} bytes, exceeding maxBytes (${maxBytes}) plus the frontmatter allowance.`,
      },
    };
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    return { error: { source, code: SKILL_ERROR.invalid, message: `Cannot read ${source}: ${error?.message ?? error}` } };
  }
  let parsed;
  try {
    parsed = parseSkillDocument(text, { source });
  } catch (error) {
    if (error instanceof HarnessError) return { error: { source, code: error.code, message: error.message } };
    throw error;
  }
  const bytes = byteLength(parsed.body);
  if (bytes > maxBytes)
    return {
      error: {
        source,
        code: SKILL_ERROR.tooLarge,
        message: `Skill ${source} body is ${bytes} bytes, exceeding maxBytes (${maxBytes}).`,
      },
    };
  return {
    record: Object.freeze({
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      source,
      pluginId: pluginIdFor(directory),
      bytes,
    }),
  };
}

/** Validate + resolve configured roots; relative roots must stay inside `root`. */
function normalizeRoots(roots, root) {
  if (!Array.isArray(roots)) throw rootInvalid('skills.roots must be an array of path patterns.');
  const requested = roots.length ? roots : DEFAULT_ROOTS;
  const patterns = [];
  const seen = new Set();
  for (const entry of requested) {
    if (typeof entry !== 'string' || !entry.trim())
      throw rootInvalid(`skills.roots entries must be non-empty strings; got ${JSON.stringify(entry)}.`);
    if (entry.includes('**')) throw rootInvalid(`Globstars are not supported in scan root ${JSON.stringify(entry)}; use one * per path segment.`);
    const resolved = path.resolve(root, entry);
    if (!path.isAbsolute(entry) && !isInside(root, resolved))
      throw rootInvalid(`Relative scan root ${JSON.stringify(entry)} must stay inside ${root}.`);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    patterns.push(resolved);
  }
  return Object.freeze(patterns);
}

/**
 * Construct the skills service directly (tests/embedders). No I/O happens here;
 * `scan()` is the only method that touches the filesystem, and only below the
 * configured roots.
 *
 * @param {{roots?: string[], maxSkills?: number, maxBytes?: number, root?: string}} [options]
 */
export function createSkills({ roots = [], maxSkills = DEFAULT_MAX_SKILLS, maxBytes = DEFAULT_MAX_BYTES, root = REPO_ROOT } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    throw rootInvalid(`skills.root must be an absolute directory path; got ${JSON.stringify(root)}.`);
  const rootDirectory = path.resolve(root);
  if (!Number.isSafeInteger(maxSkills) || maxSkills <= 0)
    throw invalid(`skills.maxSkills must be a positive integer; got ${JSON.stringify(maxSkills)}.`);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw invalid(`skills.maxBytes must be a positive integer; got ${JSON.stringify(maxBytes)}.`);
  const patterns = normalizeRoots(roots, rootDirectory);
  const registry = new Map();
  let closed = false;

  function assertOpen() {
    if (closed) throw new HarnessError(SKILL_ERROR.closed, 'The skills service is closed.');
  }

  function register(payload) {
    assertOpen();
    const record = validateSkillInput(payload, maxBytes);
    const existing = registry.get(record.name);
    if (existing)
      throw new HarnessError(
        SKILL_ERROR.duplicate,
        `Skill ${JSON.stringify(record.name)} is already registered from ${existing.source}.`,
        { skill: record.name, source: record.source, registeredFrom: existing.source },
      );
    if (registry.size >= maxSkills)
      throw new HarnessError(SKILL_ERROR.limit, `Skill registry is full (maxSkills ${maxSkills}).`, { maxSkills });
    registry.set(record.name, record);
    return record;
  }

  function list(options = {}) {
    assertOpen();
    const settings = options ?? {};
    if (!isPlain(settings)) throw invalid('skills.list options must be a plain object.');
    const pluginId = settings.pluginId;
    if (pluginId !== undefined && pluginId !== null && (typeof pluginId !== 'string' || !ID.test(pluginId)))
      throw invalid(`skills.list pluginId must match ${String(ID)}; got ${JSON.stringify(pluginId)}.`);
    let limit = settings.limit === undefined ? maxSkills : settings.limit;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw invalid(`skills.list limit must be a positive integer; got ${JSON.stringify(settings.limit)}.`);
    limit = Math.min(limit, maxSkills);
    return [...registry.values()]
      .filter(record => pluginId === undefined || pluginId === null || record.pluginId === pluginId)
      .sort((left, right) => compareText(left.name, right.name))
      .slice(0, limit)
      .map(summary);
  }

  function load(name) {
    assertOpen();
    const key = validateName(name);
    const record = registry.get(key);
    if (!record)
      throw new HarnessError(SKILL_ERROR.notFound, `Unknown skill ${JSON.stringify(key)}.`, { skill: key });
    // Exactly the frozen four fields; pluginId/bytes stay internal to list().
    return Object.freeze({ name: record.name, description: record.description, body: record.body, source: record.source });
  }

  function remove(name) {
    assertOpen();
    const key = validateName(name);
    if (!registry.has(key)) throw new HarnessError(SKILL_ERROR.notFound, `Unknown skill ${JSON.stringify(key)}.`, { skill: key });
    registry.delete(key);
    return true;
  }

  async function scan() {
    assertOpen();
    const discovered = new Map();
    const errors = [];
    for (const pattern of patterns) {
      let directories;
      try {
        directories = await expandPattern(pattern, errors);
      } catch (error) {
        errors.push({ source: displaySource(pattern), code: SKILL_ERROR.rootInvalid, message: `Cannot expand scan root: ${error?.message ?? error}` });
        continue;
      }
      for (const directory of directories) {
        const outcome = await readSkillDirectory(directory, maxBytes);
        if (!outcome) continue;
        if (outcome.error) {
          errors.push(outcome.error);
          continue;
        }
        const record = outcome.record;
        const existing = registry.get(record.name);
        if (existing && existing.source !== record.source) {
          errors.push({
            source: record.source,
            code: SKILL_ERROR.duplicate,
            message: `Skill ${JSON.stringify(record.name)} is already registered from ${existing.source}; refusing ${record.source}.`,
          });
          continue;
        }
        if (!existing && registry.size >= maxSkills) {
          errors.push({
            source: record.source,
            code: SKILL_ERROR.limit,
            message: `Skill registry is full (maxSkills ${maxSkills}); refusing ${record.source}.`,
          });
          continue;
        }
        // A rescan of the same source refreshes the record in place (idempotent).
        registry.set(record.name, record);
        discovered.set(record.name, summary(record));
      }
    }
    return {
      skills: [...discovered.values()].sort((left, right) => compareText(left.name, right.name)),
      errors: errors.sort((left, right) => compareText(left.source, right.source) || compareText(left.code, right.code)),
    };
  }

  function close() {
    if (closed) return;
    closed = true;
    registry.clear();
  }

  // `roots` is exposed read-only for diagnostics (it never grants extra I/O:
  // scan uses the same frozen pattern list).
  return Object.freeze({ register, list, load, scan, remove, close, roots: patterns });
}

/**
 * Mountable provider: `createSkillsProvider({ roots, maxSkills, maxBytes }).apply(ctx)`.
 * Publishes `ctx.skills` (Cordis `ctx.provide`) and returns a disposer that
 * closes the service.
 */
export function createSkillsProvider(options = {}) {
  let service;
  let registration;
  let disposer;
  let scanned = false;
  const apply = async (ctx, config = {}) => {
    if (!ctx || typeof ctx !== 'object') throw new TypeError('The skills provider requires a kernel context object.');
    const setting = key => (options[key] !== undefined ? options[key] : config?.[key]);
    if (!registration) {
      const existing = serviceFromContext(ctx, SERVICE.skills);
      if (existing !== undefined && existing !== service)
        throw new HarnessError(ERROR.pluginDuplicate, 'ctx.skills is already registered by another provider.', { service: SERVICE.skills });
    }
    if (!service) {
      service = createSkills({
        roots: setting('roots'),
        maxSkills: setting('maxSkills'),
        maxBytes: setting('maxBytes'),
        root: setting('root'),
      });
    }
    if (!registration) registration = provideService(ctx, SERVICE.skills, service);
    // Discovery stays opt-in: a composition that wants boot-time discovery says
    // `config.scanOnMount: true`. Malformed skills are recorded by scan(), not thrown.
    if (setting('scanOnMount') === true && !scanned) {
      scanned = true;
      await service.scan();
    }
    if (!disposer) {
      let disposed = false;
      disposer = async () => {
        if (disposed) return;
        disposed = true;
        try {
          if (registration) await registration.dispose();
        } finally {
          service.close();
        }
      };
    }
    return disposer;
  };
  return { apply };
}

// Fallback for loaders that import the module instead of calling the factory.
const providers = new WeakMap();
export async function apply(ctx, config = {}) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('The skills provider requires a kernel context object.');
  let provider = providers.get(ctx);
  if (!provider) {
    provider = createSkillsProvider(config ?? {});
    providers.set(ctx, provider);
  }
  return provider.apply(ctx, config);
}

export default {
  createSkills,
  createSkillsProvider,
  parseSkillDocument,
  apply,
  manifest,
  SKILL_ERROR,
  DEFAULT_ROOTS,
  DEFAULT_MAX_SKILLS,
  DEFAULT_MAX_BYTES,
  REPO_ROOT,
};
