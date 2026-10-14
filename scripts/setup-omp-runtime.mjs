// Install only the audited fixed official Bun platform package. No downloaded
// shell installer, lifecycle hook, optional component or model credentials.
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../support/omp-bun-linux-x64/', import.meta.url));
const audit = JSON.parse(await fs.readFile(path.join(root, 'runtime-audit.json'), 'utf8'));
const binary = path.join(root, 'node_modules/@oven/bun-linux-x64-baseline/bin/bun');
const args = process.argv.slice(2);
if (args.length > 1 || args.length && args[0] !== '--check') throw new Error('Use setup-omp-runtime.mjs [--check]; no arbitrary source or execution input is accepted.');
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This audited runtime package is Linux/x64 only. A different official platform requires separate source/integrity verification.');

async function run(executable, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error('Official fixed runtime command failed: ' + output.slice(-4000))));
  });
}
const isolatedHome = await fs.mkdtemp('/tmp/workspace-omp-runtime-home-');
try {
  const userConfig = path.join(isolatedHome, 'empty-user.npmrc'), globalConfig = path.join(isolatedHome, 'empty-global.npmrc');
  await fs.writeFile(userConfig, ''); await fs.writeFile(globalConfig, '');
  const env = { PATH: process.env.PATH, HOME: isolatedHome, TMPDIR: isolatedHome,
    NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'CODEX_PROXY_CERT']) if (process.env[key]) env[key] = process.env[key];
  if (!env.NODE_EXTRA_CA_CERTS && env.CODEX_PROXY_CERT) env.NODE_EXTRA_CA_CERTS = env.CODEX_PROXY_CERT;
  if (args[0] !== '--check') await run('npm', ['ci', '--ignore-scripts', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund',
    '--fetch-retries=1', '--fetch-timeout=30000', '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000',
    '--registry=https://registry.npmjs.org', '--cache=' + path.join(isolatedHome, 'npm-cache')], root, env);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'node_modules/@oven/bun-linux-x64-baseline/package.json'), 'utf8'));
  if (manifest.name !== audit.package || manifest.version !== audit.fixedVersion) throw new Error('The runtime package does not match the audited fixed dependency.');
  if (createHash('sha256').update(await fs.readFile(binary)).digest('hex') !== audit.binarySha256) throw new Error('The runtime binary differs from the integrity-checked official artifact.');
  const version = await run(binary, ['--version'], root, env);
  if (version !== audit.verifiedBunVersion) throw new Error('The fixed Bun runtime returned a different version.');
  console.log(JSON.stringify({ status: 'installed-verified', runtime: 'official-bun', version, binary, lifecycleScriptsRun: 0, modelCalls: 0 }));
} finally { await fs.rm(isolatedHome, { recursive: true, force: true }); }
