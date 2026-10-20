// Tools seam: model-facing tool registry + execution pipeline.
//
// Frozen contract (packages/harness-contracts/CONTRACT.md §5, plus the Lead's
// frozen handler/audit clarification):
//
//   ctx.tools.register(toolDefinition)                  // validateTool; duplicate -> HARNESS_TOOL_DUPLICATE
//   ctx.tools.list({ actor }) -> [{name, description, parameters, approval}]
//   ctx.tools.execute(name, args, { actor, signal })    -> Promise<unknown>
//     handler: tool.handler(args, execution) with
//       execution = { actor, signal, ctx, storage, approval, tools }
//
// Execute order: registry lookup -> validateArgs (JSON-Schema subset) -> consume
// an approved one-shot ticket for `approval: 'always'` (or for a `'policy'`
// tool whose injected policy requires one) -> handler -> JSON-serializability
// check -> audit append into `state.harnessAudit` (cap 1000).
//
// Audit entry (frozen shape; appended when storage is mounted, skipped cleanly
// when it is not): { id, at, actor, tool, approvalId, ok, errorCode? }.
// Audit writes are best-effort: a storage failure never turns a successful tool
// call into a failure.
//
// Approval modes:
//   'never'  -> only allowed for tools explicitly registered with readOnly: true;
//               the ticket-less path is the P0 read-only path.
//   'always' -> args.approvalId must name an approved one-shot ticket; it is
//               consumed through ctx.approval by the executing actor.
//   'policy' -> injected policy(actor, toolName, args) decides:
//                 true/'always'/'required'/'approve'  -> require a ticket
//                 false/'never'/'allow'/'not-required' -> no ticket needed
//                 'deny'/'refused'                     -> refuse execution
//                 undefined                            -> require (default = always)
//               Without an injected policy the default is "always approve required".
//
// Error mapping: unknown tool -> HARNESS_TOOL_REFUSED; invalid args / invalid
// tool definition -> HARNESS_TOOL_INVALID; missing/expired/consumed ticket ->
// HARNESS_APPROVAL_REQUIRED (propagated from ctx.approval); wrong-actor ticket
// or a ticket issued for another tool -> HARNESS_APPROVAL_REFUSED; non-JSON
// handler result -> HARNESS_TOOL_REFUSED.

import { randomUUID } from 'node:crypto';
import { ERROR, HarnessError, SERVICE, validateTool } from '../../harness-contracts/src/index.mjs';
import { normalizeActor, provideService, serviceFromContext } from './ctx.mjs';

/** Maximum number of execution audit entries retained in state.harnessAudit. */
export const MAX_AUDIT_ENTRIES = 1000;
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/** Lightweight provider manifest (optional for the kernel; storage/approval are optional at runtime). */
export const manifest = Object.freeze({
  id: 'tools',
  version: '0.1.0',
  kind: 'provider',
  description: 'Tool registry and approval-gated execution pipeline',
  entry: './src/tools.mjs',
  requires: Object.freeze([]),
  provides: Object.freeze([SERVICE.tools]),
});

const isPlainObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const invalidArgs = (path, message) =>
  new HarnessError(ERROR.toolInvalid, `Invalid tool arguments at ${path}: ${message}.`, { path });

const jsonEqual = (left, right) => {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

function matchesType(type, value) {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isSafeInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      throw new HarnessError(ERROR.toolInvalid, `Unsupported JSON Schema type ${JSON.stringify(type)}.`);
  }
}

function validateValue(rule, value, path) {
  if (rule === undefined || rule === null || rule === true) return;
  if (!isPlainObject(rule)) throw new HarnessError(ERROR.toolInvalid, `Invalid JSON Schema at ${path}.`);
  const declared = rule.type === undefined ? undefined : Array.isArray(rule.type) ? rule.type : [rule.type];
  if (declared) {
    for (const type of declared)
      if (!SCHEMA_TYPES.has(type)) throw new HarnessError(ERROR.toolInvalid, `Unsupported JSON Schema type ${JSON.stringify(type)} at ${path}.`);
    if (!declared.some(type => matchesType(type, value)))
      throw invalidArgs(path, `must be ${declared.join('|')}`);
  }
  if (Array.isArray(rule.enum) && !rule.enum.some(candidate => jsonEqual(candidate, value)))
    throw invalidArgs(path, `must be one of ${rule.enum.map(item => JSON.stringify(item)).join(', ')}`);
  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) throw invalidArgs(path, `must be at least ${rule.minLength} characters`);
    if (rule.maxLength !== undefined && value.length > rule.maxLength) throw invalidArgs(path, `must be at most ${rule.maxLength} characters`);
    if (rule.pattern !== undefined) {
      let expression;
      try {
        expression = new RegExp(rule.pattern, 'u');
      } catch (cause) {
        throw new HarnessError(ERROR.toolInvalid, `Invalid JSON Schema pattern at ${path}.`, { path, cause: String(cause?.message ?? cause) });
      }
      if (!expression.test(value)) throw invalidArgs(path, `must match ${JSON.stringify(rule.pattern)}`);
    }
  }
  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum) throw invalidArgs(path, `must be >= ${rule.minimum}`);
    if (rule.maximum !== undefined && value > rule.maximum) throw invalidArgs(path, `must be <= ${rule.maximum}`);
  }
  if (isPlainObject(value)) {
    const properties = rule.properties ?? {};
    if (!isPlainObject(properties)) throw new HarnessError(ERROR.toolInvalid, `Invalid JSON Schema properties at ${path}.`);
    for (const name of rule.required ?? [])
      if (!Object.hasOwn(value, name) || value[name] === undefined) throw invalidArgs(`${path}.${name}`, 'is required');
    if (rule.additionalProperties === false) {
      for (const name of Object.keys(value))
        if (!Object.hasOwn(properties, name)) throw invalidArgs(`${path}.${name}`, 'is not allowed');
    }
    for (const [name, ruleForProperty] of Object.entries(properties))
      if (Object.hasOwn(value, name) && value[name] !== undefined && ruleForProperty !== undefined)
        validateValue(ruleForProperty, value[name], `${path}.${name}`);
  }
  if (Array.isArray(value) && rule.items !== undefined) {
    const items = Array.isArray(rule.items) ? undefined : rule.items;
    if (Array.isArray(rule.items)) {
      // Tuple form: per-index schema; extra items are validated by the last schema.
      for (const [index, item] of value.entries()) {
        const itemRule = rule.items[index] ?? rule.items[rule.items.length - 1];
        if (itemRule !== undefined) validateValue(itemRule, item, `${path}[${index}]`);
      }
    } else {
      for (const [index, item] of value.entries()) validateValue(items, item, `${path}[${index}]`);
    }
  }
}

/**
 * Validate `args` against the supported JSON-Schema subset.
 * Supported: type, required, properties, enum, minLength, maxLength, pattern,
 * minimum, maximum, additionalProperties:false (plus recursive items).
 */
export function validateArgs(schema, args) {
  if (!isPlainObject(schema)) throw new HarnessError(ERROR.toolInvalid, 'Tool parameters must be a JSON Schema object.');
  validateValue(schema, args === undefined ? {} : args, 'args');
  return args;
}

/** Assert the handler result survives a JSON round trip; returns the plain clone. */
function serializableResult(value, toolName) {
  if (value === undefined) return undefined;
  let text;
  try {
    text = JSON.stringify(value);
  } catch (cause) {
    throw new HarnessError(ERROR.toolRefused, `Tool ${toolName} returned a value that is not JSON-serializable.`, {
      tool: toolName,
      cause: String(cause?.message ?? cause),
    });
  }
  if (text === undefined)
    throw new HarnessError(ERROR.toolRefused, `Tool ${toolName} returned a value that is not JSON-serializable.`, { tool: toolName });
  try {
    return JSON.parse(text);
  } catch {
    throw new HarnessError(ERROR.toolRefused, `Tool ${toolName} returned a value that is not JSON-serializable.`, { tool: toolName });
  }
}

/**
 * Construct the tool service directly (tests/embedders).
 * `storage`/`approval` may be a service object or a resolver function (the
 * provider passes resolvers so the services are looked up on the live ctx).
 */
export function createTools({
  policy,
  storage = null,
  approval = null,
  clock = () => Date.now(),
  auditLimit = MAX_AUDIT_ENTRIES,
  ctx = null,
  allowedTools,
  deniedTools,
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('tools.clock must be a function returning epoch milliseconds.');
  if (policy !== undefined && typeof policy !== 'function') throw new TypeError('tools.policy must be a function(actor, tool, args) when provided.');
  const accessList = (value, label) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 128 || value.some(name => typeof name !== 'string' || !name.trim()))
      throw new TypeError(`tools.${label} must be an array of bounded tool names.`);
    return [...new Set(value)];
  };
  const allowed = accessList(allowedTools, 'allowedTools');
  const denied = accessList(deniedTools, 'deniedTools');
  if (allowed.length && denied.some(name => allowed.includes(name)))
    throw new TypeError('tools.allowedTools and tools.deniedTools must not overlap.');
  const permitted = name => (denied.includes(name) ? false : allowed.length === 0 || allowed.includes(name));
  const limit = Number.isSafeInteger(auditLimit) && auditLimit > 0 ? auditLimit : MAX_AUDIT_ENTRIES;
  const registry = new Map();
  const storageOption = storage;
  const approvalOption = approval;

  const now = () => {
    const at = clock();
    if (!Number.isFinite(at)) throw new HarnessError(ERROR.toolRefused, 'The tool clock returned a non-finite timestamp.');
    return at;
  };
  const resolve = option => {
    if (typeof option === 'function') {
      try {
        return option() ?? null;
      } catch {
        return null;
      }
    }
    return option ?? null;
  };

  async function writeAudit({ at, actor, tool, approvalId, ok, errorCode }) {
    const store = resolve(storageOption);
    if (!store || typeof store.update !== 'function') return; // mountable without storage
    const entry = {
      id: randomUUID(),
      at: new Date(at).toISOString(),
      actor: normalizeActor(actor),
      tool,
      approvalId: typeof approvalId === 'string' ? approvalId : null,
      ok: ok === true,
    };
    if (!entry.ok) entry.errorCode = typeof errorCode === 'string' ? errorCode : 'HARNESS_TOOL_FAILED';
    try {
      await store.update(state => {
        const entries = Array.isArray(state.harnessAudit) ? state.harnessAudit : [];
        entries.push(entry);
        state.harnessAudit = entries.length > limit ? entries.slice(-limit) : entries;
      });
    } catch {
      // Auditing is best-effort: never change the tool outcome because the audit
      // store is closed, damaged or full.
    }
  }

  async function decidePolicy(actor, tool, args) {
    if (typeof policy !== 'function') return 'require'; // default = approval always required
    const decision = await policy(actor, tool.name, args);
    if (decision === 'deny' || decision === 'refused') return 'refuse';
    if (decision === false || decision === 'never' || decision === 'allow' || decision === 'not-required') return 'allow';
    if (decision === true || decision === undefined || decision === 'always' || decision === 'required' || decision === 'approve')
      return 'require';
    throw new HarnessError(
      ERROR.toolRefused,
      `The approval policy for tool ${tool.name} returned an unsupported decision ${JSON.stringify(decision)}.`,
      { tool: tool.name },
    );
  }

  async function consumeTicket(tool, ticketId, actor) {
    const approvalService = resolve(approvalOption);
    if (!approvalService || typeof approvalService.consume !== 'function')
      throw new HarnessError(
        ERROR.approvalRequired,
        `Tool ${tool.name} requires an approval service (ctx.approval), but none is mounted.`,
        { tool: tool.name },
      );
    if (typeof ticketId !== 'string' || !ticketId)
      throw new HarnessError(
        ERROR.approvalRequired,
        `Tool ${tool.name} requires args.approvalId pointing at an approved one-shot ticket.`,
        { tool: tool.name },
      );
    if (!actor || typeof actor !== 'object' || Array.isArray(actor))
      throw new HarnessError(ERROR.approvalRequired, `Tool ${tool.name} requires an actor to consume its approval ticket.`, {
        tool: tool.name,
      });
    // Bind the ticket to this tool: a ticket approved for another tool must not
    // authorize this one. Listing tickets is advisory when unavailable.
    if (typeof approvalService.list === 'function') {
      let items;
      try {
        items = approvalService.list({});
      } catch {
        items = undefined;
      }
      if (Array.isArray(items)) {
        const ticket = items.find(item => item && item.id === ticketId);
        if (ticket && typeof ticket.tool === 'string' && ticket.tool !== tool.name)
          throw new HarnessError(
            ERROR.approvalRefused,
            `Approval ticket ${ticketId} was issued for tool ${JSON.stringify(ticket.tool)}, not ${JSON.stringify(tool.name)}.`,
            { tool: tool.name, approvalId: ticketId },
          );
      }
    }
    await approvalService.consume(ticketId, actor);
  }

  function register(tool) {
    const validated = validateTool(tool);
    if (validated.approval === 'never' && validated.readOnly !== true)
      throw new HarnessError(
        ERROR.toolInvalid,
        `${validated.name}: approval:'never' requires readOnly: true; only read-only tools may skip approval.`,
        { tool: validated.name },
      );
    if (registry.has(validated.name))
      throw new HarnessError(ERROR.toolDuplicate, `Tool ${validated.name} is already registered.`, { tool: validated.name });
    registry.set(validated.name, validated);
    return validated;
  }

  function list() {
    return [...registry.values()].filter(tool => permitted(tool.name)).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: structuredClone(tool.parameters),
      approval: tool.approval,
    }));
  }

  async function execute(name, args, options = {}) {
    const startedAt = now();
    const actor = options?.actor ?? null;
    const signal = options?.signal;
    const rawArgs = args === undefined ? {} : args;
    const tool = registry.get(name);
    if (!tool) {
      const toolName = typeof name === 'string' ? name : String(name);
      const error = new HarnessError(ERROR.toolRefused, `Unknown tool ${JSON.stringify(toolName)}.`, { tool: toolName });
      await writeAudit({ at: startedAt, actor, tool: toolName, approvalId: null, ok: false, errorCode: error.code });
      throw error;
    }
    if (!permitted(tool.name)) {
      const error = new HarnessError(ERROR.toolRefused, `Tool ${tool.name} is not enabled for this preset.`, { tool: tool.name });
      await writeAudit({ at: startedAt, actor, tool: tool.name, approvalId: null, ok: false, errorCode: error.code });
      throw error;
    }
    let ticketId = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs.approvalId : undefined;
    let businessArgs = rawArgs;
    let ok = false;
    let errorCode;
    try {
      if (tool.approval !== 'never') {
        // `approvalId` is a harness control field, not a business argument.
        if (isPlainObject(rawArgs) && Object.hasOwn(rawArgs, 'approvalId')) {
          businessArgs = { ...rawArgs };
          delete businessArgs.approvalId;
        }
        ticketId = isPlainObject(rawArgs) ? rawArgs.approvalId : undefined;
      }
      validateArgs(tool.parameters, businessArgs);
      let needsTicket = tool.approval === 'always';
      if (tool.approval === 'policy') {
        const decision = await decidePolicy(actor, tool, businessArgs);
        if (decision === 'refuse')
          throw new HarnessError(ERROR.toolRefused, `The approval policy refused tool ${tool.name}.`, { tool: tool.name });
        needsTicket = decision === 'require';
      }
      if (needsTicket) await consumeTicket(tool, ticketId, actor);
      const execution = Object.freeze({
        actor,
        signal,
        ctx,
        storage: resolve(storageOption),
        approval: resolve(approvalOption),
        tools: service,
      });
      const result = await tool.handler(businessArgs, execution);
      const output = serializableResult(result, tool.name);
      ok = true;
      return output;
    } catch (error) {
      errorCode = typeof error?.code === 'string' ? error.code : 'HARNESS_TOOL_FAILED';
      throw error;
    } finally {
      await writeAudit({
        at: startedAt,
        actor,
        tool: tool.name,
        approvalId: typeof ticketId === 'string' ? ticketId : null,
        ok,
        errorCode: ok ? undefined : errorCode,
      });
    }
  }

  const service = Object.freeze({ register, list, execute });
  return service;
}

/**
 * Mountable provider: `createToolsProvider({ policy }).apply(ctx)`.
 * Registers `ctx.tools` (via `ctx.provide` on Cordis) and returns a disposer.
 * Services are resolved lazily from the live context, so mount order between
 * storage/approval/tools does not change tool behaviour.
 */
export function createToolsProvider(options = {}) {
  let service;
  let registration;
  let disposer;
  const apply = async (ctx, config = {}) => {
    if (!ctx || typeof ctx !== 'object') throw new TypeError('The tools provider requires a kernel context object.');
    if (!registration) {
      const existing = serviceFromContext(ctx, SERVICE.tools);
      if (existing !== undefined)
        throw new HarnessError(ERROR.pluginDuplicate, 'ctx.tools is already registered by another provider.', { service: SERVICE.tools });
    }
    if (!service) {
      const storageOption =
        options.storage ?? (options.bindContext === false ? null : () => serviceFromContext(ctx, SERVICE.storage));
      const approvalOption =
        options.approval ?? (options.bindContext === false ? null : () => serviceFromContext(ctx, SERVICE.approval));
      service = createTools({
        policy: options.policy,
        storage: storageOption,
        approval: approvalOption,
        clock: options.clock,
        auditLimit: options.auditLimit ?? config?.auditLimit,
        allowedTools: options.allowedTools ?? config?.allowedTools,
        deniedTools: options.deniedTools ?? config?.deniedTools,
        ctx,
      });
    }
    if (!registration) registration = provideService(ctx, SERVICE.tools, service);
    if (!disposer) {
      let disposed = false;
      disposer = async () => {
        if (disposed) return;
        disposed = true;
        await registration.dispose();
      };
    }
    return disposer;
  };
  return { apply };
}

// Fallback for loaders that import the module instead of calling the factory.
const providers = new WeakMap();
export async function apply(ctx, config = {}) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('The tools provider requires a kernel context object.');
  let provider = providers.get(ctx);
  if (!provider) {
    provider = createToolsProvider(config ?? {});
    providers.set(ctx, provider);
  }
  return provider.apply(ctx, config);
}

export default { createTools, createToolsProvider, validateArgs, apply, manifest, MAX_AUDIT_ENTRIES };
