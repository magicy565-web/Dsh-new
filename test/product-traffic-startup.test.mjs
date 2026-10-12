import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1');
  await once(server, 'listening'); const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}

const binding = () => ({ workspaceId: 'local', shopId: 'gid://shopify/Shop/1', shopDomain: 'fixture-shop.myshopify.com',
  propertyId: '1234', mappingRevision: 'synthetic-cli-review-1', authorizationReviewed: true, hostNames: ['fixture-store.example'],
  products: [{ productId: 'gid://shopify/Product/123', itemId: 'synthetic-item-123', collectionStartedAt: '2026-10-12T00:00:00.000Z', evidenceRef: 'synthetic-cli-review' }] });

async function launch(t, changes = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-ga4-startup-'));
  const configFile = path.join(directory, 'metadata.json'), authorizationFile = path.join(directory, 'absent-authorization.json');
  let child, closed;
  t.after(async () => {
    try {
      if (child) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000);
        try { await closed; } finally { clearTimeout(force); }
      }
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  await fs.writeFile(configFile, JSON.stringify({ version: 1, binding: binding(), authorizationFile, ...changes }), { mode: 0o600 });
  const port = await freePort();
  // No environment is inherited, no env-file flag is used, and no token file
  // exists. This is the actual ordinary CLI entrypoint with metadata only.
  child = spawn(process.execPath, ['server/index.mjs'], { cwd: new URL('../', import.meta.url), env: {
    PORT: String(port), WORKSPACE_DATA_DIR: path.join(directory, 'store'),
    WORKSPACE_RUNTIME: 'pi', WORKSPACE_ACCESS_MODE: 'local', WORKSPACE_SUPPLIER_TRAFFIC_CONFIG_FILE: configFile,
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', spawnError;
  child.on('error', error => { spawnError = error; });
  const capture = chunk => { output = (output + chunk).slice(-64_000); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  async function waitFor(predicate) {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
      if (spawnError) throw spawnError;
      assert.ok(Date.now() < deadline, `CLI did not reach its expected state: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  return { child, closed, directory, configFile, authorizationFile, port, waitFor, output: () => output };
}

test('ordinary CLI loads GA4 metadata without credentials; catalog remains unverified and original owner binding is required', { timeout: 15_000 }, async t => {
  const f = await launch(t);
  await f.waitFor(() => f.output().includes('Workspace server:') || f.child.exitCode !== null);
  assert.equal(f.child.exitCode, null, f.output());
  assert.match(f.output(), /local access; pi; setup required/);
  const [catalogResponse, healthResponse] = await Promise.all([
    fetch(`http://127.0.0.1:${f.port}/api/agent-services`, { signal: AbortSignal.timeout(3000) }),
    fetch(`http://127.0.0.1:${f.port}/api/health`, { signal: AbortSignal.timeout(3000) }),
  ]);
  assert.equal(catalogResponse.status, 200); assert.equal(healthResponse.status, 200);
  const catalog = await catalogResponse.json(), health = await healthResponse.json();
  const service = catalog.services.find(row => row.id === 'supplier-listing-monitor');
  assert.equal(service.traffic.supported, true); assert.equal(service.traffic.configured, true);
  assert.equal(service.trafficStatus, 'configured_unverified'); assert.equal(service.traffic.observationRequired, true);
  assert.equal(service.traffic.metric, 'productDetailViews'); assert.equal(service.traffic.sessionsAvailable, false);
  assert.equal(service.ownerMcp.configured, false); assert.equal(service.ownerMcp.status, 'binding_required');
  assert.equal(service.writesEnabled, false); assert.equal(service.publication.configured, false);
  assert.equal(health.provider.kind, 'pi-durable'); assert.equal(health.provider.configured, false);
  assert.equal(health.provider.onlineVerified, false); assert.equal(health.readiness, 'setup_required');
  await assert.rejects(fs.stat(f.authorizationFile), { code: 'ENOENT' });
  assert.equal(JSON.stringify(catalog).includes(f.configFile), false);
  f.child.kill('SIGTERM');
  assert.deepEqual(await f.closed, { code: 0, signal: null });
});

test('ordinary CLI fails closed on invalid GA4 metadata before opening its HTTP listener', { timeout: 15_000 }, async t => {
  const f = await launch(t, { version: 999 });
  await f.waitFor(() => f.child.exitCode !== null);
  assert.deepEqual(await f.closed, { code: 1, signal: null });
  assert.match(f.output(), /reviewed private GA4 configuration schema/);
  assert.equal(f.output().includes('Workspace server:'), false);
  assert.equal(f.output().includes(f.configFile), false);
  await assert.rejects(fs.stat(f.authorizationFile), { code: 'ENOENT' });
  await assert.rejects(fetch(`http://127.0.0.1:${f.port}/api/agent-services`, { signal: AbortSignal.timeout(1000) }));
});
