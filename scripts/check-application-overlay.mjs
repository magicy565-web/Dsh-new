import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.mjs';
import { accessConfigFromEnvironment } from '../server/access.mjs';

// Clean extracted package, actual HTTP/Store/artifact bytes. No native Host,
// Muse account, external connector, credentials or model callback is simulated.
const manifest = JSON.parse(await readFile('RELEASE-MANIFEST.json', 'utf8'));
for (const row of manifest.files) {
  assert.equal(createHash('sha256').update(await readFile(row.path)).digest('hex'), row.sha256, row.path);
}
let app, address, calls = 0;
const directory = await mkdtemp(path.join(os.tmpdir(), 'workspace-package-check-'));
const provider = { kind: 'package-offline', configured: false, complete() { calls++; throw Error('External execution forbidden'); } };
const open = async () => { app = await createApp({ dataDirectory: directory, provider, capabilityEnvironment: {} }); address = await app.listen(0); };
const request = async (route, method = 'GET', body, raw = false) => {
  const response = await fetch(`http://127.0.0.1:${address.port}${route}`, { method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  return { status: response.status, value: raw ? Buffer.from(await response.arrayBuffer()) : await response.json() };
};
try {
  await assert.rejects(accessConfigFromEnvironment({ NODE_ENV: 'production', WORKSPACE_ACCESS_MODE: 'local' }), /enterprise/);
  await open();
  const first = (await request('/api/bootstrap')).value;
  assert.equal(first.version, 3); assert.equal(first.runtime.configured, false);
  assert.equal((await request('/', 'GET', null, true)).value.toString().startsWith('<!doctype html>'), true);
  const conversation = (await request('/api/conversations', 'POST', { title: 'Clean package fixture' })).value.conversation;
  const rejected = await request(`/api/conversations/${conversation.id}/messages`, 'POST', { provider: 'muse', requestId: 'package-explicit-muse', content: 'Exact original Host binding required' });
  assert.equal(rejected.status, 409); assert.equal(rejected.value.error.code, 'MW_NATIVE_CONVERSATION_REQUIRED');
  assert.equal(app.store.read().runs.length, 0);
  const memory = (await request('/api/memories', 'POST', { content: 'Durable packaged fixture' })).value.memory;
  const artifact = (await request('/api/artifacts', 'POST', { filename: 'package-fixture.txt', content: 'Exact packaged bytes' })).value.artifact;
  assert.equal((await request(`/api/artifacts/${artifact.id}/download`, 'GET', null, true)).value.toString(), 'Exact packaged bytes');
  const firstInstance = first.diagnostics.instanceId;
  await app.close(); app = null; await open();
  const second = (await request('/api/bootstrap')).value;
  assert.notEqual(second.diagnostics.instanceId, firstInstance);
  assert.equal(second.conversations[0].id, conversation.id); assert.equal(second.memories[0].id, memory.id);
  assert.equal(app.store.read().runs.length, 0);
  assert.equal((await request(`/api/artifacts/${artifact.id}/download`, 'GET', null, true)).value.toString(), 'Exact packaged bytes');
  assert.equal(calls, 0); assert.equal(second.capabilities.connectorRuns.length, 0);
  console.log(JSON.stringify({ result: 'passed', packageKind: manifest.packageKind, manifestFilesVerified: manifest.files.length,
    node: process.version, credentialsUsed: false, externalCalls: 0, nativeHostBoot: 'not tested', realMuseExecution: 'not tested',
    frontend: 'packaged HTTP bytes only; no browser acceptance', checks: ['all ZIP manifest hashes', 'clean dependency-free import and loopback HTTP', 'v3 durable store', 'explicit Muse never falls through to model Run', 'packaged frontend served', 'artifact exact bytes', 'app.close drains and releases writer', 'restart preserves original conversation/memory/artifact', 'zero connector/model executions'] }, null, 2));
} finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
