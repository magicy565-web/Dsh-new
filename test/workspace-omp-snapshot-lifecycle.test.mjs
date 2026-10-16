import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkspaceClient } from '../plugins/workspace-procurement/src/workspace.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { taskFixture, TOKEN_A } from './fixtures/pi-task-helpers.mjs';
import { request } from './agent-service.helpers.mjs';

const paths = workspaceOmpPaths({}), facts = [];
const model = { provider: 'workspace-omp-snapshot-fixture', id: 'finite', api: 'openai-completions', baseUrl: 'https://synthetic.invalid' };
const configuration = { providerId: model.provider, model: model.id, baseUrl: model.baseUrl };
const material = '# PUBLIC SYNTHETIC FACTORY PRODUCT\nCapacity unknown. Snapshot lifecycle evidence only.\n';
const hash = value => createHash('sha256').update(value).digest('hex');
async function until(check, label) {
  for (let attempt = 0; attempt < 600; attempt++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error(label);
}
after(async () => {
  if (process.env.WORKSPACE_OMP_SNAPSHOT_LIFECYCLE_SAVE_EVIDENCE) await fs.writeFile(process.env.WORKSPACE_OMP_SNAPSHOT_LIFECYCLE_SAVE_EVIDENCE,
    JSON.stringify({ ompVersion: '18.10.4', bunVersion: '1.3.14', originalEnterpriseHttp: true, explicitFiniteKeylessModels: true,
      paidModelCalls: 0, productionBusinessCalls: 0, cases: facts }, null, 2) + '\n');
});
async function fixture(t, responses) {
  const directory = await fs.mkdtemp('/tmp/omp-snapshot-lifecycle-'), publicRoot = path.join(directory, 'public-originals');
  await fs.mkdir(publicRoot); const source = path.join(publicRoot, 'product.md'); await fs.writeFile(source, material);
  const lifecycle = []; let f;
  f = await taskFixture(t, { directory: path.join(directory, 'data'), enterprise: true, businessAgentOptions: {
    recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, syntheticResponses: responses,
      publicTools: { searchProvider: 'disabled', publicDocumentRoot: publicRoot, files: [{ id: 'product', path: source, sha256: hash(material) }] },
      onWorkerLifecycle: event => lifecycle.push(event) }),
    resolveBinding: async () => ({ model, client: createWorkspaceClient({ baseURL: f.baseURL, token: TOKEN_A,
      fetchImpl: async (url, options) => {
        const response = await request(f.baseURL, new URL(url).pathname + new URL(url).search,
          { method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
        return new Response(response.bytes, { status: response.status, headers: { 'content-type': response.headers['content-type'] } });
      } }) }),
  } });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const created = await f.workspace('/api/conversations', { subject: 'member-a', body: { title: 'Public snapshot lifecycle', requestId: 'public-snapshot-conversation' } });
  assert.equal(created.status, 201, created.text);
  return { ...f, lifecycle, source, conversationId: created.json.conversation.id };
}
async function send(f, key) {
  const accepted = await f.workspace(`/api/conversations/${f.conversationId}/messages`, { subject: 'member-a',
    body: { content: 'Read only the explicitly selected public synthetic product text.', requestId: key } });
  assert.equal(accepted.status, 202, accepted.text); return accepted.json.run.id;
}
async function journalScope(f) {
  const mapping = await until(() => f.app.store.read().conversations.find(row => row.id === f.conversationId)?.businessAgentSession,
    'The original Session mapping was not saved.');
  const entries = (await fs.readFile(mapping.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const header = entries.find(entry => entry.type === 'session'); assert.ok(header, 'The official journal contains no Session header.'); assert.ok(path.isAbsolute(header.cwd));
  assert.ok(header.cwd.startsWith(f.directory + path.sep));
  return { cwd: header.cwd, mapping, entries };
}
const snapshots = async cwd => (await fs.readdir(cwd)).filter(name => name.startsWith('selected-public-materials-')).sort();
async function marker(cwd) {
  const name = 'selected-public-materials-other-run-marker'; await fs.mkdir(path.join(cwd, name));
  await fs.writeFile(path.join(cwd, name, 'marker.txt'), 'PUBLIC SYNTHETIC OTHER RUN; preserve.'); return name;
}
async function exited(f, offset = 0) {
  const exit = await until(() => f.lifecycle.slice(offset).find(event => event.phase === 'exit'), 'The actual owned OMP worker did not exit.');
  assert.throws(() => process.kill(exit.pid, 0), error => error.code === 'ESRCH'); return exit;
}
async function finished(f, runId) {
  return until(() => { const run = f.app.store.read().runs.find(row => row.id === runId); return run && !['queued', 'running'].includes(run.status) ? run : null; }, 'The original Run did not settle.');
}
async function preserved(f, cwd, markerName) {
  assert.deepEqual(await snapshots(cwd), [markerName]);
  assert.equal(await fs.readFile(path.join(cwd, markerName, 'marker.txt'), 'utf8'), 'PUBLIC SYNTHETIC OTHER RUN; preserve.');
  assert.equal(hash(await fs.readFile(f.source)), hash(material)); assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0);
  assert.equal(f.faux.state.callCount, 0);
}
const read = { tool: 'workspace_public_document', arguments: { documentId: 'product' } };

test('original HTTP OMP Run closes its real selected snapshot after a normal read and preserves other Run material', { timeout: 45000 }, async t => {
  const f = await fixture(t, [read, { wait: 1500, text: 'Public product read; capacity stays unknown.', expectedContextText: 'Capacity unknown.' }]);
  const runId = await send(f, 'snapshot-normal-run');
  await until(() => f.lifecycle.some(event => event.phase === 'nativeModelWaiting'), 'The real official model stream did not wait after its ReadTool receipt.');
  const { cwd } = await journalScope(f); assert.equal((await snapshots(cwd)).length, 1);
  const markerName = await marker(cwd), run = await finished(f, runId), exit = await exited(f);
  assert.equal(run.status, 'succeeded'); assert.equal(exit.code, 0); await preserved(f, cwd, markerName);
  const { entries } = await journalScope(f);
  const receipt = entries.find(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'workspace_public_document');
  assert.match(JSON.stringify(receipt.message.content), /Capacity unknown/);
  facts.push({ case: 'normal', status: run.status, originalRuns: 1, workerExitObserved: true, workerPidDead: true,
    actualReadToolReceipt: true, ownedSnapshotsRemaining: 0, otherRunMarkerPreserved: true, originalShaPreserved: true });
});

test('original HTTP cancellation after an actual public read aborts the model and removes only its own snapshot', { timeout: 45000 }, async t => {
  const f = await fixture(t, [read, { wait: 60000, text: 'Must be cancelled after actual public reading.', expectedContextText: 'Capacity unknown.' }]);
  const runId = await send(f, 'snapshot-cancel-run');
  await until(() => f.lifecycle.some(event => event.phase === 'nativeModelWaiting'), 'The model did not wait after reading the selected snapshot.');
  const { cwd } = await journalScope(f); assert.equal((await snapshots(cwd)).length, 1); const markerName = await marker(cwd);
  const cancelled = await f.workspace(`/api/conversations/${f.conversationId}/cancel`, { subject: 'member-a', body: {} });
  assert.equal(cancelled.status, 200, cancelled.text); const run = await finished(f, runId); assert.equal(run.status, 'cancelled');
  await exited(f); assert.ok(f.lifecycle.some(event => event.phase === 'nativeModelAbort')); await preserved(f, cwd, markerName);
  facts.push({ case: 'cancel-after-read', status: run.status, originalRuns: 1, nativeModelAbortObserved: true,
    workerExitObserved: true, workerPidDead: true, ownedSnapshotsRemaining: 0, otherRunMarkerPreserved: true, originalShaPreserved: true });
});

test('original HTTP cached-receipt initialization rejection cleans the newly created public copy before worker exit', { timeout: 45000 }, async t => {
  const f = await fixture(t, [read, { text: 'First public read completed.', expectedContextText: 'Capacity unknown.' }]);
  const first = await send(f, 'snapshot-cache-first'); assert.equal((await finished(f, first)).status, 'succeeded'); await exited(f);
  const { cwd, mapping, entries } = await journalScope(f); assert.deepEqual(await snapshots(cwd), []); const markerName = await marker(cwd);
  await fs.appendFile(mapping.sessionFile, JSON.stringify({ type: 'message', id: 'synthetic-invalid-public-cache', parentId: entries.at(-1).id,
    timestamp: new Date().toISOString(), message: { role: 'toolResult', toolCallId: 'synthetic-invalid-public-cache', toolName: 'workspace_public_document',
      content: [{ type: 'text', text: 'PUBLIC SYNTHETIC OBSOLETE RECEIPT; reject before a model call.' }],
      details: { documentId: 'product', sha256: '0'.repeat(64) }, isError: false, timestamp: Date.now() } }) + '\n');
  const observed = new Set(), watcher = watch(cwd, (_event, name) => {
    const value = name?.toString(); if (value?.startsWith('selected-public-materials-') && value !== markerName) observed.add(value);
  });
  try {
    const offset = f.lifecycle.length, second = await send(f, 'snapshot-cache-second'), run = await finished(f, second);
    assert.equal(run.status, 'failed'); assert.match(run.error.message, /cached public document was revoked or its exact selected bytes changed/);
    assert.equal(run.events.filter(event => event.type === 'pi.agent-session.request').length, 0);
    await exited(f, offset); await until(() => observed.size > 0, 'No new owned snapshot directory was observed before the post-helper cache rejection.');
    await preserved(f, cwd, markerName); assert.equal(f.app.store.read().runs.length, 2);
    facts.push({ case: 'post-helper-cache-initialization-failure', status: run.status, originalRuns: 2, modelCallsOnRejectedRun: 0,
      newOwnedSnapshotObserved: true, workerExitObserved: true, workerPidDead: true,
      ownedSnapshotsRemaining: 0, otherRunMarkerPreserved: true, originalShaPreserved: true });
  } finally { watcher.close(); }
});

test('original host removes only the exact Run snapshot after its owned worker is abruptly killed', { timeout: 45000 }, async t => {
  const f = await fixture(t, [read, { wait: 60000, text: 'Synthetic owned worker must be terminated.', expectedContextText: 'Capacity unknown.' }]);
  const runId = await send(f, 'snapshot-owned-hard-exit');
  await until(() => f.lifecycle.some(event => event.phase === 'nativeModelWaiting'), 'The model did not wait after actual ReadTool.');
  const { cwd } = await journalScope(f); const copies = await snapshots(cwd);
  assert.equal(copies.length, 1); assert.ok(copies[0].startsWith(`selected-public-materials-${runId}-`));
  const markerName = await marker(cwd), worker = f.lifecycle.find(event => event.phase === 'spawn');
  process.kill(worker.pid, 'SIGKILL'); // Exact fixture-owned PID; never a process-name/global kill.
  await exited(f); const run = await finished(f, runId); assert.equal(run.status, 'failed');
  await preserved(f, cwd, markerName);
  facts.push({ case: 'owned-worker-abrupt-exit', status: run.status, originalRuns: 1, forcedFixtureWorkerKill: true,
    parentCleanupObserved: true, workerExitObserved: true, workerPidDead: true,
    ownedSnapshotsRemaining: 0, otherRunMarkerPreserved: true, originalShaPreserved: true });
});
