import { createHash, randomUUID } from 'node:crypto';
import { isTemplateSchedule, scheduleGoalDefinition, templateOccurrenceCount, templateApprovalDetails, assertTemplateDefinition, previousTemplateOccurrence, createTemplateOccurrence } from './schedule-template.mjs';

/** An HTTP-safe capability error; never includes credentials or adapter exceptions. */
export class CapabilityError extends Error {
  constructor(status, code, message) { super(message); this.name = 'CapabilityError'; this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new CapabilityError(status, code, message); };
class InterruptedOperation extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
async function boundedCall(callback, controller, timeoutMs) {
  if (controller.signal.aborted) throw new InterruptedOperation('SHUTDOWN');
  let timer; let onAbort;
  const interrupted = new Promise((resolve, reject) => {
    onAbort = () => reject(new InterruptedOperation('SHUTDOWN'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { reject(new InterruptedOperation('TIMEOUT')); controller.abort('TIMEOUT'); }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) throw new InterruptedOperation('SHUTDOWN'); return callback(); }), interrupted]); }
  finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); }
}
export function goalDefinition(goal, state) {
  const selection = goal.inputContext ?? state.conversations?.find(item => item.id === goal.conversationId)?.inputContext ?? null;
  const selected = selection ? {
    selection,
    artifacts: (selection.artifacts || []).map(item => ({ ...item, sha256: state.artifacts?.find(file => file.id === item.id)?.versions?.find(version => version.version === item.version)?.sha256 || null })),
    skills: (selection.skills || []).map(item => { const skill = state.capabilities?.skills.find(skill => skill.id === item.id); return { ...item, currentRevision: skill?.revision ?? null, enabled: skill?.enabled === true, instructionsHash: capabilityPayloadHash(skill?.instructions || '') }; }),
    memories: (selection.memoryIds || []).map(id => { const memory = state.memories?.find(item => item.id === id); return { id, enabled: memory?.enabled !== false, conversationId: memory?.conversationId || null, contentHash: capabilityPayloadHash(memory?.content ?? null) }; }),
    connectors: (selection.connectorActions || []).map(item => { const connector = state.capabilities?.connectors.find(connector => connector.id === item.connectorId); return { ...item, revision: connector?.revision ?? null, enabled: connector?.enabled === true }; }),
  } : null;
  return { title: goal.title ?? '', description: goal.description ?? '', maxSteps: goal.maxSteps ?? null, maxOutputTokens: goal.maxOutputTokens ?? (goal.maxSteps ?? 3) * 1600, model: state.settings?.model ?? null, inputContext: selection, inputContextHash: capabilityPayloadHash(selected), ...(goal.serviceTask ? { serviceTask: structuredClone(goal.serviceTask) } : {}) };
}

const collections = ['skills', 'connectors', 'approvals', 'schedules', 'scheduleRuns', 'connectorRuns'];
const sensitiveKey = /^(?:password|passphrase|secret|secrets|token|accessToken|refreshToken|apiKey|api_key|authorization|cookie|credentials|privateKey)$/i;
const reservedKeys = new Set(['__proto__', 'prototype', 'constructor']);
function object(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail(400, 'INVALID_INPUT', 'Expected a JSON object.');
  for (const field of Object.keys(input)) if (!fields.includes(field)) fail(400, 'INVALID_INPUT', 'Unexpected field in capability request.');
  return input;
}
function text(input, field, max = 200, fallback) {
  if (input === undefined && fallback !== undefined) return fallback;
  if (typeof input !== 'string' || !input.trim() || input.length > max) fail(400, 'INVALID_INPUT', `${field} must contain 1–${max} characters.`);
  return input.trim();
}
function boolean(input, fallback = false) {
  if (input === undefined) return fallback;
  if (typeof input !== 'boolean') fail(400, 'INVALID_INPUT', 'enabled must be a boolean.');
  return input;
}
function integer(input, field, min, max, fallback) {
  if (input === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(input) || input < min || input > max) fail(400, 'INVALID_INPUT', `${field} must be an integer from ${min} to ${max}.`);
  return input;
}
function identifier(input, field = 'id') {
  const value = text(input, field, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) || reservedKeys.has(value)) fail(400, 'INVALID_INPUT', `${field} contains unsupported characters.`);
  return value;
}
function timestamp(input, field = 'scheduledAt') {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input) || !Number.isFinite(Date.parse(input))) fail(400, 'INVALID_INPUT', `${field} must be an RFC 3339 timestamp with a timezone.`);
  return new Date(input).toISOString();
}
function canonical(value, depth = 0, seen = new Set()) {
  if (depth > 24) fail(400, 'INVALID_INPUT', 'JSON nesting exceeds 24 levels.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || seen.has(value)) fail(400, 'INVALID_INPUT', 'Only finite, acyclic JSON data is allowed.');
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = `[${value.map(item => canonical(item, depth + 1, seen)).join(',')}]`;
  else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(400, 'INVALID_INPUT', 'Only plain JSON objects are allowed.');
    result = `{${Object.keys(value).sort().map(key => {
      if (reservedKeys.has(key)) fail(400, 'INVALID_INPUT', 'Reserved JSON keys are not allowed.');
      return `${JSON.stringify(key)}:${canonical(value[key], depth + 1, seen)}`;
    }).join(',')}}`;
  }
  seen.delete(value);
  return result;
}
/** Stable SHA-256 digest of bounded, canonical JSON; object key order is irrelevant. */
export function capabilityPayloadHash(value) {
  const encoded = canonical(value);
  if (Buffer.byteLength(encoded) > 64_000) fail(413, 'PAYLOAD_TOO_LARGE', 'Capability payloads must be at most 64 KB.');
  return createHash('sha256').update(encoded).digest('hex');
}
function json(value) { capabilityPayloadHash(value); return JSON.parse(canonical(value)); }
function requireItem(state, collection, id) {
  const item = state.capabilities[collection].find(candidate => candidate.id === id);
  if (!item) fail(404, 'NOT_FOUND', 'The requested capability item does not exist.');
  return item;
}
function initialize(state) {
  if (state.capabilities === undefined) state.capabilities = { version: 1, ...Object.fromEntries(collections.map(key => [key, []])) };
  const domain = state.capabilities;
  if (!domain || domain.version !== 1 || !collections.every(key => Array.isArray(domain[key]))) fail(500, 'INVALID_CAPABILITY_DATA', 'Capability data is invalid; nothing was reset.');
  for (const name of collections) {
    const ids = new Set();
    for (const item of domain[name]) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail(500, 'INVALID_CAPABILITY_DATA', 'Capability records are invalid; nothing was reset.');
      ids.add(item.id);
    }
  }
  return domain;
}
function audit(state, kind, title, at, extra = {}) {
  if (!Array.isArray(state.activity)) return;
  state.activity.push({ id: randomUUID(), type: kind, title, detail: '', createdAt: at, ...extra });
  state.activity = state.activity.slice(-2000);
}

/**
 * Durable local capability registry. No timers, subprocesses, network clients, or
 * installed adapters are created here. The host calls tick and supplies reviewed
 * adapters and a local goal-enqueue callback explicitly. store.update must commit
 * serialized synchronous transactions before resolving; store.read returns a copy.
 */
export async function createCapabilityService({ store, clock = () => Date.now(), dispatchGoal, adapters = {}, environment = process.env, adapterTimeoutMs = 60_000, dispatchTimeoutMs = 10_000, executionContext = {} } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.update !== 'function') throw new TypeError('A durable store is required.');
  if (typeof clock !== 'function' || (dispatchGoal !== undefined && typeof dispatchGoal !== 'function')) throw new TypeError('Invalid capability service callbacks.');
  integer(adapterTimeoutMs, 'adapterTimeoutMs', 1, 300_000);
  integer(dispatchTimeoutMs, 'dispatchTimeoutMs', 1, 60_000);
  const contextSnapshot = json(executionContext);
  const contextHash = capabilityPayloadHash(contextSnapshot);
  const adapterMap = new Map();
  for (const [name, adapter] of Object.entries(adapters)) {
    identifier(name, 'adapter');
    if (!adapter || typeof adapter.execute !== 'function' || !Array.isArray(adapter.capabilities) || !adapter.capabilities.length || !adapter.capabilities.every(action => typeof action === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(action)) || (adapter.credentialEnvNames !== undefined && (!Array.isArray(adapter.credentialEnvNames) || !adapter.credentialEnvNames.every(value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/.test(value))))) throw new TypeError('Adapters must declare execute, capabilities, and optional credentialEnvNames.');
    const actionDescriptions = json(adapter.actionDescriptions || {});
    if (Object.entries(actionDescriptions).some(([action, description]) => !adapter.capabilities.includes(action) || typeof description !== 'string' || description.length > 2000)) throw new TypeError('Adapter action descriptions must describe declared actions only.');
    adapterMap.set(name, Object.freeze({ actionDescriptions: Object.freeze(actionDescriptions), execute: adapter.execute, capabilities: Object.freeze([...adapter.capabilities]), credentialEnvNames: Object.freeze([...(adapter.credentialEnvNames || [])]) }));
  }
  const milliseconds = () => { const value = clock(); const result = value instanceof Date ? value.getTime() : value; if (!Number.isFinite(result)) throw new TypeError('clock must return epoch milliseconds or a Date.'); return result; };
  const now = () => new Date(milliseconds()).toISOString();
  let closed = false;
  const inFlight = new Set();
  const ensureOpen = () => { if (closed) fail(503, 'SHUTTING_DOWN', 'Capability service is shutting down.'); };
  const mutate = callback => { ensureOpen(); return store.update(state => { ensureOpen(); initialize(state); return callback(state); }); };
  const read = () => { const state = store.read(); initialize(state); return state; };
  function secretValues() {
    const values = new Set();
    // Only explicitly reviewed environment names are read; never scan process.env.
    for (const adapter of adapterMap.values()) for (const name of adapter.credentialEnvNames) if (typeof environment[name] === 'string' && environment[name]) values.add(environment[name]);
    return [...values];
  }
  function credentialVariants(values = secretValues()) {
    return [...new Set(values.flatMap(secret => [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]))];
  }
  function assertSafeMemory(content) {
    if (typeof content !== 'string') fail(400, 'INVALID_INPUT', 'Memory content must be a string.');
    const credentialPattern = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passphrase|secret|authorization)\s*[:=]\s*\S+|\bBearer\s+[A-Za-z0-9._~+\/-]{8,}|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b)/i;
    if (credentialPattern.test(content) || credentialVariants().some(secret => content.includes(secret))) fail(400, 'RAW_CREDENTIAL_REJECTED', 'Credentials cannot be saved as memory. Keep them in approved server environment references.');
    return content;
  }
  function rejectSecrets(value) {
    function visit(item) {
      if (typeof item === 'string') { if (credentialVariants().some(secret => item.includes(secret))) fail(400, 'RAW_CREDENTIAL_REJECTED', 'Raw credentials are not accepted. Use an approved environment reference.'); }
      else if (Array.isArray(item)) item.forEach(visit);
      else if (item && typeof item === 'object') for (const [key, entry] of Object.entries(item)) {
        if (sensitiveKey.test(key) || credentialVariants().some(secret => key.includes(secret))) fail(400, 'RAW_CREDENTIAL_REJECTED', 'Raw credentials are not accepted. Use an approved environment reference.');
        visit(entry);
      }
    }
    visit(value);
    return value;
  }
  function cleanResult(value, secrets = []) {
    const safe = json(value === undefined ? null : value);
    const masks = [...new Set([...secretValues(), ...secrets].filter(Boolean).flatMap(secret => [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]))].sort((a, b) => b.length - a.length);
    function visit(item) {
      if (typeof item === 'string') { for (const secret of masks) item = item.split(secret).join('[REDACTED]'); return item; }
      if (Array.isArray(item)) return item.map(visit);
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [visit(key), sensitiveKey.test(key) ? '[REDACTED]' : visit(entry)]));
      return item;
    }
    return visit(safe);
  }
  function connectorView(item) {
    const adapter = adapterMap.get(item.adapter);
    const refs = Object.values(item.credentialRefs);
    const credentialConfigured = refs.every(name => adapter?.credentialEnvNames.includes(name) && typeof environment[name] === 'string' && environment[name].length > 0);
    const declared = item.capabilities.every(action => adapter?.capabilities.includes(action));
    return { ...item, actionDescriptions: adapter?.actionDescriptions || {}, adapterConfigured: Boolean(adapter), credentialConfigured, status: !item.enabled ? 'disabled' : !adapter ? 'adapter_missing' : !declared ? 'capability_mismatch' : !credentialConfigured ? 'credential_missing' : 'ready', connectionVerified: false };
  }
  await store.update(state => {
    const domain = initialize(state);
    const at = now();
    for (const run of [...domain.scheduleRuns, ...domain.connectorRuns]) if (run.status === 'dispatching' || run.status === 'running') {
      run.status = 'interrupted'; run.finishedAt = at; run.error = { code: 'INTERRUPTED', message: 'Server stopped with an uncertain result. No automatic retry was made.' };
      if (run.scheduleId) {
        const schedule = domain.schedules.find(item => item.id === run.scheduleId);
        if (schedule) { schedule.enabled = false; schedule.status = 'interrupted'; schedule.updatedAt = at; }
      }
    }
  });
  const listSkills = () => read().capabilities.skills;
  const listConnectors = () => read().capabilities.connectors.map(connectorView);
  const listApprovals = () => read().capabilities.approvals.map(item => ({ ...item, status: item.status !== 'consumed' && Date.parse(item.expiresAt) <= milliseconds() ? 'expired' : item.status }));
  const listSchedules = () => read().capabilities.schedules;
  const listScheduleRuns = () => read().capabilities.scheduleRuns;
  const listConnectorRuns = () => read().capabilities.connectorRuns;
  const bootstrap = () => ({ version: 1, skills: listSkills(), connectors: listConnectors(), adapterCatalog: [...adapterMap.entries()].map(([adapter, value]) => ({ adapter, capabilities: [...value.capabilities], credentialEnvNames: [...value.credentialEnvNames], actionDescriptions: value.actionDescriptions })), approvals: listApprovals(), schedules: listSchedules(), scheduleRuns: listScheduleRuns(), connectorRuns: listConnectorRuns(), scheduler: { dispatchConfigured: Boolean(dispatchGoal), automaticTimer: false, minimumIntervalSeconds: 60 }, supported: { skills: 'instruction-registry', connectors: 'explicit-server-adapters', schedules: ['at', 'every'] } });
  function creation(input) {
    object(input, Object.keys(input || {}));
    const { requestId, ...body } = input;
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId))) fail(400, 'INVALID_INPUT', 'requestId must contain 1–128 letters, numbers, underscores or dashes.');
    return { body, requestId: requestId ?? null, requestFingerprint: capabilityPayloadHash(body) };
  }
  function previousCreation(state, collection, request) {
    if (!request.requestId) return null;
    const previous = state.capabilities[collection].find(item => item.requestId === request.requestId);
    if (previous && previous.requestFingerprint !== request.requestFingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'This requestId was already used with different content.');
    return previous;
  }
  function skillFields(input, current) {
    object(input, ['name', 'description', 'instructions', 'enabled']);
    const fields = { name: text(input.name, 'name', 120, current?.name), description: input.description === '' ? '' : text(input.description, 'description', 2000, current?.description ?? ''), instructions: text(input.instructions, 'instructions', 24_000, current?.instructions), enabled: boolean(input.enabled, current?.enabled ?? false) };
    rejectSecrets(fields);
    return fields;
  }
  async function createSkill(input) {
    const request = creation(input);
    return mutate(state => { const previous = previousCreation(state, 'skills', request); if (previous) return { skill: previous, duplicate: true }; const fields = skillFields(request.body); const at = now(); const skill = { id: randomUUID(), ...fields, requestId: request.requestId, requestFingerprint: request.requestFingerprint, revision: 1, createdAt: at, updatedAt: at }; state.capabilities.skills.push(skill); audit(state, 'skill_created', 'Instruction skill saved', at, { skillId: skill.id }); return { skill }; });
  }
  async function updateSkill(id, input) {
    return mutate(state => { const skill = requireItem(state, 'skills', id); Object.assign(skill, skillFields(input, skill), { revision: skill.revision + 1, updatedAt: now() }); return { skill }; });
  }
  function connectorFields(input, current) {
    object(input, ['name', 'description', 'adapter', 'capabilities', 'credentialRefs', 'enabled']);
    const adapter = identifier(input.adapter ?? current?.adapter, 'adapter');
    const capabilities = input.capabilities ?? current?.capabilities;
    if (!Array.isArray(capabilities) || !capabilities.length || capabilities.length > 100) fail(400, 'INVALID_INPUT', 'capabilities must contain 1–100 action names.');
    const actions = capabilities.map(action => identifier(action, 'capability'));
    if (new Set(actions).size !== actions.length) fail(400, 'INVALID_INPUT', 'Duplicate capabilities are not allowed.');
    const refs = input.credentialRefs ?? current?.credentialRefs ?? {};
    object(refs, Object.keys(refs));
    if (Object.keys(refs).length > 20) fail(400, 'INVALID_INPUT', 'At most 20 credential references are allowed.');
    const credentialRefs = {};
    for (const [slot, name] of Object.entries(refs)) {
      identifier(slot, 'credential slot');
      if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{1,127}$/.test(name)) fail(400, 'RAW_CREDENTIAL_REJECTED', 'Credential references must be environment variable names, never raw credentials.');
      credentialRefs[slot] = name;
    }
    const reviewed = adapterMap.get(adapter);
    if (reviewed && (actions.some(action => !reviewed.capabilities.includes(action)) || Object.values(credentialRefs).some(name => !reviewed.credentialEnvNames.includes(name)))) fail(403, 'ADAPTER_SCOPE_DENIED', 'The adapter does not declare those capabilities or credential environment names.');
    const fields = { name: text(input.name, 'name', 120, current?.name), description: input.description === '' ? '' : text(input.description, 'description', 2000, current?.description ?? ''), adapter, capabilities: actions, credentialRefs, enabled: boolean(input.enabled, current?.enabled ?? false) };
    rejectSecrets({ name: fields.name, description: fields.description });
    return fields;
  }
  async function createConnector(input) {
    const request = creation(input);
    return mutate(state => { const previous = previousCreation(state, 'connectors', request); if (previous) return { connector: connectorView(previous), duplicate: true }; const fields = connectorFields(request.body); if (fields.enabled) fail(400, 'DISABLED_DEFAULT_REQUIRED', 'New connectors must be disabled. Enable the saved connector explicitly.'); const at = now(); const connector = { id: randomUUID(), ...fields, requestId: request.requestId, requestFingerprint: request.requestFingerprint, revision: 1, createdAt: at, updatedAt: at }; state.capabilities.connectors.push(connector); return { connector: connectorView(connector) }; });
  }
  async function updateConnector(id, input) {
    return mutate(state => { const connector = requireItem(state, 'connectors', id); Object.assign(connector, connectorFields(input, connector), { revision: connector.revision + 1, updatedAt: now() }); return { connector: connectorView(connector) }; });
  }
  async function remove(collection, id) {
    return mutate(state => { requireItem(state, collection, id); state.capabilities[collection] = state.capabilities[collection].filter(item => item.id !== id); return { deleted: true }; });
  }
  function approvalScope(input) {
    object(input, ['action', 'resource', 'payload', 'expiresInSeconds']);
    const action = text(input.action, 'action', 128);
    if (!['connector.execute', 'schedule.enable', 'monitor.control'].includes(action)) fail(400, 'UNSUPPORTED_APPROVAL', 'Use an original connector, schedule or Host-bound monitor control approval.');
    const resource = text(input.resource, 'resource', 400);
    const payload = rejectSecrets(json(input.payload));
    return { action, resource, payload, payloadHash: capabilityPayloadHash(payload) };
  }
  async function requestApproval(input, trusted = {}) {
    const scope = approvalScope(input);
    if (scope.action === 'monitor.control' && typeof trusted.onCreated !== 'function') fail(403, 'HOST_BOUND_APPROVAL_REQUIRED', 'Monitor control requests must be bound by the original Host.');
    const expiresInSeconds = integer(input.expiresInSeconds, 'expiresInSeconds', 1, 3600, 300);
    return mutate(state => { const at = milliseconds(); const approval = { id: randomUUID(), ...scope, status: 'pending', createdAt: new Date(at).toISOString(), expiresAt: new Date(at + expiresInSeconds * 1000).toISOString(), decidedAt: null, consumedAt: null }; state.capabilities.approvals.push(approval); trusted.onCreated?.(state, approval); return { approval }; });
  }
  async function decideApproval(id, input, trusted = {}) {
    object(input, ['decision', 'confirmed']);
    if (!['approved', 'denied'].includes(input.decision) || input.confirmed !== true) fail(400, 'EXPLICIT_DECISION_REQUIRED', 'Choose approved or denied and confirm the displayed action and payload.');
    return mutate(state => {
      const approval = requireItem(state, 'approvals', id);
      if (['workspace-run', 'supplier-publication', 'supplier-monitor-notification'].includes(approval.payload?.binding?.type) && typeof trusted.onDecision !== 'function') fail(409, 'RUN_APPROVAL_BOUND', 'Review this action in its originating conversation run.');
      if (Date.parse(approval.expiresAt) <= milliseconds()) fail(409, 'APPROVAL_EXPIRED', 'Approval expired. Review a new request.');
      if (approval.status !== 'pending') fail(409, 'APPROVAL_ALREADY_DECIDED', 'This approval already has a decision.');
      approval.status = input.decision; approval.decidedAt = now();
      trusted.onDecision?.(state, approval);
      audit(state, `approval_${input.decision}`, `Capability action ${input.decision}`, approval.decidedAt, { approvalId: id });
      return { approval };
    });
  }
  function consumeApproval(state, id, scope) {
    if (typeof id !== 'string') fail(403, 'APPROVAL_REQUIRED', 'Explicit approval of this exact action is required.');
    const approval = requireItem(state, 'approvals', id);
    if (approval.status === 'consumed') fail(409, 'APPROVAL_USED', 'This approval has already been used.');
    if (Date.parse(approval.expiresAt) <= milliseconds()) fail(403, 'APPROVAL_EXPIRED', 'Approval expired. Review a new request.');
    if (approval.status !== 'approved') fail(403, 'APPROVAL_REQUIRED', 'This action has not been approved.');
    if (approval.action !== scope.action || approval.resource !== scope.resource || approval.payloadHash !== capabilityPayloadHash(scope.payload) || approval.payloadHash !== capabilityPayloadHash(approval.payload)) fail(403, 'APPROVAL_MISMATCH', 'Approval does not match the current action, resource, configuration, and payload.');
    approval.status = 'consumed'; approval.consumedAt = now(); return approval;
  }
  function executionInput(input) {
    object(input, ['action', 'resource', 'payload', 'approvalId']);
    return rejectSecrets({ action: identifier(input.action, 'action'), resource: text(input.resource, 'resource', 2000), payload: json(input.payload ?? {}) });
  }
  function connectorScope(connector, input, binding) {
    return { action: 'connector.execute', resource: `connector:${connector.id}`, payload: { connectorRevision: connector.revision, adapter: connector.adapter, action: input.action, resource: input.resource, payload: input.payload, ...(binding ? { binding: json(binding) } : {}) } };
  }
  // Binding and transaction hooks are host-only arguments; executionInput rejects
  // them in HTTP/model input. Unbound manual approvals cannot authorize run actions.
  function connectorApprovalRequest(id, input, trusted = {}) { return connectorScope(requireItem(read(), 'connectors', id), executionInput(input), trusted.binding); }
  async function executeConnector(id, input, trusted = {}) {
    ensureOpen();
    const execution = executionInput(input);
    const controller = new AbortController();
    const abort = () => controller.abort('CANCELLED');
    if (trusted.signal?.aborted) abort(); else trusted.signal?.addEventListener('abort', abort, { once: true });
    const job = (async () => {
      let credentials;
      let adapter;
      const admitted = await mutate(state => {
        trusted.assertAllowed?.(state);
        const connector = requireItem(state, 'connectors', id);
        if (!connector.capabilities.includes(execution.action)) fail(403, 'CAPABILITY_DENIED', 'This action is not declared by the connector.');
        const view = connectorView(connector);
        if (view.status !== 'ready') return { execution: { status: 'blocked', error: { code: view.status.toUpperCase(), message: 'Connector execution is unavailable until the adapter, approved credential references, and enabled configuration are ready.' } } };
        adapter = adapterMap.get(connector.adapter);
        if (!adapter.capabilities.includes(execution.action)) fail(403, 'CAPABILITY_DENIED', 'This action is not declared by the configured adapter.');
        const scope = connectorScope(connector, execution, trusted.binding);
        consumeApproval(state, input.approvalId, scope);
        credentials = Object.fromEntries(Object.entries(connector.credentialRefs).map(([slot, name]) => [slot, environment[name]]));
        const run = { id: randomUUID(), connectorId: id, connectorRevision: connector.revision, action: execution.action, resource: execution.resource, payloadHash: capabilityPayloadHash(execution.payload), approvalId: input.approvalId, status: 'running', startedAt: now(), finishedAt: null };
        state.capabilities.connectorRuns.push(run);
        trusted.onAdmitted?.(state, run);
        return { execution: run };
      });
      const run = admitted.execution;
      if (run.status !== 'running') return admitted;
      let result; let error;
      try { result = cleanResult(await boundedCall(() => adapter.execute({ connectorId: id, ...execution, credentials: Object.freeze(credentials), signal: controller.signal, idempotencyKey: run.id, ...(trusted.binding ? { binding: Object.freeze(json(trusted.binding)) } : {}) }), controller, adapterTimeoutMs), Object.values(credentials)); }
      catch (cause) { error = cause instanceof InterruptedOperation ? { code: cause.reason === 'TIMEOUT' ? 'CONNECTOR_TIMEOUT' : 'INTERRUPTED', message: 'Connector completion is uncertain. Approval was consumed; no automatic retry was made.' } : { code: 'CONNECTOR_EXECUTION_FAILED', message: 'The adapter failed or returned invalid data. Its raw error was suppressed. Approval was consumed; no automatic retry was made.' }; }
      credentials = undefined;
      return store.update(state => {
        const current = requireItem(state, 'connectorRuns', run.id);
        current.status = error ? (['CONNECTOR_TIMEOUT', 'INTERRUPTED'].includes(error.code) ? 'interrupted' : 'failed') : 'succeeded'; current.finishedAt = now();
        if (error) current.error = error; else current.result = result;
        audit(state, 'connector_execution', error ? 'Connector action failed' : 'Connector action completed', current.finishedAt, { connectorId: id, connectorRunId: current.id });
        return { execution: current };
      });
    })();
    const tracked = { promise: job, controller }; inFlight.add(tracked);
    try { return await job; } finally { inFlight.delete(tracked); trusted.signal?.removeEventListener('abort', abort); }
  }
  function scheduleFields(input, current) {
    object(input, ['title', 'goalId', 'kind', 'scheduledAt', 'everySeconds', 'enabled', 'goalMode', 'maxOccurrences']);
    if (input.enabled === true) fail(403, 'APPROVAL_REQUIRED', 'Use enableSchedule with an exact approved request.');
    if (input.enabled !== undefined) boolean(input.enabled);
    const kind = input.kind ?? current?.kind;
    if (!['at', 'every'].includes(kind)) fail(400, 'INVALID_INPUT', 'kind must be at or every.');
    const goalMode = input.goalMode ?? current?.goalMode ?? 'resume';
    if (!['resume', 'template'].includes(goalMode)) fail(400, 'INVALID_INPUT', 'goalMode must be resume or template.');
    if (goalMode === 'template' && kind !== 'every') fail(400, 'INVALID_INPUT', 'Fresh-goal template mode requires a recurring interval.');
    if (goalMode !== 'template' && input.maxOccurrences !== undefined) fail(400, 'INVALID_INPUT', 'maxOccurrences is only supported for explicit template mode.');
    const maxOccurrences = goalMode === 'template' ? integer(input.maxOccurrences ?? current?.maxOccurrences, 'maxOccurrences', 1, 1000) : null;
    const everySeconds = kind === 'every' ? integer(input.everySeconds ?? (current?.kind === 'every' ? current.everySeconds : undefined), 'everySeconds', 60, 31_536_000) : null;
    if (kind === 'at' && input.everySeconds !== undefined) fail(400, 'INVALID_INPUT', 'One-shot schedules do not accept everySeconds.');
    const scheduledAt = input.scheduledAt !== undefined ? timestamp(input.scheduledAt) : current?.scheduledAt ?? (kind === 'every' ? new Date(milliseconds() + everySeconds * 1000).toISOString() : timestamp(undefined));
    if ((input.scheduledAt !== undefined || !current) && Date.parse(scheduledAt) <= milliseconds()) fail(400, 'INVALID_INPUT', 'scheduledAt must be in the future.');
    return rejectSecrets({ title: text(input.title, 'title', 160, current?.title), goalId: identifier(input.goalId ?? current?.goalId, 'goalId'), kind, scheduledAt, everySeconds, goalMode, maxOccurrences });
  }
  function verifyGoal(state, goalId) { if (!state.goals?.some(goal => goal.id === goalId)) fail(404, 'GOAL_NOT_FOUND', 'Schedules must reference an existing local goal.'); }
  async function createSchedule(input) {
    const request = creation(input);
    return mutate(state => { const previous = previousCreation(state, 'schedules', request); if (previous) return { schedule: previous, duplicate: true }; const fields = scheduleFields(request.body); verifyGoal(state, fields.goalId); const at = now(); const schedule = { id: randomUUID(), ...fields, requestId: request.requestId, requestFingerprint: request.requestFingerprint, enabled: false, status: 'disabled', revision: 1, consent: null, lastRunId: null, createdAt: at, updatedAt: at }; state.capabilities.schedules.push(schedule); return { schedule }; });
  }
  async function updateSchedule(id, input) {
    return mutate(state => { const schedule = requireItem(state, 'schedules', id); const fields = scheduleFields(input, schedule); verifyGoal(state, fields.goalId); Object.assign(schedule, fields, { enabled: false, status: 'disabled', consent: null, revision: schedule.revision + 1, updatedAt: now() }); return { schedule }; });
  }
  function scheduleScope(schedule, state) {
    verifyGoal(state, schedule.goalId);
    const goal = state.goals.find(item => item.id === schedule.goalId);
    const definition = scheduleGoalDefinition(schedule, goal, state, goalDefinition);
    if (isTemplateSchedule(schedule)) assertTemplateDefinition(definition, state, fail);
    return { action: 'schedule.enable', resource: `schedule:${schedule.id}`, payload: { scheduleRevision: schedule.revision, title: schedule.title, goalId: schedule.goalId, goalDefinition: definition, executionContext: contextSnapshot, kind: schedule.kind, scheduledAt: schedule.scheduledAt, everySeconds: schedule.everySeconds, ...(isTemplateSchedule(schedule) ? { goalMode: 'template', standingApproval: templateApprovalDetails(schedule, state) } : {}) } };
  }
  function scheduleApprovalRequest(id) { const state = read(); return scheduleScope(requireItem(state, 'schedules', id), state); }
  async function enableSchedule(id, input) {
    object(input, ['approvalId']);
    return mutate(state => {
      const schedule = requireItem(state, 'schedules', id);
      if (schedule.enabled) fail(409, 'SCHEDULE_ALREADY_ENABLED', 'This schedule is already enabled.');
      if (schedule.kind === 'at' && schedule.lastRunId && state.capabilities.scheduleRuns.some(run => run.scheduleId === id && run.dueAt === schedule.scheduledAt)) fail(409, 'SCHEDULE_ENDED', 'This one-shot occurrence was already claimed. Choose a new future scheduledAt.');
      if (isTemplateSchedule(schedule)) {
        if (templateOccurrenceCount(schedule, state) >= schedule.maxOccurrences) fail(409, 'SCHEDULE_LIMIT_REACHED', 'The approved occurrence limit was reached. Edit the total limit and approve it explicitly to continue.');
        const previous = previousTemplateOccurrence(schedule, state);
        if (previous.status === 'blocked') fail(409, previous.error.code, previous.error.message);
      }
      const scope = scheduleScope(schedule, state);
      consumeApproval(state, input.approvalId, scope);
      schedule.enabled = true; schedule.status = 'active'; schedule.lastError = null; schedule.updatedAt = now(); schedule.consent = { approvalId: input.approvalId, grantedAt: schedule.updatedAt, definitionHash: capabilityPayloadHash(scope.payload.goalDefinition), executionContextHash: contextHash, ...(isTemplateSchedule(schedule) ? { goalMode: 'template', maxOccurrences: schedule.maxOccurrences } : {}) };
      return { schedule };
    });
  }
  function disableScheduleInTransaction(state, id) {
    ensureOpen(); const schedule = requireItem(state, 'schedules', id);
    schedule.enabled = false; schedule.status = 'disabled'; schedule.consent = null; schedule.updatedAt = now(); schedule.revision += 1;
    return { schedule };
  }
  async function disableSchedule(id) { return mutate(state => disableScheduleInTransaction(state, id)); }
  async function tick() {
    ensureOpen();
    if (!dispatchGoal) return { status: 'blocked', error: { code: 'DISPATCH_UNAVAILABLE', message: 'No local goal dispatcher is configured.' }, runs: [] };
    if (!read().capabilities.schedules.some(schedule => schedule.enabled && schedule.consent && Date.parse(schedule.scheduledAt) <= milliseconds())) return { status: 'complete', runs: [] };
    const controller = new AbortController();
    const job = (async () => {
      const claims = await mutate(state => {
        const at = milliseconds(); const runs = [];
        for (const schedule of state.capabilities.schedules) {
          if (!schedule.enabled || !schedule.consent || Date.parse(schedule.scheduledAt) > at) continue;
          const goal = state.goals?.find(item => item.id === schedule.goalId);
          const definition = goal ? scheduleGoalDefinition(schedule, goal, state, goalDefinition) : null;
          if (!goal || capabilityPayloadHash(definition) !== schedule.consent.definitionHash || schedule.consent.executionContextHash !== contextHash || (schedule.consent.goalMode ?? 'resume') !== (schedule.goalMode ?? 'resume') || (isTemplateSchedule(schedule) && schedule.maxOccurrences !== schedule.consent.maxOccurrences)) {
            schedule.enabled = false; schedule.status = 'blocked'; schedule.updatedAt = new Date(at).toISOString(); schedule.lastError = { code: 'GOAL_CHANGED', message: 'The goal, model, budget, inputs, or execution configuration changed. Review and approve the schedule again.' }; continue;
          }
          if (isTemplateSchedule(schedule) && templateOccurrenceCount(schedule, state) >= schedule.maxOccurrences) { schedule.enabled = false; schedule.status = 'ended'; schedule.updatedAt = new Date(at).toISOString(); continue; }
          const previous = isTemplateSchedule(schedule) ? previousTemplateOccurrence(schedule, state) : { status: 'ready' };
          if (previous.status === 'blocked') { schedule.enabled = false; schedule.status = 'blocked'; schedule.lastError = previous.error; schedule.updatedAt = new Date(at).toISOString(); continue; }
          const target = Date.parse(schedule.scheduledAt);
          const dueMs = schedule.kind === 'every' ? target + Math.floor((at - target) / (schedule.everySeconds * 1000)) * schedule.everySeconds * 1000 : target;
          const dueAt = new Date(dueMs).toISOString();
          const requestId = `schedule-${createHash('sha256').update(`${schedule.id}:${dueAt}`).digest('hex')}`;
          if (state.capabilities.scheduleRuns.some(run => run.requestId === requestId)) { schedule.enabled = false; schedule.status = 'blocked'; schedule.lastError = { code: 'OCCURRENCE_ALREADY_CLAIMED', message: 'This occurrence was already claimed. It will not be replayed.' }; continue; }
          const run = { id: randomUUID(), scheduleId: schedule.id, scheduleRevision: schedule.revision, goalId: schedule.goalId, expectedGoalDefinitionHash: schedule.consent.definitionHash, requestId, dueAt, status: 'dispatching', startedAt: new Date(at).toISOString(), finishedAt: null };
          if (isTemplateSchedule(schedule)) {
            Object.assign(run, { goalMode: 'template', sourceGoalId: schedule.goalId, missedOccurrences: Math.floor((dueMs - target) / (schedule.everySeconds * 1000)) });
            if (previous.status === 'busy') Object.assign(run, { goalId: null, previousGoalId: previous.goalId, status: 'skipped', finishedAt: new Date(at).toISOString(), skipReason: 'PREVIOUS_OCCURRENCE_RUNNING' });
            else { const fresh = createTemplateOccurrence(state, schedule, run, definition, new Date(at).toISOString()); run.goalId = fresh.id; run.conversationId = fresh.conversationId; run.occurrenceOrdinal = fresh.scheduleOccurrence.ordinal; }
          }
          state.capabilities.scheduleRuns.push(run); runs.push(run);
          schedule.lastRunId = run.id; schedule.updatedAt = new Date(at).toISOString();
          if (schedule.kind === 'at' || isTemplateSchedule(schedule) && templateOccurrenceCount(schedule, state) >= schedule.maxOccurrences) { schedule.enabled = false; schedule.status = 'ended'; }
          if (schedule.kind === 'every') schedule.scheduledAt = new Date(dueMs + schedule.everySeconds * 1000).toISOString();
        }
        return runs;
      });
      const runs = [];
      for (const claim of claims) {
        if (claim.status === 'skipped') { runs.push(claim); continue; }
        let outcome;
        try {
          const response = await boundedCall(() => dispatchGoal({ goalId: claim.goalId, requestId: claim.requestId, scheduleId: claim.scheduleId, dueAt: claim.dueAt, expectedGoalDefinitionHash: claim.expectedGoalDefinitionHash, scheduleClaim: { id: claim.id, scheduleId: claim.scheduleId, scheduleRevision: claim.scheduleRevision, goalId: claim.goalId, requestId: claim.requestId } }), controller, dispatchTimeoutMs);
          const status = response?.status ?? (response?.goal ? (['queued', 'running'].includes(response.goal.status) ? 'queued' : 'blocked') : undefined);
          if (!['queued', 'blocked', 'skipped', 'completed'].includes(status) || status === 'completed' && (!read().goals.find(goal => goal.id === claim.goalId)?.serviceTask || !response.serviceReceipt)) throw new Error('Dispatcher must return a durable admission outcome.');
          outcome = { status, ...(response?.goal?.runId ? { modelRunId: response.goal.runId } : {}), ...(response?.serviceReceipt ? { serviceReceipt: response.serviceReceipt } : {}), ...(['queued', 'completed'].includes(status) ? {} : { error: { code: 'GOAL_DISPATCH_BLOCKED', message: 'The goal could not be enqueued. Inspect the goal before approving another schedule.' } }) };
        } catch (cause) { outcome = { status: cause instanceof InterruptedOperation ? 'interrupted' : 'failed', error: { code: cause instanceof InterruptedOperation ? 'DISPATCH_INTERRUPTED' : 'GOAL_DISPATCH_FAILED', message: 'Goal enqueue was not acknowledged. No automatic retry was made.' } }; }
        runs.push(await store.update(state => {
          const run = requireItem(state, 'scheduleRuns', claim.id); Object.assign(run, outcome, { finishedAt: now() });
          const schedule = state.capabilities.schedules.find(item => item.id === run.scheduleId);
          if (schedule && schedule.revision === run.scheduleRevision && !['queued', 'completed'].includes(outcome.status)) { schedule.enabled = false; schedule.status = 'blocked'; schedule.lastError = outcome.error; }
          audit(state, 'schedule_dispatch', outcome.status === 'completed' ? 'Scheduled service check completed' : outcome.status === 'queued' ? 'Scheduled goal enqueued' : 'Scheduled goal not enqueued', run.finishedAt, { scheduleId: claim.scheduleId, goalId: claim.goalId });
          return run;
        }));
      }
      return { status: 'complete', runs };
    })();
    const tracked = { promise: job, controller }; inFlight.add(tracked);
    try { return await job; } finally { inFlight.delete(tracked); }
  }
  async function close() { closed = true; for (const job of inFlight) job.controller?.abort('SHUTDOWN'); await Promise.allSettled([...inFlight].map(job => job.promise)); }
  return {
    bootstrap, listSkills, listConnectors, listApprovals, listSchedules, listScheduleRuns, listConnectorRuns,
    getSkill: id => requireItem(read(), 'skills', id), getConnector: id => connectorView(requireItem(read(), 'connectors', id)), getSchedule: id => requireItem(read(), 'schedules', id), getApproval: id => listApprovals().find(item => item.id === id) ?? fail(404, 'NOT_FOUND', 'Approval not found.'),
    assertSafeMemory,
    getPromptSkills: () => listSkills().filter(item => item.enabled).slice(0, 20).map(({ id, name, instructions, revision }) => ({ id, name, instructions, revision })),
    createSkill, updateSkill, deleteSkill: id => remove('skills', id),
    createConnector, updateConnector, deleteConnector: id => remove('connectors', id), executeConnector, connectorApprovalRequest,
    // Server-only transaction seams: reuse the original approval consumption
    // and schedule retirement atomically with a business control. No HTTP/RPC.
    consumeApprovalInTransaction: (state, id, scope) => { ensureOpen(); return consumeApproval(state, id, scope); }, disableScheduleInTransaction,
    requestApproval, decideApproval, createSchedule, updateSchedule, deleteSchedule: id => remove('schedules', id), enableSchedule, disableSchedule, scheduleApprovalRequest, tick, close,
  };
}
