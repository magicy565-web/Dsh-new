import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('real CLI loads explicit empty-key DeepSeek profile with no model request or new authority', async t => {
  const data = await fs.mkdtemp('/tmp/workspace-deepseek-cli-test-');
  const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  // Deliberately do not inherit ambient environment/credentials or .env files.
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: new URL('../', import.meta.url), env: {
    PORT: String(port), WORKSPACE_RUNTIME: 'pi', WORKSPACE_ACCESS_MODE: 'local', WORKSPACE_DATA_DIR: data,
    PI_PROVIDER: 'deepseek', PI_MODEL: 'deepseek-flash', DEEPSEEK_API_KEY: '',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await closed; } finally { clearTimeout(force); await fs.rm(data, { recursive: true, force: true }); }
  });
  let health;
  for (let i = 0; i < 250; i++) {
    if (child.exitCode !== null) assert.fail('Synthetic CLI exited before health: ' + stderr);
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { health = await response.json(); break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(health, 'synthetic CLI health is reachable');
  assert.equal(health.provider.configured, false); assert.equal(health.provider.onlineVerified, false);
  assert.equal(health.readiness, 'setup_required'); assert.match(stdout, /setup required/);
  const bootstrap = await (await fetch(`http://127.0.0.1:${port}/api/bootstrap`)).json();
  assert.equal(bootstrap.settings.model, 'deepseek-flash');
  const status = await (await fetch(`http://127.0.0.1:${port}/api/agent-ui/v1/status`)).json();
  assert.equal(status.enabled, false); assert.equal(status.provider, null);
  assert.equal(stderr, ''); child.kill('SIGTERM'); assert.equal((await closed)[0], 0);
});
