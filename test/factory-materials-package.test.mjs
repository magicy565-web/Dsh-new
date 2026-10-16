import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { factoryMaterialsExtension } from '../plugins/workspace-factory-materials/src/extension.js';

const repository = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(repository, 'plugins/workspace-factory-materials');
const piCli = path.join(repository, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const bun = path.join(repository, 'support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun');
const ompRoot = path.join(repository, 'support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent');
const packageName = '@workspace-agent/pi-factory-materials';
const facts = [];
async function command(executable, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false, killTimer;
    const kill = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 1000); }, 35000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
    child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.once('close', code => { clearTimeout(timer); clearTimeout(killTimer);
      if (timedOut) reject(new Error('Only the isolated official acceptance process group timed out: ' + output.slice(-2000)));
      else resolve({ code, output }); });
  });
}
async function setup(t, engine) {
  const directory = await fs.mkdtemp('/tmp/factory-materials-package-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const packageDir = path.join(directory, 'copied-package'), agentDir = path.join(directory, 'agent');
  await fs.cp(source, packageDir, { recursive: true }); await fs.mkdir(agentDir);
  await assert.rejects(fs.stat(path.join(packageDir, 'node_modules')), { code: 'ENOENT' });
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'));
  assert.equal(manifest.name, packageName); assert.equal(manifest.private, true); assert.equal(manifest.scripts, undefined); assert.equal(manifest.dependencies, undefined);
  const env = { PATH: path.dirname(bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: '1', PI_NO_TITLE: '1', NO_COLOR: '1', TERM: 'dumb',
    WS_AGENT_URL: 'http://127.0.0.1:9', WS_AGENT_TOKEN: 'synthetic-agent-bearer-is-not-a-library-session',
    FACTORY_MATERIALS_PI_AI: import.meta.resolve('@earendil-works/pi-ai'), FACTORY_MATERIALS_OMP_ROOT: ompRoot };
  if (engine === 'omp') await fs.writeFile(path.join(agentDir, 'config.yml'),
    'startup:\n  checkUpdate: false\n  setupWizard: false\ntelemetry:\n  otlpExportEnabled: false\nretry:\n  enabled: false\n  modelFallback: false\ncompaction:\n  enabled: false\n  midTurnEnabled: false\neval:\n  autoProvision: false\n  py: false\n');
  const executable = engine === 'pi' ? process.execPath : bun;
  const cli = engine === 'pi' ? piCli : path.join(ompRoot, 'dist/cli.js');
  const invoke = async (...args) => {
    const result = await command(executable, [cli, ...args], env, directory);
    assert.equal(result.code, 0, result.output); return result.output;
  };
  const cliFixture = path.join(directory, 'finite-cli.mjs'); await fs.copyFile(new URL('./fixtures/factory-materials-cli.mjs', import.meta.url), cliFixture);
  const verify = async absent => {
    const args = engine === 'pi' ? ['--offline', '--no-session', '--print'] : ['--no-title', '--no-prewalk', '--no-lsp', '--no-rules', '--no-session', '--print'];
    const tools = ['read', 'bash', 'materials_other_plugin', ...absent ? [] : ['workspace_factory_materials_status', 'workspace_factory_materials', 'workspace_factory_document']].join(',');
    const result = await command(executable, [cli, ...args, '-e', cliFixture, '--tools', tools, '--model', 'factory-materials-cli-faux/finite',
      'Run only the finite explicit keyless package acceptance fixture.'], { ...env, FACTORY_MATERIALS_EXPECT: absent ? 'absent' : 'present' }, directory);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, absent ? /FACTORY_MATERIALS_ABSENT_AND_OTHER_PLUGIN_VERIFIED/ : /FACTORY_MATERIALS_MANIFEST_UNCONFIGURED_AND_NATIVE_COEXISTENCE_VERIFIED/);
    assert.doesNotMatch(result.output, /Failed to load extension/);
  };
  return { directory, packageDir, agentDir, env, executable, invoke, verify };
}
async function save(evidence) {
  facts.push(evidence);
  if (process.env.FACTORY_MATERIALS_PACKAGE_FACTS) await fs.writeFile(process.env.FACTORY_MATERIALS_PACKAGE_FACTS,
    JSON.stringify({ version: 1, package: packageName, tests: facts }, null, 2) + '\n');
}

test('copied factory materials package uses official Pi manifest, Skill, disable and remove with no injected private access', { timeout: 120000 }, async t => {
  assert.equal(JSON.parse(await fs.readFile(path.join(repository, 'node_modules/@earendil-works/pi-coding-agent/package.json'))).version, '1.1.0');
  const p = await setup(t, 'pi');
  await p.invoke('install', p.packageDir); assert.match(await p.invoke('list'), /copied-package/);
  await p.verify(false);
  const settingsFile = path.join(p.agentDir, 'settings.json');
  const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  settings.packages = settings.packages.map(row => ({ source: typeof row === 'string' ? row : row.source, extensions: [], skills: [] }));
  await fs.writeFile(settingsFile, JSON.stringify(settings)); await p.verify(true);
  settings.packages = [p.packageDir]; await fs.writeFile(settingsFile, JSON.stringify(settings)); await p.verify(false);
  await p.invoke('remove', p.packageDir); await p.verify(true);
  assert.ok(!(await p.invoke('list')).includes(p.packageDir));
  await fs.access(path.join(p.packageDir, 'package.json'));
  await save({ engine: 'pi', version: '1.1.0', copiedOutsideRepository: true, packageNodeModules: false,
    officialManifest: true, skillLoaded: true, ordinaryToolsAndOtherPluginCoexist: true, unconfiguredThreeToolReceipts: true,
    disabledToolsAndSkillAbsent: true, reenabled: true, officialRemove: true, sourcePackagePreserved: true,
    clientReads: 0, syntheticAgentBearerDoesNotConfigureLibrary: true, paidModelCalls: 0, realLibraryAuthorizationVerified: false });
});

test('copied factory materials package uses official OMP local link, manifest, Skill, disable and uninstall', { timeout: 120000 }, async t => {
  assert.equal(JSON.parse(await fs.readFile(path.join(ompRoot, 'package.json'))).version, '18.10.4');
  const p = await setup(t, 'omp');
  await p.invoke('plugin', 'link', p.packageDir); assert.match(await p.invoke('plugin', 'list'), /pi-factory-materials/);
  await p.verify(false);
  await p.invoke('plugin', 'disable', packageName); await p.verify(true);
  await p.invoke('plugin', 'enable', packageName); await p.verify(false);
  // Only a local link to this audited script-free/dependency-free package is
  // present in the isolated plugin home; uninstall cannot run unknown hooks.
  await p.invoke('plugin', 'uninstall', packageName); await p.verify(true);
  assert.ok(!(await p.invoke('plugin', 'list')).includes(packageName));
  await fs.access(path.join(p.packageDir, 'package.json'));
  await save({ engine: 'omp', version: '18.10.4', copiedOutsideRepository: true, packageNodeModules: false,
    officialLocalLink: true, officialManifest: true, skillLoaded: true, ordinaryToolsAndOtherPluginCoexist: true,
    unconfiguredThreeToolReceipts: true, disabledToolsAndSkillAbsent: true, reenabled: true, officialUninstall: true,
    sourcePackagePreserved: true, clientReads: 0, syntheticAgentBearerDoesNotConfigureLibrary: true,
    paidModelCalls: 0, realLibraryAuthorizationVerified: false });
});

for (const engine of ['pi', 'omp']) test(`official ${engine} SDK executes injected factory material tools, authorization refusal and recovery with finite keyless receipts`, { timeout: 60000 }, async t => {
  const p = await setup(t, engine), fixture = path.join(p.directory, 'sdk-fixture.mjs'), configFile = path.join(p.directory, 'config.json');
  await fs.copyFile(new URL('./fixtures/factory-materials-sdk.mjs', import.meta.url), fixture);
  const evidenceFile = path.join(p.directory, 'facts.json');
  await fs.writeFile(configFile, JSON.stringify({ engine, directory: p.directory, packageDir: p.packageDir, agentDir: p.agentDir, ompRoot, evidenceFile,
    piSdk: import.meta.resolve('@earendil-works/pi-coding-agent'), piAi: import.meta.resolve('@earendil-works/pi-ai'), piFaux: import.meta.resolve('@earendil-works/pi-ai/providers/faux') }));
  const result = await command(p.executable, [fixture, configFile], p.env, p.directory);
  assert.equal(result.code, 0, result.output);
  const evidence = JSON.parse(await fs.readFile(evidenceFile, 'utf8'));
  assert.equal(evidence.clientReads, 9); assert.equal(evidence.authorizationChecks, 19); assert.equal(evidence.modelCalls, 30);
  await save(evidence);
});

test('partial injection grants no access and runtime selectors remain narrow before dispatch', async () => {
  const tools = [], calls = [];
  factoryMaterialsExtension({ client: { status: () => calls.push('status'), materials: () => calls.push('materials'), document: () => calls.push('document') } })({ registerTool: tool => tools.push(tool) });
  const ctx = { model: { id: 'synthetic-model' } }, signal = new AbortController().signal;
  const receipt = await tools[0].execute('synthetic', {}, signal, undefined, ctx);
  assert.equal(receipt.details.status, 'unconfigured'); assert.deepEqual(calls, []);
  assert.equal((await tools[0].execute('synthetic', { workspaceId: 'other' }, signal, undefined, ctx)).isError, true);
  assert.equal((await tools[1].execute('synthetic', { productId: 'not-a-uuid' }, signal, undefined, ctx)).isError, true);
  assert.equal((await tools[1].execute('synthetic', { path: '/not-selected' }, signal, undefined, ctx)).isError, true);
  assert.equal((await tools[1].execute('synthetic', { fields: ['private'] }, signal, undefined, ctx)).isError, true);
  assert.equal((await tools[2].execute('synthetic', { documentId: '11111111-1111-4111-8111-111111111111', documentVersion: 1, path: '/not-selected' }, signal, undefined, ctx)).isError, true);
  assert.deepEqual(calls, []);
  const configured = [];
  factoryMaterialsExtension({ client: { status: () => calls.push('status'), materials: () => {}, document: () => {} },
    authorize: () => calls.push('authorize') })({ registerTool: tool => configured.push(tool) });
  const missingModel = await configured[0].execute('synthetic', {}, signal, undefined, { model: undefined });
  assert.equal(missingModel.isError, true); assert.equal(missingModel.details.status, 'blocked');
  assert.deepEqual(calls, []);
});
