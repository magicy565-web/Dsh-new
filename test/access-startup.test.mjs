import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function freePort() { const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }

test('startup: absent runtime config defaults to OMP frontend with original Pi durable provider and never uses inherited official credentials', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-startup-'));
  const port = await freePort();
  // The child gets no inherited environment or real credentials. This fixture
  // only inspects setup status and never submits a model request.
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: new URL('../', import.meta.url), env: { PATH: process.env.PATH, PORT: String(port), WORKSPACE_DATA_DIR: directory, DEEPSEEK_API_KEY: 'fixture-only-not-a-valid-key' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => { if (child.exitCode === null) child.kill('SIGTERM'); await exited; await fs.rm(directory, { recursive: true, force: true }); });
  for (let attempt = 0; attempt < 200 && !output.includes('Workspace server:') && child.exitCode === null; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(output, /local access; omp; setup required/);
  const response = await fetch(`http://127.0.0.1:${port}/api/health`); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.provider.kind, 'pi-durable'); assert.equal(data.provider.configured, false); assert.equal(data.provider.onlineVerified, false);
});

test('startup: production environment cannot silently start local access mode', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-prod-startup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: new URL('../', import.meta.url), env: { PATH: process.env.PATH, NODE_ENV: 'production', WORKSPACE_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stderr.on('data', chunk => { output += chunk; });
  const [code] = await once(child, 'exit'); assert.equal(code, 1); assert.match(output, /explicit WORKSPACE_ACCESS_MODE=enterprise/);
  assert.deepEqual(await fs.readdir(directory), []);
});
