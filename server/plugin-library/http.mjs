import { randomUUID } from 'node:crypto';
import { DEFAULT_PLUGIN_ROOT } from '../workspace-plugin-config.mjs';
import { readPluginInventory } from './inventory.mjs';
import { openPluginControlStore, controlDigest } from './control-store.mjs';
import { publisherTrust, verifyReleaseEnvelope, releaseSummary } from './releases.mjs';

const prefix = '/api/plugin-library';
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
function fields(body, required, optional = []) {
  return body && Object.getPrototypeOf(body) === Object.prototype && required.every(key => Object.hasOwn(body, key)) && Object.keys(body).every(key => [...required, ...optional].includes(key));
}

/** Mounted only at the original authenticated, signed-body-checked Host seam. */
export async function createPluginLibraryModule({ ApiError, workspaceId, access = null, environment = {}, backendSelection = null, root = DEFAULT_PLUGIN_ROOT, clock = Date.now } = {}) {
  const enabled = environment.WORKSPACE_PLUGIN_LIBRARY_ENABLED;
  if (enabled === undefined || enabled === '0') return null;
  if (enabled !== '1') throw new TypeError('WORKSPACE_PLUGIN_LIBRARY_ENABLED must be 0 or 1.');
  const fail = (status, code, message) => { throw new ApiError(status, code, message); };
  if (workspaceId !== 'local' && (!access || access.mode !== 'enterprise' || typeof access.nativeSessionById !== 'function'))
    fail(503, 'PLUGIN_LIBRARY_AUTHORITY_REQUIRED', 'Plugin management requires the original live enterprise access service.');
  const rawTrust = environment.WORKSPACE_PLUGIN_LIBRARY_PUBLISHERS_JSON;
  let trust;
  try {
    if (rawTrust !== undefined && (typeof rawTrust !== 'string' || rawTrust.length > 64000)) throw new TypeError();
    trust = publisherTrust(rawTrust === undefined ? [] : JSON.parse(rawTrust));
  } catch { fail(503, 'PLUGIN_PUBLISHER_CONFIGURATION_REFUSED', 'The configured public publisher trust list requires review.'); }
  const directory = environment.WORKSPACE_PLUGIN_LIBRARY_STATE_DIRECTORY;
  let control;
  if (directory !== undefined) control = await openPluginControlStore({ directory, workspaceId, ApiError, clock });
  let closed = false, closePromise;
  const live = () => { if (closed) fail(503, 'PLUGIN_LIBRARY_CLOSED', 'Plugin management is stopping. Reconcile the original request after restart.'); };
  function actor(context, write = false) {
    live();
    if (!context || context.workspaceId !== workspaceId || !['admin', 'operator'].includes(context.role))
      fail(403, 'PLUGIN_LIBRARY_ROLE_REQUIRED', 'Use the original workspace administrator or operator session.');
    if (workspaceId !== 'local') {
      const current = access.nativeSessionById(context.session?.id);
      if (!current || current.workspaceId !== workspaceId || current.subject !== context.subject || current.role !== context.role
        || current.id !== context.session?.id || !Number.isFinite(context.claims?.exp) || context.claims.exp * 1000 <= clock())
        fail(403, 'PLUGIN_LIBRARY_SESSION_REVOKED', 'The original signed Session is no longer current. No cached identity was accepted.');
    }
    if (!write) return;
    if (!control) fail(503, 'PLUGIN_CONTROL_NOT_CONFIGURED', 'Only inventory is configured. No changes were made.');
    if (context.role !== 'admin' || workspaceId === 'local' || !text(context.subject, 128) || !context.session?.id
      || context.session.subject !== context.subject || context.session.role !== 'admin'
      || !Number.isFinite(context.session.expiresAt) || context.session.expiresAt <= clock()
      || !Number.isFinite(context.claims?.exp) || context.claims.exp * 1000 <= clock())
      fail(403, 'PLUGIN_LIBRARY_SIGNED_ADMIN_REQUIRED', 'Use a current signed enterprise administrator request. Local mode cannot change plugin control state.');
  }
  async function inventory() {
    live();
    try { return await readPluginInventory({ root, backendSelection }); }
    catch { fail(503, 'PLUGIN_INVENTORY_UNAVAILABLE', 'The original plugin selector could not produce a stable inventory. No cached success was substituted.'); }
  }
  function verified(envelope) {
    try { return verifyReleaseEnvelope(envelope, trust); }
    catch { fail(400, 'PLUGIN_RELEASE_VERIFICATION_FAILED', 'Publisher, immutable descriptor, signature or supported isolation contract failed verification.'); }
  }
  function currentRelease(state, id, fingerprint, requireTrust = true) {
    const row = state.releases.find(item => item.id === id);
    if (!row) fail(404, 'PLUGIN_RELEASE_NOT_FOUND', 'The release does not exist in this workspace.');
    if (row.fingerprint !== fingerprint || controlDigest(row.envelope) !== fingerprint || requireTrust && verified(row.envelope).fingerprint !== fingerprint)
      fail(409, 'PLUGIN_RELEASE_CHANGED', 'Refresh and review the exact release fingerprint.');
    return row;
  }
  function mutate(context, body, operation, change) {
    actor(context, true);
    return control.transact({ requestId: body.requestId, expectedRevision: body.expectedRevision, subject: context.subject, operation,
      assertCurrent: () => actor(context, true) }, change);
  }
  async function handle({ req, res, pathname, context, body, respond }) {
    const deliver = async (response, status, value) => {
      actor(context);
      // The original responder calls this trusted callback after its audit await
      // and immediately before headers/body are written. No second audit or cached
      // identity result is substituted for that final live-authority check.
      return respond(response, status, value, () => actor(context));
    };
    if (pathname !== prefix && !pathname.startsWith(prefix + '/')) return false;
    actor(context);
    if (req.method === 'GET' && pathname === prefix) {
      const source = await inventory();
      actor(context);
      const state = control?.read();
      await deliver(res, 200, {
        schemaVersion: 1, workspaceId, revision: state?.revision ?? 0,
        mode: control ? 'review-and-request' : 'inventory-only',
        inventory: source,
        releases: state?.releases.slice(-200).map(row => releaseSummary(row, trust)) ?? [],
        releaseCount: state?.releases.length ?? 0,
        intents: state?.intents.filter(item => item.subject === context.subject).slice(-100) ?? [],
        publisherCount: trust.size,
        capabilities: { publicationReview: !!control && trust.size > 0, changeRequests: !!control, appliesChanges: false, isolatedExecution: false, enterpriseDataGrants: false },
        notice: 'Selection is not execution. Change requests do not install code, restart the Host or grant enterprise data. Full native backend removal and isolated execution need their own verified executor.',
      });
      return true;
    }
    const receipt = pathname.match(new RegExp('^' + prefix + '/requests/([A-Za-z0-9][A-Za-z0-9._:-]{7,127})$'));
    if (req.method === 'GET' && receipt) {
      const result = control?.receipt(receipt[1], context.subject);
      if (!result) fail(404, 'PLUGIN_REQUEST_NOT_FOUND', 'No confirmed receipt exists for this exact request and actor.');
      const state = control.read();
      const currentIntent = state.intents.find(item => item.requestId === receipt[1] && item.subject === context.subject) || null;
      await deliver(res, 200, { ...result, currentRevision: state.revision, currentIntent }); return true;
    }
    const releaseRead = pathname.match(new RegExp('^' + prefix + '/releases/(' + uuid + ')/manifest$'));
    if (req.method === 'GET' && releaseRead) {
      const row = control?.read().releases.find(item => item.id === releaseRead[1]);
      if (!row || row.status !== 'published') fail(404, 'PLUGIN_RELEASE_NOT_PUBLISHED', 'Only a currently published, reviewed descriptor can be distributed.');
      const proof = verified(row.envelope);
      if (proof.fingerprint !== row.fingerprint) fail(409, 'PLUGIN_RELEASE_CHANGED', 'The release proof changed.');
      await deliver(res, 200, { envelope: proof.envelope, fingerprint: proof.fingerprint, descriptorOnly: true, codeInstalled: false }); return true;
    }
    if (req.method !== 'POST') fail(405, 'PLUGIN_LIBRARY_METHOD_NOT_ALLOWED', 'Use the documented GET or signed POST contract.');
    actor(context, true);
    let result;
    if (pathname === prefix + '/releases/import') {
      if (!fields(body, ['requestId', 'expectedRevision', 'envelope'])) fail(400, 'PLUGIN_LIBRARY_INVALID_REQUEST', 'Use the exact signed release import contract.');
      const proof = verified(body.envelope);
      result = await mutate(context, body, { type: 'release.import', envelope: proof.envelope }, (state, audit) => {
        const manifest = proof.envelope.manifest;
        const previous = state.releases.find(item => item.envelope.manifest.id === manifest.id && item.envelope.manifest.version === manifest.version);
        if (previous && previous.fingerprint !== proof.fingerprint) fail(409, 'PLUGIN_RELEASE_VERSION_IMMUTABLE', 'A published or submitted version cannot be replaced. Submit a new version.');
        if (previous) return { release: releaseSummary(previous, trust), executed: false };
        const row = { id: randomUUID(), envelope: proof.envelope, fingerprint: proof.fingerprint, status: 'submitted', importedBy: audit.subject, reviewedBy: null, reviewNote: '', createdAt: audit.at, updatedAt: audit.at };
        state.releases.push(row); return { release: releaseSummary(row, trust), executed: false };
      });
    } else if (pathname.match(new RegExp('^' + prefix + '/releases/(' + uuid + ')/(review|publish|suspend)$'))) {
      const match = pathname.match(new RegExp('^' + prefix + '/releases/(' + uuid + ')/(review|publish|suspend)$'));
      const action = match[2];
      const required = ['requestId', 'expectedRevision', 'fingerprint'];
      if (action === 'review') required.push('decision', 'note');
      if (action === 'suspend') required.push('note');
      if (!fields(body, required) || !/^[a-f0-9]{64}$/u.test(body.fingerprint)
        || action === 'review' && (!['approve', 'reject'].includes(body.decision) || !text(body.note, 2000))
        || action === 'suspend' && !text(body.note, 2000))
        fail(400, 'PLUGIN_LIBRARY_INVALID_REQUEST', 'Use the exact release fingerprint, decision and review note.');
      result = await mutate(context, body, { type: 'release.' + action, id: match[1], fingerprint: body.fingerprint, ...(body.decision ? { decision: body.decision } : {}), ...(body.note ? { note: body.note } : {}) }, (state, audit) => {
        const row = currentRelease(state, match[1], body.fingerprint, action !== 'suspend');
        if (action === 'review') {
          if (row.status !== 'submitted') fail(409, 'PLUGIN_RELEASE_STATE_CONFLICT', 'Only a submitted release can be reviewed.');
          if (row.importedBy === audit.subject) fail(403, 'PLUGIN_RELEASE_INDEPENDENT_REVIEW_REQUIRED', 'A different enterprise administrator must review this exact release.');
          row.status = body.decision === 'approve' ? 'approved' : 'rejected'; row.reviewedBy = audit.subject; row.reviewNote = body.note;
        } else if (action === 'publish') {
          if (row.status !== 'approved' || !row.reviewedBy || row.reviewedBy === row.importedBy) fail(409, 'PLUGIN_RELEASE_APPROVAL_REQUIRED', 'Independent approval of this exact release is required before publication.');
          row.status = 'published';
        } else {
          if (!['submitted', 'approved', 'published'].includes(row.status)) fail(409, 'PLUGIN_RELEASE_STATE_CONFLICT', 'The release is already inactive.');
          row.status = 'suspended'; row.reviewNote = body.note;
        }
        row.updatedAt = audit.at; return { release: releaseSummary(row, trust), executed: false };
      });
    } else if (pathname.match(new RegExp('^' + prefix + '/requests/([A-Za-z0-9][A-Za-z0-9._:-]{7,127})/cancel$'))) {
      const originalId = pathname.split('/').at(-2);
      if (!fields(body, ['requestId', 'expectedRevision', 'intentId']))
        fail(400, 'PLUGIN_LIBRARY_INVALID_REQUEST', 'Use the original intent ID and the current control revision.');
      result = await mutate(context, body, { type: 'plugin.cancel-request', originalRequestId: originalId, intentId: body.intentId }, (state, audit) => {
        const intent = state.intents.find(item => item.requestId === originalId && item.id === body.intentId && item.subject === audit.subject);
        if (!intent) fail(404, 'PLUGIN_REQUEST_NOT_FOUND', 'No matching request belongs to this actor.');
        if (intent.status !== 'awaiting-verified-executor')
          fail(409, 'PLUGIN_REQUEST_ALREADY_PROGRESSING', 'Only an unexecuted request can be cancelled. Reconcile any progressed request instead.');
        intent.status = 'cancelled'; intent.cancelledAt = audit.at;
        return { intent, executed: false, dataDeleted: false };
      });
    } else if (pathname === prefix + '/requests') {
      if (!fields(body, ['requestId', 'expectedRevision', 'action', 'pluginId', 'inventorySha256', 'packageSha256', 'configuration'])
        || !['enable-tools', 'disable-tools', 'upgrade', 'uninstall'].includes(body.action)
        || !text(body.pluginId, 128) || !text(body.configuration, 100))
        fail(400, 'PLUGIN_LIBRARY_INVALID_REQUEST', 'Use the exact source-bound plugin change request.');
      const operation = { type: 'plugin.change-request', action: body.action, pluginId: body.pluginId, inventorySha256: body.inventorySha256, packageSha256: body.packageSha256, configuration: body.configuration };
      if (control.receipt(body.requestId, context.subject)) {
        const original = await mutate(context, body, operation, () => { throw new Error('An existing receipt must not execute again.'); });
        await deliver(res, 200, original); return true;
      }
      const source = await inventory();
      const item = source.packages.find(item => item.id === body.pluginId);
      if (source.snapshotSha256 !== body.inventorySha256 || !item || item.packageSha256 !== body.packageSha256
        || !source.profiles.some(profile => profile.configuration === body.configuration))
        fail(409, 'PLUGIN_INVENTORY_CHANGED', 'The package or configuration changed after review. Refresh before submitting a new request.');
      result = await mutate(context, body, operation, (state, audit) => {
        const intent = { id: randomUUID(), requestId: body.requestId, subject: audit.subject, ...operation, status: 'awaiting-verified-executor', createdAt: audit.at, expiresAt: new Date(Date.parse(audit.at) + 86400000).toISOString(), executed: false, dataDeleted: false };
        state.intents.push(intent); return { intent, executed: false, requiresIndependentExecution: true };
      });
    } else fail(404, 'PLUGIN_LIBRARY_NOT_FOUND', 'The plugin-management operation is not supported.');
    // The original Host responds and records its original access audit. No model,
    // external account, business permission or package code was invoked above.
    await deliver(res, 200, result); return true;
  }
  return Object.freeze({ handle, close() { if (!closePromise) { closed = true; closePromise = control?.close() || Promise.resolve(); } return closePromise; } });
}
