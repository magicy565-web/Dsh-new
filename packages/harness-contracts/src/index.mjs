// Shared contracts for the Workspace Harness. Pure data + validators, no I/O.
// Every kernel, seam and business plugin imports these names so the composition
// layer, the CLI and the tests agree on one vocabulary.

export const HARNESS_VERSION = 1;

/**
 * Deployment-review vocabulary shared by `wh review`, the review snapshot plugin and
 * the client console. Values are stable wire strings; never compare against a
 * hand-written literal in another module.
 */
export const REVIEW_VERDICT = Object.freeze({ ready: 'ready', blocked: 'blocked' });

export const REVIEW_BLOCKER = Object.freeze({
  unresolvedRow: 'unresolved-row',   // a composition row could not be resolved
  unmetRequires: 'unmet-requires',   // a plugin requires a service nobody provides
  serviceConflict: 'service-conflict', // two enabled plugins provide the same service
  installDrift: 'install-drift',     // installed content differs from the journal digest
  installMissing: 'install-missing', // the journal says installed but the directory is gone
});

export const REVIEW_STATE = Object.freeze({
  ok: 'ok', missing: 'missing', invalid: 'invalid', stale: 'stale', unavailable: 'unavailable',
});


/** Abstract service keys exposed on ctx. Business plugins depend on these, never on concrete modules. */
export const SERVICE = Object.freeze({
  storage: 'storage',      // durable workspace state (provider: local store adapter)
  artifacts: 'artifacts',  // immutable versioned artifacts + provenance (provider: artifact adapter)
  tools: 'tools',          // model-facing tool registry + execution pipeline
  approval: 'approval',    // one-shot human approval decisions, fail-closed
  skills: 'skills',        // agent skill provider registry
  llm: 'llm',              // provider-neutral model seam (pi/OMP or DeepSeek API)
  workspace: 'workspace',  // enterprise/workspace identity and member scopes
  inquiries: 'inquiries',  // historical inquiry recovery domain service
  audit: 'audit',          // durable metadata-only audit stream (patch, tool, business events)
  health: 'health',        // plugin health aggregation
});

export const PLUGIN_KINDS = Object.freeze(['plugin', 'provider', 'bundle']);

export const ERROR = Object.freeze({
  manifestInvalid: 'HARNESS_MANIFEST_INVALID',
  compositionInvalid: 'HARNESS_COMPOSITION_INVALID',
  pluginDuplicate: 'HARNESS_PLUGIN_DUPLICATE',
  pluginMissingDependency: 'HARNESS_PLUGIN_MISSING_DEPENDENCY',
  pluginFailed: 'HARNESS_PLUGIN_FAILED',
  toolInvalid: 'HARNESS_TOOL_INVALID',
  toolDuplicate: 'HARNESS_TOOL_DUPLICATE',
  toolRefused: 'HARNESS_TOOL_REFUSED',
  approvalRequired: 'HARNESS_APPROVAL_REQUIRED',
  approvalRefused: 'HARNESS_APPROVAL_REFUSED',
  storageInvalid: 'HARNESS_STORAGE_INVALID',
  skillInvalid: 'HARNESS_SKILL_INVALID',
  skillDuplicate: 'HARNESS_SKILL_DUPLICATE',
  skillNotFound: 'HARNESS_SKILL_NOT_FOUND',
  llmInvalid: 'HARNESS_LLM_INVALID',
  llmDuplicate: 'HARNESS_LLM_DUPLICATE',
  llmProviderRequired: 'HARNESS_LLM_PROVIDER_REQUIRED',
  llmNotConfigured: 'HARNESS_LLM_NOT_CONFIGURED',
  llmFailed: 'HARNESS_LLM_FAILED',
  llmAborted: 'HARNESS_LLM_ABORTED',
  llmExhausted: 'HARNESS_LLM_EXHAUSTED',
  workspaceInvalid: 'HARNESS_WORKSPACE_INVALID',
  workspaceForbidden: 'HARNESS_WORKSPACE_FORBIDDEN',
  reviewUnavailable: 'HARNESS_REVIEW_UNAVAILABLE',
  reviewBlocked: 'HARNESS_REVIEW_BLOCKED',
});

export class HarnessError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,127}$/u;
const MAX_ENV_READS = 16;
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function assertId(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new HarnessError(ERROR.manifestInvalid, `${label} must match ${ID}.`);
  return value;
}

/** A plugin manifest is the unit the composition layer and the CLI reason about. */
export function validateManifest(manifest) {
  if (!isPlain(manifest)) throw new HarnessError(ERROR.manifestInvalid, 'A plugin manifest must be a plain object.');
  assertId(manifest.id, 'manifest.id');
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version))
    throw new HarnessError(ERROR.manifestInvalid, 'manifest.version must be semver.');
  if (!PLUGIN_KINDS.includes(manifest.kind)) throw new HarnessError(ERROR.manifestInvalid, `manifest.kind must be one of ${PLUGIN_KINDS.join('/')}.`);
  for (const key of ['requires', 'provides']) {
    const list = manifest[key] ?? [];
    if (!Array.isArray(list) || list.some(item => typeof item !== 'string' || !item))
      throw new HarnessError(ERROR.manifestInvalid, `manifest.${key} must be an array of service names.`);
  }
  if (manifest.kind === 'provider' && !(manifest.provides ?? []).length)
    throw new HarnessError(ERROR.manifestInvalid, 'A provider manifest must declare what it provides.');
  if (manifest.configSchema !== undefined && !isPlain(manifest.configSchema))
    throw new HarnessError(ERROR.manifestInvalid, 'manifest.configSchema must be a JSON Schema object.');
  const entry = manifest.entry;
  if (typeof entry !== 'string' || !entry.trim())
    throw new HarnessError(ERROR.manifestInvalid, 'manifest.entry must name the module to import.');
  for (const list of ['routes', 'tools', 'skills', 'slots']) {
    if (manifest[list] !== undefined && (!Array.isArray(manifest[list]) || manifest[list].some(item => typeof item !== 'string')))
      throw new HarnessError(ERROR.manifestInvalid, `manifest.${list} must be an array of names.`);
  }
  // `env` declares the environment variables the plugin is allowed to read. It is
  // a capability declaration, never a value store; the CLI surfaces it read-only.
  if (manifest.env !== undefined) {
    if (!Array.isArray(manifest.env) || manifest.env.length > MAX_ENV_READS || manifest.env.some(name => typeof name !== 'string' || !ENV_NAME.test(name)))
      throw new HarnessError(ERROR.manifestInvalid, `manifest.env must be an array of at most ${MAX_ENV_READS} upper-case environment variable names.`);
    if (new Set(manifest.env).size !== manifest.env.length)
      throw new HarnessError(ERROR.manifestInvalid, 'manifest.env must not repeat a variable.');
  }
  return Object.freeze({
    id: manifest.id, version: manifest.version, kind: manifest.kind, entry: manifest.entry,
    requires: Object.freeze([...(manifest.requires ?? [])]), provides: Object.freeze([...(manifest.provides ?? [])]),
    routes: Object.freeze([...(manifest.routes ?? [])]), tools: Object.freeze([...(manifest.tools ?? [])]),
    skills: Object.freeze([...(manifest.skills ?? [])]), slots: Object.freeze([...(manifest.slots ?? [])]),
    env: Object.freeze([...(manifest.env ?? [])]),
    configSchema: manifest.configSchema ?? null, description: manifest.description ?? '',
  });
}

/** validateConfig performs the small JSON-Schema subset we allow manifests to use. */
export function validateConfig(schema, value, label = 'config') {
  if (!schema) return value ?? {};
  const result = value ?? {};
  if (!isPlain(result)) throw new HarnessError(ERROR.manifestInvalid, `${label} must be a plain object.`);
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? [])
    if (!Object.hasOwn(result, key)) throw new HarnessError(ERROR.manifestInvalid, `${label}.${key} is required.`);
  for (const [key, item] of Object.entries(result)) {
    const rule = properties[key];
    if (!rule) {
      if (schema.additionalProperties === false) throw new HarnessError(ERROR.manifestInvalid, `${label}.${key} is not allowed.`);
      continue;
    }
    if (rule.type === 'string' && typeof item !== 'string') throw new HarnessError(ERROR.manifestInvalid, `${label}.${key} must be a string.`);
    if (rule.type === 'number' && (typeof item !== 'number' || !Number.isFinite(item))) throw new HarnessError(ERROR.manifestInvalid, `${label}.${key} must be a number.`);
    if (rule.type === 'boolean' && typeof item !== 'boolean') throw new HarnessError(ERROR.manifestInvalid, `${label}.${key} must be a boolean.`);
    if (rule.type === 'integer' && !Number.isSafeInteger(item)) throw new HarnessError(ERROR.manifestInvalid, `${label}.${key} must be an integer.`);
    if (Array.isArray(rule.enum) && !rule.enum.includes(item)) throw new HarnessError(ERROR.manifestInvalid, `${label}.${key} must be one of ${rule.enum.join('/')}.`);
  }
  return result;
}

/** A composition row is one mounted plugin instance. */
export function validateRow(row, index = 0) {
  if (!isPlain(row)) throw new HarnessError(ERROR.compositionInvalid, `row ${index} must be an object.`);
  assertId(row.id, `row ${index}.id`);
  if (typeof row.name !== 'string' || !row.name.trim()) throw new HarnessError(ERROR.compositionInvalid, `row ${index}.name must name a plugin package.`);
  const disabled = row.disabled ?? false;
  if (typeof disabled !== 'boolean') throw new HarnessError(ERROR.compositionInvalid, `row ${index}.disabled must be a boolean.`);
  if (row.isolate !== undefined && !isPlain(row.isolate)) throw new HarnessError(ERROR.compositionInvalid, `row ${index}.isolate must map service names.`);
  return Object.freeze({ id: row.id, name: row.name, config: row.config ?? {}, disabled, isolate: row.isolate ?? {} });
}

export function validateComposition(document) {
  if (!isPlain(document)) throw new HarnessError(ERROR.compositionInvalid, 'A composition must be an object.');
  if (document.version !== HARNESS_VERSION) throw new HarnessError(ERROR.compositionInvalid, `composition.version must be ${HARNESS_VERSION}.`);
  const rows = document.plugins;
  if (!Array.isArray(rows)) throw new HarnessError(ERROR.compositionInvalid, 'composition.plugins must be an array.');
  const seen = new Set();
  return Object.freeze({
    version: HARNESS_VERSION,
    name: typeof document.name === 'string' && document.name ? document.name : 'unnamed',
    rows: Object.freeze(rows.map((row, index) => {
      const validated = validateRow(row, index);
      if (seen.has(validated.id)) throw new HarnessError(ERROR.pluginDuplicate, `plugin row id ${validated.id} is duplicated.`);
      seen.add(validated.id);
      return validated;
    })),
    server: isPlain(document.server) ? Object.freeze({ host: document.server.host ?? '127.0.0.1', port: document.server.port ?? 8790 }) : Object.freeze({ host: '127.0.0.1', port: 8790 }),
  });
}

/** Tool definitions are the only way a business action reaches a model. */
export function validateTool(tool) {
  if (!isPlain(tool)) throw new HarnessError(ERROR.toolInvalid, 'A tool must be a plain object.');
  if (typeof tool.name !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/u.test(tool.name)) throw new HarnessError(ERROR.toolInvalid, `tool.name must be snake_case.`);
  if (typeof tool.description !== 'string' || !tool.description.trim()) throw new HarnessError(ERROR.toolInvalid, `${tool.name}.description is required.`);
  if (!isPlain(tool.parameters)) throw new HarnessError(ERROR.toolInvalid, `${tool.name}.parameters must be a JSON Schema object.`);
  if (!['never', 'always', 'policy'].includes(tool.approval ?? 'policy')) throw new HarnessError(ERROR.toolInvalid, `${tool.name}.approval must be never/always/policy.`);
  if (typeof tool.handler !== 'function') throw new HarnessError(ERROR.toolInvalid, `${tool.name}.handler must be a function.`);
  return Object.freeze({ ...tool, approval: tool.approval ?? 'policy', authority: tool.authority ?? 'workspace' });
}

/** Slot names are the only UI extension points a client plugin may target. */
export const SLOT = Object.freeze({
  homeCards: 'home.cards',
  pageBody: 'page.body',
  sessionHeader: 'session.header',
  settingsSection: 'settings.section',
});

export const ROUTE_PREFIX = '/api';
