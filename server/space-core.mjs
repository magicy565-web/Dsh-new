import { createHash, randomUUID } from 'node:crypto';
import { validateSpaceSources, resolveSpaceSources, requireCurrentSpaceSources, spaceSourceCatalog } from './space-sources.mjs';

/** Content extension beside the original Library in the same Store. No server, identity service or executor. */
export class SpaceError extends Error {
  constructor(status, code, message) { super(message); this.name = 'SpaceError'; this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new SpaceError(status, code, message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const BAD = new Set(['__proto__', 'prototype', 'constructor']);
const LIMITS = Object.freeze({ spaces: 50, nodes: 500, versions: 100, comments: 200, shares: 100, receipts: 10000, bytes: 16 * 1024 * 1024 });
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : plain(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const copy = value => structuredClone(value);
function json(value, seen = new Set(), depth = 0) {
  if (depth > 20) fail(400, 'SPACE_INPUT', 'Input nesting exceeds the limit.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return;
  if ((!Array.isArray(value) && !plain(value)) || seen.has(value) || Object.getOwnPropertySymbols(value).length) fail(400, 'SPACE_INPUT', 'Use plain JSON values.');
  seen.add(value);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (BAD.has(key) || descriptor.get || descriptor.set) fail(400, 'SPACE_INPUT', 'Unsafe JSON key.');
    json(value[key], seen, depth + 1);
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length) fail(400, 'SPACE_INPUT', 'Sparse arrays are not supported.');
  seen.delete(value);
}
function fields(value, allowed, required = allowed) {
  json(value);
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail(400, 'SPACE_INPUT', 'Use the exact Space input fields.');
}
function text(value, maximum, empty = false) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximum || !empty && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(400, 'SPACE_INPUT', 'Text is empty, unsafe or exceeds its byte limit.');
  return value;
}
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(400, 'SPACE_INPUT', 'Use an exact UUID.'); return value; }
function integer(value) { if (!Number.isSafeInteger(value) || value < 1) fail(400, 'SPACE_INPUT', 'Use a positive safe integer.'); return value; }
function subject(value) { return text(value, 128); }
function stamp(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(400, 'SPACE_INPUT', 'Use an exact UTC timestamp.'); return value; }
function room(array, limit) { if (array.length >= limit) fail(409, 'SPACE_LIMIT', 'The bounded content limit has been reached; no content was overwritten.'); }
function expect(actual, expected) { integer(expected); if (actual !== expected) fail(409, 'SPACE_REVISION_CONFLICT', 'The item changed. Keep your draft and reload before saving.'); }
const denied = () => fail(404, 'SPACE_NOT_FOUND', 'This Space or page is unavailable to the current member.');
const defaultData = () => ({ version: 1, spaces: [], receipts: [] });
function namespace(state, create = false) {
  if (!plain(state?.businessLibrary) || state.businessLibrary.version !== 1) fail(503, 'SPACE_LIBRARY_REQUIRED', 'Use the original Library Store.');
  if (state.workspaceSpaces === undefined && create) state.workspaceSpaces = defaultData();
  return state.workspaceSpaces ?? defaultData();
}
function pageVersion(node) { return node.versions.at(-1); }
function nodeSummary(node) {
  return { id: node.id, spaceId: node.spaceId, kind: node.kind, parentId: node.parentId, title: node.kind === 'page' ? pageVersion(node).title : node.title, revision: node.revision, version: node.kind === 'page' ? pageVersion(node).version : null, archived: node.archived, updatedAt: node.updatedAt };
}
function spaceSummary(space) { return { id: space.id, name: space.name, revision: space.revision, createdAt: space.createdAt, updatedAt: space.updatedAt }; }
function findSpace(data, workspaceId, id) { return data.spaces.find(space => space.id === id && space.workspaceId === workspaceId) ?? denied(); }
function findNode(space, id) { return space.nodes.find(node => node.id === id && node.spaceId === space.id) ?? denied(); }
function assertTree(space, nodeId, parentId) {
  const seen = new Set([nodeId]);
  let id = parentId, depth = 0;
  while (id !== null) {
    if (seen.has(id) || ++depth > 20) fail(409, 'SPACE_PARENT_CONFLICT', 'The parent would create a cycle or exceed the nesting limit.');
    seen.add(id); const parent = findNode(space, id);
    if (parent.kind !== 'folder') fail(409, 'SPACE_PARENT_NOT_FOLDER', 'Only a folder may contain pages or other folders.');
    if (parent.archived) fail(409, 'SPACE_PARENT_ARCHIVED', 'Restore the parent before using it.');
    id = parent.parentId;
  }
}

/** Called on service creation and before/after every transaction; no startup rewrite. */
export function validateSpaceLibrary(state) {
  const data = namespace(state);
  fields(data, ['version', 'spaces', 'receipts']);
  if (data.version !== 1 || !Array.isArray(data.spaces) || data.spaces.length > LIMITS.spaces || !Array.isArray(data.receipts) || data.receipts.length > LIMITS.receipts || Buffer.byteLength(JSON.stringify(data)) > LIMITS.bytes) fail(503, 'SPACE_STORAGE_INVALID', 'Invalid or oversized Space storage.');
  const ids = new Set();
  for (const space of data.spaces) {
    fields(space, ['id', 'workspaceId', 'owner', 'name', 'revision', 'shares', 'nodes', 'createdAt', 'updatedAt']);
    uuid(space.id); subject(space.workspaceId); subject(space.owner); text(space.name, 200); integer(space.revision); stamp(space.createdAt); stamp(space.updatedAt);
    if (ids.has(space.id)) fail(503, 'SPACE_STORAGE_INVALID', 'Duplicate Space identity.'); ids.add(space.id);
    if (!Array.isArray(space.shares) || space.shares.length > LIMITS.shares || !Array.isArray(space.nodes) || space.nodes.length > LIMITS.nodes) fail(503, 'SPACE_STORAGE_INVALID', 'Invalid content collections.');
    const shared = new Set();
    for (const share of space.shares) {
      fields(share, ['subject', 'role', 'expiresAt']); subject(share.subject);
      if (shared.has(share.subject) || share.subject === space.owner || !['viewer', 'editor'].includes(share.role)) fail(503, 'SPACE_STORAGE_INVALID', 'Invalid membership grant.');
      if (share.expiresAt !== null) stamp(share.expiresAt); shared.add(share.subject);
    }
    const nodes = new Set();
    for (const node of space.nodes) {
      const common = ['id', 'spaceId', 'kind', 'parentId', 'revision', 'archived', 'createdAt', 'updatedAt'];
      fields(node, [...common, ...(node.kind === 'page' ? ['versions', 'comments'] : ['title'])]);
      uuid(node.id); if (nodes.has(node.id) || node.spaceId !== space.id || !['page', 'folder'].includes(node.kind) || typeof node.archived !== 'boolean') fail(503, 'SPACE_STORAGE_INVALID', 'Invalid node.');
      nodes.add(node.id); integer(node.revision); if (node.parentId !== null) uuid(node.parentId); stamp(node.createdAt); stamp(node.updatedAt);
      if (node.kind === 'folder') { text(node.title, 200); continue; }
      if (!Array.isArray(node.versions) || !node.versions.length || node.versions.length > LIMITS.versions || !Array.isArray(node.comments) || node.comments.length > LIMITS.comments) fail(503, 'SPACE_STORAGE_INVALID', 'Invalid page history.');
      for (const [index, version] of node.versions.entries()) {
        fields(version, ['version', 'title', 'content', 'sha256', 'createdBy', 'createdAt', 'restoredFrom', 'sources'], ['version', 'title', 'content', 'sha256', 'createdBy', 'createdAt', 'restoredFrom']);
        if (Object.hasOwn(version, 'sources')) validateSpaceSources(version.sources, fail);
        if (version.version !== index + 1 || version.sha256 !== digest({ title: version.title, content: version.content, ...(Object.hasOwn(version, 'sources') ? { sources: version.sources } : {}) })) fail(503, 'SPACE_STORAGE_INVALID', 'Page version integrity failure.');
        text(version.title, 200); text(version.content, 65536, true); subject(version.createdBy); stamp(version.createdAt);
        if (version.restoredFrom !== null && (!Number.isSafeInteger(version.restoredFrom) || version.restoredFrom < 1 || version.restoredFrom >= version.version)) fail(503, 'SPACE_STORAGE_INVALID', 'Invalid restored version.');
      }
      const comments = new Set();
      for (const comment of node.comments) {
        fields(comment, ['id', 'version', 'body', 'createdBy', 'createdAt']); uuid(comment.id); integer(comment.version); text(comment.body, 4000); subject(comment.createdBy); stamp(comment.createdAt);
        if (comments.has(comment.id) || comment.version > node.versions.length) fail(503, 'SPACE_STORAGE_INVALID', 'Invalid comment.'); comments.add(comment.id);
      }
    }
    for (const node of space.nodes) {
      const seen = new Set([node.id]); let parent = node.parentId, depth = 0;
      while (parent !== null) {
        if (seen.has(parent) || ++depth > 20 || !nodes.has(parent)) fail(503, 'SPACE_STORAGE_INVALID', 'Invalid saved hierarchy.');
        seen.add(parent); const item = findNode(space, parent);
        if (item.kind !== 'folder') fail(503, 'SPACE_STORAGE_INVALID', 'A page cannot be a hierarchy parent.');
        parent = item.parentId;
      }
    }
  }
  const requests = new Set();
  for (const row of data.receipts) {
    fields(row, ['workspaceId', 'subject', 'requestId', 'fingerprint', 'spaceId', 'entityId', 'operation', 'committedRevision']);
    subject(row.workspaceId); subject(row.subject); uuid(row.requestId); uuid(row.spaceId); uuid(row.entityId); integer(row.committedRevision);
    if (!/^[a-f0-9]{64}$/u.test(row.fingerprint) || !['createSpace', 'createNode', 'savePage', 'restorePage', 'moveNode', 'archiveNode', 'comment', 'share', 'revoke'].includes(row.operation)) fail(503, 'SPACE_STORAGE_INVALID', 'Invalid operation receipt.');
    const key = JSON.stringify([row.workspaceId, row.subject, row.requestId]); if (requests.has(key)) fail(503, 'SPACE_STORAGE_INVALID', 'Duplicate operation receipt.'); requests.add(key);
    const space = data.spaces.find(item => item.id === row.spaceId && item.workspaceId === row.workspaceId);
    if (!space || row.entityId !== space.id && !space.nodes.some(node => node.id === row.entityId)) fail(503, 'SPACE_STORAGE_INVALID', 'Receipt target is missing.');
  }
  return true;
}

/**
 * access is the ORIGINAL createAccessControl instance; members is its original
 * reviewed Map. No role/tenant/Session can be supplied in a browser command.
 * This package stays unmounted and disabled until its original Host is reviewed.
 */
export function createSpaceService({ store, access = null, workspaceId = null, members = null, enabled = false, clock = Date.now, medusaSource = null } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.update !== 'function') throw new TypeError('The original Store is required.');
  if (typeof enabled !== 'boolean') throw new TypeError('Space enablement must be explicit.');
  if (enabled && (!access || typeof access.nativeSessionById !== 'function' || !(members instanceof Map) || typeof workspaceId !== 'string' || !workspaceId)) throw new TypeError('Use the original enterprise AccessControl, members and workspace binding.');
  if (medusaSource?.binding === null) medusaSource = null; // An ordinary unconfigured plugin cannot prevent Space startup.
  if (medusaSource !== null && (!medusaSource || medusaSource.binding?.workspaceId !== workspaceId || typeof medusaSource.list !== 'function' || typeof medusaSource.read !== 'function' || typeof medusaSource.assertCurrent !== 'function')) throw new TypeError('Use an original Host Medusa source bound to this enterprise.');
  validateSpaceLibrary(store.read());
  const time = () => new Date(clock()).toISOString();
  function who(context) {
    if (!enabled) fail(503, 'SPACE_UNCONFIGURED', 'Space has not been enabled on the original enterprise Host.');
    const current = access.nativeSessionById(context?.session?.id);
    if (!current || current.workspaceId !== workspaceId || current.subject !== context.subject || current.role !== context.role || members.get(current.subject) !== current.role || clock() >= current.expiresAt) fail(401, 'SPACE_SESSION_REQUIRED', 'The original enterprise Session expired, changed or was revoked.');
    return current;
  }
  const externalActor = context => { const actor = who(context); return { subject: actor.subject, role: actor.role, workspaceId, session: { id: actor.id } }; };
  function checkExternalAuthority(context, sources) {
    if (!medusaSource || !sources.some(row => row.kind === 'medusa-product' && row.sourceId === medusaSource.binding.sourceId)) return;
    try { if (medusaSource.assertCurrent(externalActor(context)) !== true) throw Error(); }
    catch { fail(403, 'SPACE_SOURCE_AUTH_REQUIRED', 'The original Host source authorization changed.'); }
  }
  async function externalResolution(context, sources, requireCurrent = false) {
    const output = await Promise.all(sources.filter(row => row.kind === 'medusa-product').map(async reference => {
      let row = { reference: copy(reference), status: 'unavailable' };
      if (medusaSource && reference.sourceId === medusaSource.binding.sourceId) {
        checkExternalAuthority(context, [reference]);
        try {
          const current = await medusaSource.read(reference.id, externalActor(context));
          checkExternalAuthority(context, [reference]);
          if (current) {
            validateSpaceSources([current.reference], fail);
            row = current.reference.sourceId === reference.sourceId && current.reference.id === reference.id && current.reference.kind === reference.kind && current.reference.revision === reference.revision && current.reference.sourceHash === reference.sourceHash
              ? { reference: copy(reference), status: 'current', title: current.title, referenceOnly: false, checkedAt: time(), consistency: 'remote-point-in-time' } : { reference: copy(reference), status: 'updated' };
          }
        } catch (error) { checkExternalAuthority(context, [reference]); }
      }
      if (requireCurrent && row.status !== 'current') fail(409, 'SPACE_SOURCE_CHANGED', 'A selected Medusa approval or source binding changed. Reload sources.');
      return row;
    }));
    return output;
  }
  function permit(space, actor, mode = 'read') {
    if (space.workspaceId !== workspaceId) return denied();
    const share = space.shares.find(item => item.subject === actor.subject && (item.expiresAt === null || Date.parse(item.expiresAt) > clock()));
    const owner = actor.subject === space.owner;
    if (!owner && !share || mode === 'owner' && !owner || mode !== 'read' && (!['admin', 'operator'].includes(actor.role) || !owner && share.role !== 'editor')) return denied();
    return true;
  }
  function snapshot(context, spaceId, mode = 'read') {
    const actor = who(context), state = store.read(); validateSpaceLibrary(state);
    const data = namespace(state), space = findSpace(data, workspaceId, uuid(spaceId)); permit(space, actor, mode);
    return { actor, data, space };
  }
  function envelope(context, spaceId, body, status = 200, mode = 'read', finalCheck = () => {}) {
    context = { subject: context?.subject, role: context?.role, session: { id: context?.session?.id } };
    const { space } = snapshot(context, spaceId, mode), revision = space.revision;
    return Object.freeze({ status, body: copy(body), assertCurrent() {
      const fresh = snapshot(context, spaceId, mode); expect(fresh.space.revision, revision); finalCheck();
    } });
  }
  async function write(context, operation, spaceId, nodeId, input, allowed, required, mode, mutate) {
    fields(input, ['requestId', ...allowed], ['requestId', ...required]); uuid(input.requestId);
    if (Buffer.byteLength(JSON.stringify(input)) > 100000) fail(413, 'SPACE_INPUT_TOO_LARGE', 'The admitted command exceeds 100 KiB.');
    // Detach before awaiting: caller mutation cannot change the admitted command.
    context = { subject: context?.subject, role: context?.role, session: { id: context?.session?.id } };
    const body = copy(input), actor = who(context);
    const fingerprint = digest({ operation, spaceId, nodeId, body });
    if (!['admin', 'operator'].includes(actor.role)) denied();
    const external = Object.hasOwn(body, 'sources') ? (validateSpaceSources(body.sources, fail), body.sources.filter(row => row.kind === 'medusa-product')) : [];
    if (operation === 'createNode' && body.kind === 'folder' && Object.hasOwn(body, 'sources')) fail(400, 'SPACE_INPUT', 'Folders cannot have page sources.');
    const ownReceipt = () => namespace(store.read()).receipts.some(row => row.workspaceId === workspaceId && row.subject === actor.subject && row.requestId === body.requestId && row.fingerprint === fingerprint);
    if (external.length && !ownReceipt()) {
      try { await externalResolution(context, external, true); }
      catch (error) { if (!ownReceipt()) throw error; }
    }
    const result = await store.update(state => {
      const live = who(context); validateSpaceLibrary(state); const data = namespace(state, true);
      const prior = data.receipts.find(row => row.workspaceId === workspaceId && row.subject === live.subject && row.requestId === body.requestId);
      let space = spaceId === null ? null : findSpace(data, workspaceId, uuid(spaceId));
      if (space) permit(space, live, mode);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail(409, 'SPACE_IDEMPOTENCY_CONFLICT', 'This requestId already belongs to a different command.');
        space ??= findSpace(data, workspaceId, prior.spaceId); permit(space, live, mode);
        return { receipt: copy(prior), replayed: true };
      }
      room(data.receipts, LIMITS.receipts);
      const node = nodeId === null ? null : findNode(space, uuid(nodeId));
      const output = mutate({ state, data, space, node, actor: live, body, at: time() });
      if (space) { space.revision++; space.updatedAt = time(); }
      const receipt = { workspaceId, subject: live.subject, requestId: body.requestId, fingerprint, spaceId: output.spaceId, entityId: output.id, operation, committedRevision: output.revision };
      data.receipts.push(receipt); validateSpaceLibrary(state);
      return { receipt, replayed: false };
    });
    if (external.length && !result.replayed) {
      try { await externalResolution(context, external, true); }
      catch { fail(409, 'SPACE_RESPONSE_CHANGED', 'The write committed but the Medusa source changed before confirmation. Reconcile the original requestId.'); }
    }
    return envelope(context, result.receipt.spaceId, { operation: result }, result.replayed ? 200 : operation === 'createSpace' || operation === 'createNode' || operation === 'comment' ? 201 : 200, mode);
  }
  function editable(node) { if (node.archived) fail(409, 'SPACE_ARCHIVED', 'Restore this item before editing.'); }
  function page(node) { if (node.kind !== 'page') fail(400, 'SPACE_PAGE_REQUIRED', 'This operation requires a page.'); }
  function append(node, title, content, actor, at, restoredFrom = null, sources = undefined) {
    room(node.versions, LIMITS.versions); text(title, 200); text(content, 65536, true);
    const pins = sources === undefined ? {} : { sources: copy(sources) };
    node.versions.push({ version: node.versions.length + 1, title, content, ...pins, sha256: digest({ title, content, ...pins }), createdBy: actor.subject, createdAt: at, restoredFrom });
    node.revision++; node.updatedAt = at;
  }
  return Object.freeze({
    status() { return { configured: enabled, modelAccess: false, externalDelegation: false, storage: 'original-store-library-adjacent', scope: 'enterprise-space-content-v1' }; },
    list(context) {
      const actor = who(context), state = store.read(); validateSpaceLibrary(state);
      const allowed = namespace(state).spaces.filter(space => { try { return permit(space, actor); } catch (error) { if (error instanceof SpaceError && error.status === 404) return false; throw error; } });
      const captured = digest(allowed.map(spaceSummary)), body = { spaces: allowed.map(spaceSummary) };
      const pinned = { subject: context.subject, role: context.role, session: { id: context.session.id } };
      return Object.freeze({ status: 200, body, assertCurrent: () => {
        const currentActor = who(pinned), currentState = store.read(); validateSpaceLibrary(currentState);
        const visible = namespace(currentState).spaces.filter(space => { try { return permit(space, currentActor); } catch (error) { if (error instanceof SpaceError && error.status === 404) return false; throw error; } });
        if (digest(visible.map(spaceSummary)) !== captured) fail(409, 'SPACE_REVISION_CONFLICT', 'Space membership or content changed. Reload.');
      } });
    },
    read(context, spaceId) {
      const { actor, space } = snapshot(context, spaceId);
      const body = { space: { ...spaceSummary(space), canEdit: ['admin', 'operator'].includes(actor.role) && (space.owner === actor.subject || space.shares.some(share => share.subject === actor.subject && share.role === 'editor' && (share.expiresAt === null || Date.parse(share.expiresAt) > clock()))), canShare: space.owner === actor.subject && ['admin', 'operator'].includes(actor.role), nodes: space.nodes.map(nodeSummary) } };
      if (space.owner === actor.subject) body.space.shares = copy(space.shares);
      return envelope(context, spaceId, body);
    },
    page(context, spaceId, nodeId, version = null) {
      context = { subject: context?.subject, role: context?.role, session: { id: context?.session?.id } };
      const { space } = snapshot(context, spaceId), node = findNode(space, uuid(nodeId)); page(node);
      const selected = version === null ? pageVersion(node) : node.versions[integer(version) - 1]; if (!selected) denied();
      const pins = selected.sources ?? [];
      const deliver = external => {
        expect(snapshot(context, spaceId).space.revision, space.revision);
        const local = resolveSpaceSources(store.read(), pins), captured = digest(local);
        const resolved = local.map(row => row.reference.kind === 'medusa-product' ? external.find(item => item.reference.id === row.reference.id) ?? row : row);
        return envelope(context, spaceId, { page: { ...nodeSummary(node), selected: copy(selected), sourceResolution: resolved, history: node.versions.map(({ content, sources, ...metadata }) => metadata), comments: copy(node.comments) } }, 200, 'read', () => {
          if (digest(resolveSpaceSources(store.read(), pins)) !== captured) fail(409, 'SPACE_SOURCE_CHANGED', 'A referenced Library source changed before delivery. Reload the page.');
          checkExternalAuthority(context, pins);
        });
      };
      return pins.some(row => row.kind === 'medusa-product') ? externalResolution(context, pins).then(deliver) : deliver([]);
    },
    operation(context, requestId) {
      const actor = who(context); uuid(requestId);
      const state = store.read(); validateSpaceLibrary(state);
      const receipt = namespace(state).receipts.find(row => row.workspaceId === workspaceId && row.subject === actor.subject && row.requestId === requestId);
      if (!receipt) fail(404, 'SPACE_OPERATION_PENDING', 'No committed receipt is visible yet. The original request may still be pending; keep reconciling it.');
      snapshot(context, receipt.spaceId);
      return envelope(context, receipt.spaceId, { operation: { receipt: copy(receipt), replayed: true } });
    },
    sources(context, spaceId, query) {
      context = { subject: context?.subject, role: context?.role, session: { id: context?.session?.id } };
      const capturedSpace = snapshot(context, spaceId).space.revision; fields(query, ['kind', 'q', 'offset'], ['kind']);
      if (query.kind === 'medusa-product') {
        if (query.q !== undefined && (typeof query.q !== 'string' || Buffer.byteLength(query.q) > 200) || query.offset !== undefined && (typeof query.offset !== 'string' || !/^(0|[1-9][0-9]{0,3})$/u.test(query.offset))) fail(400, 'SPACE_SOURCE_QUERY', 'Use a bounded source query.');
        if (!medusaSource) fail(503, 'SPACE_MEDUSA_UNCONFIGURED', 'A reviewed native Medusa source is not configured on this original Host.');
        const actor = externalActor(context);
        return medusaSource.list(query, actor).then(value => {
          expect(snapshot(context, spaceId).space.revision, capturedSpace);
          return envelope(context, spaceId, value, 200, 'read', () => {
            try { if (medusaSource.assertCurrent(externalActor(context)) !== true) throw Error(); }
            catch { fail(403, 'SPACE_SOURCE_AUTH_REQUIRED', 'The original Medusa source authorization changed.'); }
          });
        }).catch(error => { if (error instanceof SpaceError) throw error; fail(503, 'SPACE_MEDUSA_UNAVAILABLE', 'The reviewed Medusa source could not be read.'); });
      }
      const value = spaceSourceCatalog(store.read(), query, fail), captured = digest(value);
      return envelope(context, spaceId, value, 200, 'read', () => {
        if (digest(spaceSourceCatalog(store.read(), query, fail)) !== captured) fail(409, 'SPACE_SOURCE_CHANGED', 'The original Library changed before delivery. Reload sources.');
      });
    },
    create(context, body) {
      return write(context, 'createSpace', null, null, body, ['name'], ['name'], 'owner', ({ data, actor, body, at }) => {
        room(data.spaces, LIMITS.spaces); text(body.name, 200);
        const space = { id: randomUUID(), workspaceId, owner: actor.subject, name: body.name, revision: 1, shares: [], nodes: [], createdAt: at, updatedAt: at }; data.spaces.push(space);
        return { id: space.id, spaceId: space.id, revision: 1 };
      });
    },
    createNode(context, spaceId, body) {
      return write(context, 'createNode', spaceId, null, body, ['kind', 'parentId', 'title', 'content', 'sources'], ['kind', 'parentId', 'title'], 'write', ({ state, space, actor, body, at }) => {
        room(space.nodes, LIMITS.nodes); if (!['page', 'folder'].includes(body.kind)) fail(400, 'SPACE_INPUT', 'Use page or folder.'); text(body.title, 200);
        if (body.parentId !== null) uuid(body.parentId); const id = randomUUID(); assertTree(space, id, body.parentId);
        if (body.kind === 'folder' && (Object.hasOwn(body, 'content') || Object.hasOwn(body, 'sources'))) fail(400, 'SPACE_INPUT', 'Folders cannot have page content.');
        const node = { id, spaceId, kind: body.kind, parentId: body.parentId, revision: 1, archived: false, createdAt: at, updatedAt: at };
        if (body.kind === 'folder') node.title = body.title;
        else { node.versions = []; node.comments = []; node.revision = 0; append(node, body.title, body.content ?? '', actor, at, null, Object.hasOwn(body, 'sources') ? requireCurrentSpaceSources(state, body.sources, fail) : undefined); }
        space.nodes.push(node); return node;
      });
    },
    savePage(context, spaceId, nodeId, body) {
      return write(context, 'savePage', spaceId, nodeId, body, ['expectedRevision', 'title', 'content', 'sources'], ['expectedRevision', 'title', 'content'], 'write', ({ state, node, actor, body, at }) => {
        page(node); editable(node); expect(node.revision, body.expectedRevision); append(node, body.title, body.content, actor, at, null, Object.hasOwn(body, 'sources') ? requireCurrentSpaceSources(state, body.sources, fail) : pageVersion(node).sources); return node;
      });
    },
    restorePage(context, spaceId, nodeId, body) {
      return write(context, 'restorePage', spaceId, nodeId, body, ['expectedRevision', 'version'], ['expectedRevision', 'version'], 'write', ({ node, actor, body, at }) => {
        page(node); editable(node); expect(node.revision, body.expectedRevision); const old = node.versions[integer(body.version) - 1]; if (!old) denied();
        append(node, old.title, old.content, actor, at, old.version, old.sources); return node;
      });
    },
    moveNode(context, spaceId, nodeId, body) {
      return write(context, 'moveNode', spaceId, nodeId, body, ['expectedRevision', 'parentId'], ['expectedRevision', 'parentId'], 'write', ({ space, node, body, at }) => {
        editable(node); expect(node.revision, body.expectedRevision); if (body.parentId !== null) uuid(body.parentId); assertTree(space, node.id, body.parentId);
        node.parentId = body.parentId; node.revision++; node.updatedAt = at; return node;
      });
    },
    archiveNode(context, spaceId, nodeId, body) {
      return write(context, 'archiveNode', spaceId, nodeId, body, ['expectedRevision', 'archived'], ['expectedRevision', 'archived'], 'write', ({ space, node, body, at }) => {
        expect(node.revision, body.expectedRevision); if (typeof body.archived !== 'boolean') fail(400, 'SPACE_INPUT', 'Use an explicit archived Boolean.');
        if (body.archived && space.nodes.some(item => item.parentId === node.id && !item.archived)) fail(409, 'SPACE_CHILDREN_ACTIVE', 'Archive or move children before archiving their parent.');
        if (!body.archived) assertTree(space, node.id, node.parentId); node.archived = body.archived; node.revision++; node.updatedAt = at; return node;
      });
    },
    comment(context, spaceId, nodeId, body) {
      return write(context, 'comment', spaceId, nodeId, body, ['expectedRevision', 'version', 'body'], ['expectedRevision', 'version', 'body'], 'write', ({ node, actor, body, at }) => {
        page(node); editable(node); expect(node.revision, body.expectedRevision); integer(body.version); if (body.version > node.versions.length) fail(409, 'SPACE_REVISION_CONFLICT', 'The selected version does not exist.');
        text(body.body, 4000); room(node.comments, LIMITS.comments); node.comments.push({ id: randomUUID(), version: body.version, body: body.body, createdBy: actor.subject, createdAt: at }); node.revision++; node.updatedAt = at; return node;
      });
    },
    share(context, spaceId, body) {
      return write(context, 'share', spaceId, null, body, ['expectedRevision', 'subject', 'role', 'expiresAt'], ['expectedRevision', 'subject', 'role', 'expiresAt'], 'owner', ({ space, body }) => {
        expect(space.revision, body.expectedRevision); subject(body.subject);
        if (body.subject === space.owner || !members.has(body.subject) || !['viewer', 'editor'].includes(body.role) || body.role === 'editor' && !['admin', 'operator'].includes(members.get(body.subject))) fail(400, 'SPACE_SHARE_INVALID', 'Select an existing member and a role allowed by original enterprise access.');
        if (body.expiresAt !== null && Date.parse(stamp(body.expiresAt)) <= clock()) fail(400, 'SPACE_SHARE_INVALID', 'Select a future expiry.');
        const existing = space.shares.find(item => item.subject === body.subject); const share = { subject: body.subject, role: body.role, expiresAt: body.expiresAt };
        if (existing) Object.assign(existing, share); else { room(space.shares, LIMITS.shares); space.shares.push(share); }
        return { id: space.id, spaceId, revision: space.revision + 1 };
      });
    },
    revoke(context, spaceId, body) {
      return write(context, 'revoke', spaceId, null, body, ['expectedRevision', 'subject'], ['expectedRevision', 'subject'], 'owner', ({ space, body }) => {
        expect(space.revision, body.expectedRevision); subject(body.subject); if (body.subject === space.owner) fail(400, 'SPACE_SHARE_INVALID', 'Owner transfer is not provided by this operation.');
        space.shares = space.shares.filter(item => item.subject !== body.subject); return { id: space.id, spaceId, revision: space.revision + 1 };
      });
    },
  });
}
