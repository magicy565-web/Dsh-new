import { bytesHash, clone, digest, fail, same, safeJson } from './contracts.mjs';

/** Thin adapter for the repository's existing createArtifactService/store.
 * It does not open a database, create identities, or own task/approval state.
 * Bind one instance to one trusted enterprise; never accept scope from a tool.
 */
export function createArtifactBrainRepository({ store, artifacts, workspaceId, authorizeRecord } = {}) {
  if (!workspaceId || !store?.read || !artifacts?.create || !artifacts?.update || !artifacts?.read || typeof authorizeRecord !== 'function') fail('BRAIN_REPOSITORY_UNCONFIGURED');
  const scopeKey = digest(['workspace-brain:v1', workspaceId]);
  const ref = row => ({ artifactId: row.id, revision: row.revision, version: row.currentVersion, sha256: row.sha256 });
  async function authorize(operation, key, row) {
    if (await authorizeRecord({ operation, workspaceId, key, artifact: row ? clone(row) : null }) !== true) fail('BRAIN_AUTHORIZATION_REFUSED');
  }
  function find(state, key) {
    const rows = state.artifacts.filter(a => a.metadata?.businessBrain?.scopeKey === scopeKey && a.metadata.businessBrain.key === key);
    if (rows.length > 1) fail('BRAIN_ARTIFACT_INTEGRITY');
    const row = rows[0];
    if (row && (row.metadata.businessLibrary?.visibility !== 'internal' || row.metadata.businessBrain.schema !== 1)) fail('BRAIN_ARTIFACT_INTEGRITY');
    return row;
  }
  function assertRecord(state, key, expected) {
    const row = find(state, key);
    if (expected === null ? !!row : !row || !same(ref(row), expected)) fail('BRAIN_REVISION_CONFLICT');
  }
  async function get(key) {
    await authorize('read', key, null);
    const row = find(store.read(), key);
    if (!row) return null;
    await authorize('read', key, row);
    const result = await artifacts.read(row.id, { version: row.currentVersion, encoding: 'utf8' });
    if (result.encoding !== 'utf8' || result.artifact.id !== row.id || result.version.version !== row.currentVersion
      || bytesHash(Buffer.from(result.content)) !== row.sha256 || row.metadata.businessBrain.bodyHash !== row.sha256) fail('BRAIN_ARTIFACT_INTEGRITY');
    const value = safeJson(JSON.parse(result.content), 64 * 1024);
    if (value.workspaceId !== workspaceId || value.key !== key || value.schema !== 1 || value.revision < 1) fail('BRAIN_ARTIFACT_INTEGRITY');
    assertRecord(store.read(), key, ref(row));
    await authorize('read', key, find(store.read(), key));
    return { key, ref: ref(row), value };
  }
  async function commit({ key, expectedRef, value, dependencies = [], check }) {
    safeJson(value, 64 * 1024);
    if (value.workspaceId !== workspaceId || value.key !== key || typeof check !== 'function') fail('BRAIN_SCOPE_MISMATCH');
    const before = find(store.read(), key);
    const operation = key === 'context' ? 'context.save' : key.startsWith('decision:') ? 'decision.save' : key.startsWith('review:') ? 'review.save' : key.startsWith('feedback:') ? 'feedback.save' : 'brain.write';
    await authorize(operation, key, before);
    const content = JSON.stringify(value);
    const metadata = { businessLibrary: { visibility: 'internal' }, businessBrain: { schema: 1, scopeKey, key, bodyHash: bytesHash(content) } };
    const body = { content, metadata, sourceConversationId: value.originConversationId };
    const admission = { brainProtectedWrite: true, check(state) {
      assertRecord(state, key, expectedRef);
      for (const dep of dependencies) assertRecord(state, dep.key, dep.ref);
      const allowed = check(state);
      if (allowed !== true) fail('BRAIN_COMMIT_REFUSED');
    } };
    const result = expectedRef === null
      ? await artifacts.create({ ...body, requestId: `brain-${digest([workspaceId, key])}`, filename: `brain-${digest(key).slice(0,24)}.json`, description: 'Unreviewed enterprise business context/decision. No execution or approval.' }, admission)
      : await artifacts.update(expectedRef.artifactId, { ...body, expectedRevision: expectedRef.revision }, admission);
    if (result.artifact.sha256 !== metadata.businessBrain.bodyHash || !same(result.artifact.metadata, metadata)) fail('BRAIN_ARTIFACT_INTEGRITY');
    await authorize('read', key, result.artifact);
    return get(key);
  }
  async function listKeys(prefix, limit = 200) {
    await authorize('list', prefix, null);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail('BRAIN_INPUT_INVALID');
    const keys = store.read().artifacts.filter(a => a.metadata?.businessBrain?.scopeKey === scopeKey && a.metadata.businessBrain.key.startsWith(prefix)).map(a => a.metadata.businessBrain.key).sort();
    if (new Set(keys).size !== keys.length) fail('BRAIN_ARTIFACT_INTEGRITY');
    await authorize('list', prefix, null);
    return { keys: keys.slice(0, limit), truncated: keys.length > limit };
  }
  return Object.freeze({ get, commit, listKeys, assertRecord });
}
