import { createHash } from 'node:crypto';
import { AgentHttpError } from './auth.mjs';
import { artifactNameValid } from './store.mjs';
import { createWorkspaceBusinessReads } from '../../packages/workspace-procurement/src/workspace.mjs';

const fail = (status, code) => { throw new AgentHttpError(status, code, { code }); };
// Host-internal client only. Identity comes from the original conversation
// actor, never request JSON. Existing principal scopes remain mandatory.
export function createAgentSessionReadonlyClient({ identity, auth, engine, store, instanceId, closing }) {
  identity = Object.freeze({ ...identity });
  const first = auth.sessionReadActor(identity);
  const fingerprint = createHash('sha256').update(JSON.stringify([
    instanceId, identity.sessionId ?? null, first.uiPermissionFingerprint,
  ])).digest('hex');
  function authorize(signal) {
    signal?.throwIfAborted();
    if (closing()) fail(503, 'AGENT_SESSION_READ_STOPPING');
    const current = auth.sessionReadActor(identity);
    if (current.uiPermissionFingerprint !== first.uiPermissionFingerprint) fail(403, 'AGENT_BINDING_REVOKED');
    return current;
  }
  async function request(method, suffix, body, signal) {
    const actor = authorize(signal);
    if (method !== 'GET' || body !== undefined || typeof suffix !== 'string' || !suffix.startsWith('/tasks')) fail(403, 'SESSION_READONLY_ROUTE_REFUSED');
    const url = new URL('https://host-internal.invalid' + suffix);
    let value;
    if (url.pathname === '/tasks') {
      const keys = [...url.searchParams.keys()];
      if (keys.some(k => !['limit','status','withArtifacts'].includes(k) || url.searchParams.getAll(k).length !== 1)) fail(400, 'SESSION_READONLY_INPUT_REFUSED');
      const limit = Number(url.searchParams.get('limit') ?? 20), status = url.searchParams.get('status') || undefined;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || status && !['queued','running','done','failed','interrupted','cancelled'].includes(status)) fail(400, 'SESSION_READONLY_INPUT_REFUSED');
      value = engine.list(actor, { limit, status, withArtifacts: url.searchParams.get('withArtifacts') === '1' });
    } else {
      const match = url.pathname.match(/^\/tasks\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,127})(?:\/(events|artifacts)(?:\/([^/]+))?)?$/);
      if (!match || !engine.find(match[1], actor)) fail(404, 'AGENT_TASK_NOT_FOUND');
      const taskId = match[1];
      await engine.project(taskId);
      authorize(signal);
      if (!engine.find(taskId, actor)) fail(404, 'AGENT_TASK_NOT_FOUND');
      if (!match[2] && !url.search) value = store.getTask(taskId, actor);
      else if (match[2] === 'events' && !match[3] && url.search === '?format=json') value = store.events(taskId, 0);
      else if (match[2] === 'artifacts' && match[3] && !url.search) {
        const name = decodeURIComponent(match[3]);
        if (!artifactNameValid(name) || !/\.(md|txt)$/.test(name)) fail(400, 'SESSION_READONLY_ARTIFACT_REFUSED');
        const artifact = await store.readArtifact(taskId, name);
        if (!artifact) fail(404, 'AGENT_ARTIFACT_NOT_FOUND');
        value = artifact.data.toString('utf8');
      } else fail(403, 'SESSION_READONLY_ROUTE_REFUSED');
      if (!engine.find(taskId, authorize(signal))) fail(404, 'AGENT_TASK_NOT_FOUND');
    }
    authorize(signal);
    if (Buffer.byteLength(JSON.stringify(value)) > 2_000_000) fail(413, 'SESSION_READONLY_RECEIPT_LIMIT');
    return value;
  }
  const reads = createWorkspaceBusinessReads(request);
  return Object.freeze({ readOnlySession: true, bindingFingerprint: fingerprint,
    async bindingIdentity(signal) {
      const actor = authorize(signal);
      return { subject: actor.subject, workspaceId: actor.workspaceId, role: actor.role, scopes: actor.scopes, instanceId };
    }, ...Object.fromEntries(Object.entries(reads).map(([name, read]) => [name, async (...args) => {
      authorize(args[1]);
      const value = await read(...args);
      const actor = authorize(args[1]);
      const taskIds = new Set([...(value.tasks || []).map(task => task.taskId),
        ...(value.task ? [value.task.taskId] : []),
        ...(value.sources || []).filter(source => source.kind === 'task').map(source => source.recordId)]);
      for (const taskId of taskIds) if (!engine.find(taskId, actor)) fail(404, 'AGENT_TASK_NOT_FOUND');
      return value;
    }])) });
}
