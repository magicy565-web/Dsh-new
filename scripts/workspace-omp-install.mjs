import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const directory = fileURLToPath(new URL('../support/omp-coding-agent/', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => !['--check', '--offline'].includes(arg))) throw new Error('Use workspace-omp-install.mjs [--check] [--offline].');
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('The reviewed fixed OMP native package is Linux/x64; another platform needs its own audit.');
const home = await fs.mkdtemp('/tmp/workspace-omp-install-home-');
await fs.writeFile(home + '/empty-user.npmrc', '', { mode: 0o600 });
await fs.writeFile(home + '/empty-global.npmrc', '', { mode: 0o600 });
const env = { PATH: process.env.PATH, HOME: home, TMPDIR: home, NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  NPM_CONFIG_USERCONFIG: home + '/empty-user.npmrc', NPM_CONFIG_GLOBALCONFIG: home + '/empty-global.npmrc' };
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'CODEX_PROXY_CERT']) if (process.env[key]) env[key] = process.env[key];
if (!env.NODE_EXTRA_CA_CERTS && env.CODEX_PROXY_CERT) env.NODE_EXTRA_CA_CERTS = env.CODEX_PROXY_CERT;
const cache = process.env.WORKSPACE_OMP_AUDITED_NPM_CACHE || home + '/cache';
if (!path.isAbsolute(cache)) throw new Error('Use an absolute separately audited npm cache path.');
async function run(command, argv) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, argv, { cwd: directory, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '', timedOut = false, killTimer;
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1500); }, 120000);
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    child.on('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(error); }); child.on('close', code => { clearTimeout(timer); clearTimeout(killTimer);
      code === 0 && !timedOut ? resolve(output) : reject(new Error(timedOut ? 'OMP fixed installation exceeded its bounded deadline; its own process group was stopped.' : 'Fixed OMP npm installation failed: ' + output.slice(-2000))); });
  });
}
try {
  if (!args.includes('--check')) await run('npm', ['ci', '--ignore-scripts', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund',
    '--fetch-retries=1', '--fetch-timeout=30000', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000',
    '--registry=https://registry.npmjs.org', '--cache=' + cache, ...(args.includes('--offline') ? ['--offline'] : [])]);
  for (const name of ['pi-coding-agent', 'pi-ai', 'pi-agent-core', 'pi-tui', 'pi-natives', 'pi-natives-linux-x64']) {
    const manifest = JSON.parse(await fs.readFile(`${directory}/node_modules/@oh-my-pi/${name}/package.json`));
    if (manifest.name !== '@oh-my-pi/' + name || manifest.version !== '18.10.4') throw new Error('A fixed official OMP dependency differs from the reviewed version.');
  }
  for (const omitted of ['@huggingface/transformers', 'sherpa-onnx-node']) {
    if (await fs.stat(path.join(directory, 'node_modules', omitted)).then(() => true).catch(() => false)) throw new Error('An unrequested optional model component is present.');
  }
  console.log(JSON.stringify({ status: 'installed-verified', package: '@oh-my-pi/pi-coding-agent', version: '18.10.4',
    packageRoot: directory + 'node_modules/@oh-my-pi/pi-coding-agent', lifecycleScriptsRun: 0, optionalModelComponents: false, modelCalls: 0 }));
} finally { await fs.rm(home, { recursive: true, force: true }); }
