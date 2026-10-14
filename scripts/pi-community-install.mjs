// Reproduce only the three reviewed, pinned npm installations in a fresh /tmp
// directory. All transitive resolutions come from committed lockfiles; no npm
// lifecycle script runs, and fixed host Pi peers are reused explicitly.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('..', import.meta.url));
const validation = repo + '/docs/validation/pi-community-20261014';
const pins = JSON.parse(await fs.readFile(validation + '/pins.json'));
assert.equal(process.version, 'v' + pins.nodeVersion);
const hostModules = repo + '/node_modules';
for (const name of ['pi-coding-agent', 'pi-ai', 'pi-agent-core', 'pi-tui']) assert.equal(JSON.parse(await fs.readFile(`${hostModules}/@earendil-works/${name}/package.json`)).version, pins.officialPiVersion);
const root = await fs.mkdtemp('/tmp/pi-community-pinned-install-');
await fs.mkdir(root + '/packages'); await fs.mkdir(root + '/home');
const env = { PATH: process.env.PATH, HOME: root + '/home', TMPDIR: root, NPM_CONFIG_PREFIX: root + '/npm-global',
  NPM_CONFIG_UPDATE_NOTIFIER: 'false', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false' };
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'CODEX_PROXY_CERT']) if (process.env[key]) env[key] = process.env[key];
if (!env.NODE_EXTRA_CA_CERTS && env.CODEX_PROXY_CERT) env.NODE_EXTRA_CA_CERTS = env.CODEX_PROXY_CERT;
async function run(executable, args, cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Pinned install command timeout')); }, 120000);
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; }); child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); if (code) reject(new Error(output)); else resolve(output); });
  });
}
for (const pin of pins.packages) {
  assert.equal(new URL(pin.tarball).hostname, 'registry.npmjs.org');
  const tarball = `${root}/packages/${pin.name}-${pin.version}.tgz`;
  await run('curl', ['--fail', '--silent', '--show-error', '--location', pin.tarball, '--output', tarball], root);
  const bytes = await fs.readFile(tarball), [algorithm, digest] = pin.integrity.split('-');
  assert.equal(createHash(algorithm).update(bytes).digest('base64'), digest);
  assert.equal(createHash('sha1').update(bytes).digest('hex'), pin.shasum);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
  const entries = (await run('tar', ['-tzf', tarball], root)).trim().split('\n');
  assert.ok(entries.every(entry => !entry.startsWith('/') && !entry.split('/').includes('..')));
  const cwd = `${root}/install/${pin.name}`; await fs.mkdir(cwd, { recursive: true });
  const lock = JSON.parse(await fs.readFile(`${validation}/${pin.name}.package-lock.json`));
  // Provenance snapshots and reviewed package metadata are committed with pins.
  await fs.writeFile(cwd + '/package.json', JSON.stringify({ ...lock.packages[''], private: true, type: 'module' }, null, 2));
  await fs.writeFile(cwd + '/package-lock.json', JSON.stringify(lock, null, 2));
  const output = await run('npm', ['ci', '--ignore-scripts', '--omit=dev', '--omit=peer', '--legacy-peer-deps', '--no-audit', '--no-fund'], cwd);
  const modules = cwd + '/node_modules'; await fs.mkdir(modules + '/@earendil-works', { recursive: true });
  for (const name of ['pi-coding-agent', 'pi-ai', 'pi-agent-core', 'pi-tui']) await fs.symlink(`${hostModules}/@earendil-works/${name}`, `${modules}/@earendil-works/${name}`);
  await fs.symlink(hostModules + '/typebox', modules + '/typebox');
  assert.equal(JSON.parse(await fs.readFile(`${modules}/${pin.name}/package.json`)).version, pin.version);
  console.log(JSON.stringify({ package: pin.name, version: pin.version, integrityVerified: true, lifecycleScriptsRun: 0, installed: true, summary: output.trim() }));
}
await fs.writeFile(root + '/installation-receipt.json', JSON.stringify({ schemaVersion: 1, root, packages: pins.packages.map(p => ({ name: p.name, version: p.version, integrity: p.integrity })), hostPi: pins.officialPiVersion, node: process.version, lifecycleScriptsRun: 0 }, null, 2));
console.log(JSON.stringify({ installRoot: root + '/install', nextCommand: `PI_COMMUNITY_INSTALL_ROOT=${root}/install node scripts/pi-community-verify.mjs` }));
