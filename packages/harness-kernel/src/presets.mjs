// Agent presets: a capability profile (persona + plugin rows + tools/skills) over a
// base composition. Presets never grant authority by themselves; they only select
// what the base composition already provides.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { HarnessError, ERROR, validateComposition, validateRow } from '../../harness-contracts/src/index.mjs';
import { readComposition } from './resolve.mjs';

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const IDENT = /^[a-z][a-z0-9_.-]{0,63}$/u;
const MAX_PRESET_BYTES = 32 * 1024;
const MAX_PERSONA = 8000;
const MAX_SELECTION = 64;
export const PRESET_DIRECTORY = 'presets';

const fail = (message) => { throw new HarnessError(ERROR.compositionInvalid, message); };
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const bounded = (value, label, maximum) => {
  if (typeof value !== 'string' || !value.trim() || [...value].length > maximum) fail(`${label} must be non-empty text of at most ${maximum} characters.`);
  return value.trim();
};

const selection = (value, label) => {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_SELECTION) fail(`${label} must be an array of at most ${MAX_SELECTION} names.`);
  const names = value.map(name => {
    if (typeof name !== 'string' || !IDENT.test(name)) fail(`${label} entries must be bounded identifiers.`);
    return name;
  });
  if (new Set(names).size !== names.length) fail(`${label} contains duplicates.`);
  return Object.freeze(names);
};

export function validatePreset(document, { file = null } = {}) {
  if (!isPlain(document)) fail('A preset must be a plain object.');
  if (document.version !== 1) fail('preset.version must be 1.');
  if (typeof document.name !== 'string' || !NAME.test(document.name)) fail('preset.name must be a kebab-case identifier.');
  const title = bounded(document.title, 'preset.title', 120);
  const persona = bounded(document.persona, 'preset.persona', MAX_PERSONA);
  const tools = selection(document.tools, 'preset.tools');
  const denyTools = selection(document.denyTools, 'preset.denyTools');
  const skills = selection(document.skills, 'preset.skills');
  for (const name of tools) if (denyTools.includes(name)) fail(`tool ${name} is both allowed and denied.`);
  const rows = document.plugins === undefined ? [] : document.plugins;
  if (!Array.isArray(rows) || rows.length > 32) fail('preset.plugins must be an array of at most 32 rows.');
  const validated = rows.map((row, index) => validateRow(row, index));
  if (new Set(validated.map(row => row.id)).size !== validated.length) fail('preset.plugins contains duplicate row ids.');
  let model = null;
  if (document.model !== undefined) {
    if (!isPlain(document.model)) fail('preset.model must be an object.');
    model = Object.freeze({
      provider: document.model.provider === undefined ? null : bounded(document.model.provider, 'preset.model.provider', 64),
      model: document.model.model === undefined ? null : bounded(document.model.model, 'preset.model.model', 120),
    });
    if (model.provider !== null && !IDENT.test(model.provider)) fail('preset.model.provider must be a bounded identifier.');
  }
  let extendsPath = null;
  if (document.extends !== undefined) {
    if (typeof document.extends !== 'string' || !document.extends.trim() || document.extends.length > 300) fail('preset.extends must be a path.');
    if (isAbsolute(document.extends)) fail('preset.extends must be relative to the preset file.');
    extendsPath = document.extends;
  }
  return Object.freeze({
    version: 1, name: document.name, title, persona, tools, denyTools, skills, plugins: Object.freeze(validated),
    model, extends: extendsPath, file,
  });
}

function resolvePresetPath(nameOrPath, root) {
  if (typeof nameOrPath !== 'string' || !nameOrPath.trim()) fail('A preset name or path is required.');
  if (nameOrPath.endsWith('.yml') || nameOrPath.endsWith('.yaml') || nameOrPath.startsWith('.')) {
    return isAbsolute(nameOrPath) ? nameOrPath : resolvePath(root, nameOrPath);
  }
  if (!NAME.test(nameOrPath)) fail(`Preset name ${JSON.stringify(nameOrPath)} must be kebab-case.`);
  return join(root, PRESET_DIRECTORY, `${nameOrPath}.yml`);
}

export async function loadPreset(nameOrPath, { root = process.cwd() } = {}) {
  const file = resolvePresetPath(nameOrPath, root);
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch { throw new HarnessError(ERROR.compositionInvalid, `preset not found: ${file}`); }
  if (Buffer.byteLength(raw, 'utf8') > MAX_PRESET_BYTES) fail(`preset ${file} exceeds ${MAX_PRESET_BYTES} bytes.`);
  let document;
  try { document = parseYaml(raw); }
  catch (error) { throw new HarnessError(ERROR.compositionInvalid, `preset ${file} is not valid YAML: ${error?.message ?? error}`); }
  if (!isPlain(document)) fail(`preset ${file} must contain a YAML mapping.`);
  return validatePreset(document, { file });
}

export async function listPresets({ root = process.cwd() } = {}) {
  const directory = join(root, PRESET_DIRECTORY);
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  const presets = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) continue;
    const preset = await loadPreset(join(directory, entry.name), { root });
    presets.push(preset);
  }
  return presets.sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

/** Compose the preset over its base composition; the preset's rows override by id. */
export async function composePreset(preset, { root = process.cwd() } = {}) {
  if (!preset || !preset.name) fail('composePreset requires a validated preset.');
  let base = { version: 1, name: preset.name, server: { host: '127.0.0.1', port: 8791 }, rows: [] };
  if (preset.extends) {
    const basePath = resolvePath(dirname(preset.file ?? join(root, 'presets', 'x.yml')), preset.extends);
    const loaded = await readComposition(basePath, { root });
    base = loaded.composition;
  }
  const rows = new Map();
  for (const row of base.rows) rows.set(row.id, { id: row.id, name: row.name, config: row.config, ...(row.disabled ? { disabled: true } : {}) });
  for (const row of preset.plugins) rows.set(row.id, { id: row.id, name: row.name, config: row.config, ...(row.disabled ? { disabled: true } : {}) });
  // Enforce the preset's tool selection through the tools provider config, so a
  // mounted preset cannot call a tool it did not declare.
  const toolsRow = rows.get('tools');
  if (toolsRow && (preset.tools.length || preset.denyTools.length)) {
    rows.set('tools', {
      ...toolsRow,
      config: {
        ...(toolsRow.config ?? {}),
        ...(preset.tools.length ? { allowedTools: [...preset.tools] } : {}),
        ...(preset.denyTools.length ? { deniedTools: [...preset.denyTools] } : {}),
      },
    });
  }
  const document = { version: 1, name: preset.name, server: base.server, plugins: [...rows.values()] };
  const composition = validateComposition(document);
  return Object.freeze({
    composition,
    // The raw document (plugins array) so `createHarness({ composition })` can
    // validate and mount it directly.
    document,
    preset,
    persona: preset.persona,
    tools: preset.tools,
    denyTools: preset.denyTools,
    skills: preset.skills,
    model: preset.model,
  });
}

export function presetSummary(preset) {
  return {
    name: preset.name,
    title: preset.title,
    file: preset.file,
    extends: preset.extends,
    plugins: preset.plugins.map(row => row.id),
    tools: [...preset.tools],
    denyTools: [...preset.denyTools],
    skills: [...preset.skills],
    model: preset.model,
    persona: preset.persona,
  };
}
