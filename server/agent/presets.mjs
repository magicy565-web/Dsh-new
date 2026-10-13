import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PRESET_DIRECTORY = fileURLToPath(new URL('../../presets/agent/', import.meta.url));
export const DEMO_NOTICE = '演示模式：未接模型与真实数据源，内容为结构模板，数字为待确认';
export const RESEARCH_NOTICE = '数据范围：用户提供的输入与材料；本服务未连接外部检索源，材料未经独立核验。平台展示价不是成交价，关键数字仍需交叉核验。';
export const ACTION_NOTICE = '本服务仅提供研究、整理与文书产物。代发询价、联系供应商、下单、付款及对外承诺数量或价格等动作，均需用户确认后执行；本服务不执行这些动作。合规内容仅为风险提示，不作法律结论。';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_INPUT_BYTES = 256 * 1024;

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function acceptsType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

// Deliberately small, documented JSON-schema subset; no executable preset expressions.
function matchesInputSchema(value, schema) {
  if (!schema || typeof schema !== 'object') return true;
  if (schema.anyOf && !schema.anyOf.some(option => matchesInputSchema(value, option))) return false;
  if (schema.type && ![schema.type].flat().some(type => acceptsType(value, type))) return false;
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return false;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return false;
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && value.some(item => !matchesInputSchema(item, schema.items))) return false;
  }
  if (schema['x-positiveQuantity']) {
    const amount = typeof value === 'number' ? value : Number(String(value).trim().match(/^[+]?([\d,.]+)/u)?.[1]?.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return false;
  }
  return true;
}

function validatePreset(preset, file) {
  const fail = message => { throw new Error(`Invalid agent preset ${file}: ${message}`); };
  if (!preset || typeof preset !== 'object' || Array.isArray(preset)) fail('must be an object');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(preset.id || '')) fail('invalid id');
  for (const field of ['name', 'description', 'system_prompt', 'summary_template']) {
    if (!nonempty(preset[field])) fail(`${field} must be a nonempty string`);
  }
  for (const field of ['required_inputs', 'optional_inputs', 'deliverables']) {
    if (!Array.isArray(preset[field]) || preset[field].some(value => !nonempty(value))) fail(`${field} must be a string array`);
  }
  const inputs = [...preset.required_inputs, ...preset.optional_inputs];
  if (inputs.some(key => FORBIDDEN_KEYS.has(key) || !/^[a-z][a-z0-9_]*$/.test(key)) || new Set(inputs).size !== inputs.length) fail('invalid or duplicate input keys');
  if (!Array.isArray(preset.stages) || preset.stages.length === 0 || preset.stages.length > 20) fail('stages must contain 1–20 entries');
  const stageKeys = new Set();
  for (const stage of preset.stages) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(stage.key || '') || stageKeys.has(stage.key)) fail('invalid or duplicate stage key');
    stageKeys.add(stage.key);
    for (const field of ['title', 'prompt', 'output_template']) if (!nonempty(stage[field])) fail(`stage.${field} is required`);
    if (!Array.isArray(stage.thinking) || stage.thinking.length < 2 || stage.thinking.length > 4 || stage.thinking.some(text => !nonempty(text))) fail('each stage needs 2–4 operation summaries');
  }
  if (!Array.isArray(preset.artifacts) || !preset.artifacts.length || preset.artifacts.length > 20) fail('artifacts must contain 1–20 entries');
  const names = new Set();
  for (const artifact of preset.artifacts) {
    if (!/^[a-z0-9][a-z0-9.-]{0,126}\.(?:md|txt)$/.test(artifact.name || '') || names.has(artifact.name)) fail('invalid or duplicate artifact filename');
    names.add(artifact.name);
    if (!['md', 'markdown', 'txt', 'text'].includes(artifact.format)) fail('unsupported artifact format');
    if (!Array.isArray(artifact.stages) || artifact.stages.length === 0 || artifact.stages.some(key => !stageKeys.has(key))) fail('artifact references an unknown stage');
  }
  for (const [key, table] of Object.entries(preset.evidence_tables || {})) {
    if (FORBIDDEN_KEYS.has(key) || !/^[a-z][a-z0-9_]*$/.test(key) || !nonempty(table.input)) fail('invalid evidence table');
    if (!Array.isArray(table.columns) || !table.columns.length) fail('table columns are required');
    for (const column of table.columns) {
      if (!nonempty(column.key) || FORBIDDEN_KEYS.has(column.key) || !nonempty(column.label)) fail('invalid table column');
      if (column.aliases && (!Array.isArray(column.aliases) || column.aliases.some(alias => !nonempty(alias) || FORBIDDEN_KEYS.has(alias)))) fail('invalid column aliases');
    }
  }
  return freeze(preset);
}

/** Presets are loaded once on process startup. Operators restart after JSON edits. */
export function loadPresets(options = {}) {
  const directory = typeof options === 'string' ? options : options.directory || DEFAULT_PRESET_DIRECTORY;
  const registry = new Map();
  for (const filename of readdirSync(directory).filter(name => name.endsWith('.json')).sort()) {
    const text = readFileSync(resolve(directory, filename), 'utf8');
    const preset = validatePreset(JSON.parse(text), filename);
    if (registry.has(preset.id)) throw new Error(`Duplicate agent preset: ${preset.id}`);
    registry.set(preset.id, preset);
  }
  if (!registry.size) throw new Error('No agent presets configured');
  return registry;
}

let defaultRegistry;
function defaultPresets() { return defaultRegistry ??= loadPresets(); }

export function getPreset(id, registry = defaultPresets()) {
  return registry.get(id);
}

export function listPresets(registry = defaultPresets()) {
  return [...registry.values()].map(preset => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    required_inputs: [...preset.required_inputs],
    optional_inputs: [...preset.optional_inputs],
    deliverables: [...preset.deliverables],
  }));
}

/** Clone untrusted JSON, keeping the request separate from the persisted snapshot. */
export function validateTaskInput(preset, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw inputError('input 必须是字段对象');
  let serialized;
  try { serialized = JSON.stringify(input); } catch { throw inputError('input 必须是 JSON 对象'); }
  if (Buffer.byteLength(serialized) > MAX_INPUT_BYTES) throw inputError('input 超过允许大小');
  function validateTree(value, depth = 0) {
    if (depth > 8) throw inputError('input 嵌套层级过深');
    if (typeof value === 'number' && !Number.isFinite(value)) throw inputError('input 不能含非有限数字');
    if (value && typeof value === 'object') {
      if (Array.isArray(value) && value.length > 100) throw inputError('input 单个列表最多 100 项');
      for (const [key, item] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) throw inputError('input 含不允许的字段');
        validateTree(item, depth + 1);
      }
    }
  }
  validateTree(input);
  for (const key of preset.required_inputs) {
    const value = input[key];
    if (!Object.hasOwn(input, key) || value === null || !['string', 'number'].includes(typeof value) || !String(value).trim()) throw inputError(`缺少必填输入：${key}`);
  }
  for (const [key, schema] of Object.entries(preset.input_schema?.properties || {})) {
    if (Object.hasOwn(input, key) && !matchesInputSchema(input[key], schema)) throw inputError(`${key} 的类型或格式无效${schema.description ? `：${schema.description}` : ''}`);
  }
  return JSON.parse(serialized);
}

export function readPath(object, path) {
  let value = object;
  for (const key of path.split('.')) {
    if (FORBIDDEN_KEYS.has(key) || value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

export function escapeMarkdown(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_\[\]])/g, '\\$1').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function display(value) {
  if (value === undefined || value === null || value === '') return '待确认';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Only dotted value interpolation is supported; never evaluate template code. */
export function renderTemplate(template, context) {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, path) => {
    const value = readPath(context, path);
    if (path.startsWith('input.') || path.startsWith('task.')) return escapeMarkdown(display(value));
    return value === undefined || value === null ? '待确认' : String(value);
  });
}

/** Evidence IDs point only to submitted values. They do not claim independent verification. */
export function collectInputEvidence(input) {
  const evidence = [];
  function visit(value, path, depth) {
    if (depth > 8 || evidence.length >= 1000 || value === undefined || value === null) return;
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) if (!FORBIDDEN_KEYS.has(key)) visit(item, `${path}.${key}`, depth + 1);
    } else if (String(value).trim()) {
      evidence.push({ id: path, value: String(value), provenance: 'user_provided_unverified' });
    }
  }
  visit(input, 'input', 0);
  return evidence;
}

function extractCell(row, column) {
  if (column.constant !== undefined) return String(column.constant);
  for (const key of [column.key, ...(column.aliases || [])]) {
    if (Object.hasOwn(row, key) && row[key] !== undefined && row[key] !== null && row[key] !== '') return display(row[key]);
  }
  return column.missing || '待回收';
}

/** Tables use submitted values, never model-supplied supplier/price/URL fields. */
export function buildEvidenceTables(preset, input) {
  const tables = Object.create(null);
  for (const [key, definition] of Object.entries(preset.evidence_tables || {})) {
    const value = readPath(input, definition.input);
    const columns = definition.columns;
    const rows = Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : value && typeof value === 'object' ? [value] : [];
    const rawTexts = Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : typeof value === 'string' && value.trim() ? [value] : [];
    const header = `| ${columns.map(column => escapeMarkdown(column.label)).join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |`;
    const rendered = rows.length
      ? rows.map(row => `| ${columns.map(column => escapeMarkdown(extractCell(row, column))).join(' | ')} |`)
      : [`| ${columns.map((column, index) => escapeMarkdown(index === 0 ? definition.empty_label || '待回收' : column.constant || column.missing || '待回收')).join(' | ')} |`];
    const notes = [];
    if (!rows.length) notes.push(definition.empty_note || '尚未收到可逐项核对的结构化材料；表格为空缺清单，不代表存在这些供应商或报价。');
    for (const [index, rawText] of rawTexts.entries()) notes.push(`用户提供的原文 ${index + 1}（尚未结构化、未独立核验）：\n\n> ${escapeMarkdown(rawText)}`);
    for (const columnKey of definition.comparison_keys || []) {
      const column = columns.find(item => item.key === columnKey);
      if (!column || rows.length < 2) continue;
      const entries = rows.map(row => extractCell(row, column));
      const known = entries.filter(entry => !['待回收', '待确认', column.missing].includes(entry));
      if (new Set(known.map(entry => entry.trim().toUpperCase())).size > 1) notes.push(`口径不一致：${column.label}存在不同值，只并列呈现，不进行汇率、税费、运费或规格折算。`);
    }
    if (rows.length) notes.push('以上逐项保留用户材料的原文；来源链接尚未访问或核验。空缺项不补造，用户目标价不作为供应商报价。');
    tables[key] = `${header}\n${rendered.join('\n')}\n\n${notes.join('\n\n')}`;
  }
  return tables;
}

export function buildInputTable(preset, input) {
  const keys = [...preset.required_inputs, ...preset.optional_inputs].filter(key => key !== 'quotes' && key !== 'candidates' && key !== 'evidence');
  return `| 条件 | 用户输入 / 待确认项 |\n| --- | --- |\n${keys.map(key => `| ${escapeMarkdown(preset.input_labels?.[key] || key)} | ${escapeMarkdown(display(input[key]))} |`).join('\n')}`;
}
