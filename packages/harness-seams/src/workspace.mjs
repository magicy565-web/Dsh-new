// ctx.workspace: deployment-configured workspaces and memberships.
//
// The composition is the source of truth for tenants and members: nothing is read
// from the network, and no business data lives here. Every lookup fails closed:
// an unknown workspace is invalid, a known workspace without a membership is
// forbidden, and the authoritative role always comes from the membership record
// (an actor header cannot escalate itself).
import { ERROR, HarnessError, SERVICE } from '../../harness-contracts/src/index.mjs';
import { provideService, serviceFromContext } from './ctx.mjs';

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SUBJECT = /^[^\s]{1,200}$/u;
const ROLES = Object.freeze(['admin', 'operator', 'viewer']);
const MAX_WORKSPACES = 100;
const MAX_MEMBERS = 200;

const invalid = message => new HarnessError(ERROR.workspaceInvalid, message);
const forbidden = message => new HarnessError(ERROR.workspaceForbidden, message);

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeWorkspaces(workspaces) {
  if (workspaces === undefined) return [];
  if (!Array.isArray(workspaces)) throw invalid('workspaces must be an array.');
  if (workspaces.length > MAX_WORKSPACES) throw invalid(`workspaces may contain at most ${MAX_WORKSPACES} entries.`);
  const ids = new Set();
  return workspaces.map((workspace, index) => {
    if (!isPlain(workspace)) throw invalid(`workspace ${index} must be an object.`);
    if (typeof workspace.id !== 'string' || !ID.test(workspace.id)) throw invalid(`workspace ${index}.id must match ${ID}.`);
    if (ids.has(workspace.id)) throw invalid(`duplicate workspace id ${JSON.stringify(workspace.id)}.`);
    ids.add(workspace.id);
    const name = workspace.name === undefined ? workspace.id : workspace.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 120) throw invalid(`workspace ${workspace.id}.name must be non-empty text.`);
    const members = workspace.members === undefined ? [] : workspace.members;
    if (!Array.isArray(members)) throw invalid(`workspace ${workspace.id}.members must be an array.`);
    if (members.length > MAX_MEMBERS) throw invalid(`workspace ${workspace.id} may have at most ${MAX_MEMBERS} members.`);
    const subjects = new Set();
    const normalized = members.map(member => {
      if (!isPlain(member)) throw invalid(`workspace ${workspace.id}: every member must be an object.`);
      if (typeof member.subject !== 'string' || !SUBJECT.test(member.subject)) throw invalid(`workspace ${workspace.id}: member.subject must be bounded text.`);
      if (subjects.has(member.subject)) throw invalid(`workspace ${workspace.id}: duplicate member ${JSON.stringify(member.subject)}.`);
      subjects.add(member.subject);
      if (typeof member.role !== 'string' || !ROLES.includes(member.role))
        throw invalid(`workspace ${workspace.id}: member role must be one of ${ROLES.join(', ')}.`);
      return Object.freeze({ subject: member.subject, role: member.role });
    });
    return Object.freeze({ id: workspace.id, name, members: Object.freeze(normalized) });
  });
}

export function createWorkspace({ workspaces = [], defaultWorkspaceId = null } = {}) {
  const registry = normalizeWorkspaces(workspaces);
  const byId = new Map(registry.map(workspace => [workspace.id, workspace]));
  if (defaultWorkspaceId !== null) {
    if (typeof defaultWorkspaceId !== 'string' || !byId.has(defaultWorkspaceId))
      throw invalid(`defaultWorkspaceId ${JSON.stringify(defaultWorkspaceId)} is not a configured workspace.`);
  }
  let closed = false;
  const assertOpen = () => { if (closed) throw invalid('The workspace service is closed.'); };
  const actorSubject = actor => {
    if (!isPlain(actor) || typeof actor.subject !== 'string' || !actor.subject) throw invalid('workspace operations require an actor with a subject.');
    return actor.subject;
  };

  const service = {
    /** Resolve the workspace + authoritative membership for an actor. */
    resolve(actor, { workspaceId } = {}) {
      assertOpen();
      const subject = actorSubject(actor);
      const requested = workspaceId ?? (typeof actor.workspaceId === 'string' && actor.workspaceId ? actor.workspaceId : defaultWorkspaceId);
      if (typeof requested !== 'string' || !byId.has(requested))
        throw invalid(`Unknown workspace ${JSON.stringify(requested)}; refusing to guess a tenant.`);
      const workspace = byId.get(requested);
      const member = workspace.members.find(entry => entry.subject === subject);
      if (!member) throw forbidden(`Actor ${JSON.stringify(subject)} is not a member of workspace ${JSON.stringify(requested)}.`);
      return Object.freeze({ workspaceId: workspace.id, workspaceName: workspace.name, subject, role: member.role });
    },

    /** Assert the resolved membership holds one of `roles` (deny by default). */
    assertRole(actor, roles, { workspaceId } = {}) {
      assertOpen();
      if (!Array.isArray(roles) || roles.length === 0 || roles.some(role => !ROLES.includes(role)))
        throw invalid(`assertRole requires a non-empty subset of ${ROLES.join(', ')}.`);
      const resolved = service.resolve(actor, { workspaceId });
      if (!roles.includes(resolved.role))
        throw forbidden(`Role ${resolved.role} may not perform this operation (requires one of ${roles.join(', ')}).`);
      return resolved;
    },

    /** Workspaces this actor belongs to; never leaks other members. */
    list(actor) {
      assertOpen();
      const subject = actorSubject(actor);
      return Object.freeze(registry
        .map(workspace => {
          const member = workspace.members.find(entry => entry.subject === subject);
          return member ? Object.freeze({ id: workspace.id, name: workspace.name, role: member.role }) : null;
        })
        .filter(Boolean));
    },

    close() { closed = true; },
  };
  return Object.freeze(service);
}

export const manifest = Object.freeze({
  id: 'workspace', version: '0.1.0', kind: 'provider', entry: './src/workspace.mjs', provides: ['workspace'], requires: [],
  configSchema: {
    type: 'object',
    properties: {
      defaultWorkspaceId: { type: 'string' },
      workspaces: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' }, members: { type: 'array' } },
          required: ['id'],
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
});

export function createWorkspaceProvider(options = {}) {
  let service;
  let registration;
  let disposer;
  return {
    id: 'workspace', manifest,
    async apply(ctx, config = {}) {
      if (!ctx || typeof ctx !== 'object') throw new TypeError('The workspace provider requires a kernel context object.');
      if (!registration) {
        const existing = serviceFromContext(ctx, SERVICE.workspace);
        if (existing !== undefined)
          throw new HarnessError(ERROR.pluginDuplicate, 'ctx.workspace is already registered by another provider.', { service: SERVICE.workspace });
      }
      if (!service) {
        service = createWorkspace({
          workspaces: options.workspaces ?? config?.workspaces,
          defaultWorkspaceId: options.defaultWorkspaceId ?? config?.defaultWorkspaceId ?? null,
        });
      }
      if (!registration) registration = provideService(ctx, SERVICE.workspace, service);
      if (!disposer) {
        let disposed = false;
        disposer = async () => {
          if (disposed) return;
          disposed = true;
          try { service.close(); } finally { await registration?.dispose?.(); }
        };
      }
      return disposer;
    },
  };
}

export async function apply(ctx, config = {}) {
  return createWorkspaceProvider(config).apply(ctx, config);
}
