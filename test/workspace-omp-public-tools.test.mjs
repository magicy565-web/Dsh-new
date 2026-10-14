import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshotWorkspaceOmpPublicFiles, workspaceOmpPublicURL, workspaceOmpPublicIPv4 } from '../server/workspace-omp-public-tools.mjs';
import { workspaceOmpPublicToolConfiguration } from '../server/workspace-omp-host.mjs';
import { workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
test('public material selection pins exact files and refuses secrets, symlinks, traversal and changed bytes', async t => {
  const directory = await fs.mkdtemp('/tmp/omp-public-files-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'product.md'), text = '# Public synthetic product\nCapacity unknown.\n';
  await fs.writeFile(source, text);
  const file = { id: 'product', path: source, sha256: hash(text) };
  const selected = await snapshotWorkspaceOmpPublicFiles({ root: directory, files: [file] });
  assert.deepEqual(selected, [{ id: 'product', content: text, sha256: file.sha256 }]);
  assert.equal(JSON.stringify(selected).includes(source), false);
  await assert.rejects(snapshotWorkspaceOmpPublicFiles({ root: directory, files: [{ ...file, sha256: '0'.repeat(64) }] }), /changed/);
  const link = path.join(directory, 'link.md'); await fs.symlink(source, link);
  await assert.rejects(snapshotWorkspaceOmpPublicFiles({ root: directory, files: [{ ...file, path: link }] }), /pinned/);
  await assert.rejects(snapshotWorkspaceOmpPublicFiles({ root: directory + '/nested', files: [file] }));
  await fs.writeFile(source, 'api_key=syntheticForbiddenValue123\n');
  await assert.rejects(snapshotWorkspaceOmpPublicFiles({ root: directory, files: [{ ...file, sha256: hash(await fs.readFile(source)) }] }), /credentials/);
  await assert.rejects(snapshotWorkspaceOmpPublicFiles({ root: directory, files: [{ ...file, path: directory + '/.env' }] }), /public directory/);
});
test('public URL/DNS admission and provider configuration do not allow arbitrary or paid tools', () => {
  assert.equal(workspaceOmpPublicURL('https://example.com/catalog').href, 'https://example.com/catalog');
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://localhost/', 'file:///tmp/public.md',
    'https://metadata.internal/', 'https://user:pass@example.com/', 'https://example.com:8443/', 'https://example.com/#private'])
    assert.throws(() => workspaceOmpPublicURL(url));
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '::1', '198.18.0.1', '203.0.113.4'])
    assert.equal(workspaceOmpPublicIPv4(ip), false, ip);
  assert.equal(workspaceOmpPublicIPv4('93.184.216.34'), true);
  assert.equal(workspaceOmpPublicToolConfiguration({}).searchProvider, 'duckduckgo');
  assert.equal(workspaceOmpPublicToolConfiguration({ WORKSPACE_OMP_BROWSER_BIN: 'disabled' }).browserExecutable, null);
  assert.throws(() => workspaceOmpPublicToolConfiguration({ WORKSPACE_OMP_PUBLIC_SEARCH_PROVIDER: 'paid-auto' }));
  assert.throws(() => workspaceOmpPublicToolConfiguration({ WORKSPACE_OMP_PUBLIC_FILES_JSON: '[{}]' }));
});
test('actual published OMP public provider and ReadTool pass through narrow original authorization', { timeout: 45000 }, async t => {
  const paths = workspaceOmpPaths(process.env);
  await fs.access(paths.bun); await fs.access(paths.packageRoot + '/package.json');
  const directory = await fs.mkdtemp('/tmp/omp-public-tools-'); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const evidence = directory + '/evidence.json';
  const result = await new Promise((resolve, reject) => {
    const child = spawn(paths.bun, [root + '/test/fixtures/workspace-omp-public-tools.mjs'], { cwd: directory,
      env: { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory,
        PI_CODING_AGENT_DIR: directory + '/agent', PI_BROWSER_RELAY: '0', PI_BROWSER_TERN: '0', PI_BROWSER_CMUX: '0',
        WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot, WORKSPACE_OMP_PUBLIC_EVIDENCE: evidence,
        WORKSPACE_OMP_PUBLIC_LIVE_PROVIDER: process.env.WORKSPACE_OMP_PUBLIC_LIVE_PROVIDER || '',
        ...Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'].filter(key => process.env[key]).map(key => [key, process.env[key]])) },
      detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} reject(new Error('OMP public tool fixture timed out')); }, 40000);
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject); child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
  assert.equal(result.code, 0, result.output); assert.match(result.output, /PUBLIC_OMP_ADMISSION_VERIFIED/);
  const facts = JSON.parse(await fs.readFile(evidence));
  assert.equal(facts.paidModelCalls, 0); assert.equal(facts.search.sourceCount, 1); assert.equal(facts.deniedNetworkCalls, 0);
  if (process.env.WORKSPACE_OMP_PUBLIC_SAVE_EVIDENCE) await fs.copyFile(evidence, process.env.WORKSPACE_OMP_PUBLIC_SAVE_EVIDENCE);
});
