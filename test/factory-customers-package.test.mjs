import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { factoryCustomersExtension, validateCustomerDrafts } from '../packages/workspace-factory-customers/src/extension.js';

const repository = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(repository, 'packages/workspace-factory-customers');
const piCli = path.join(repository, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const bun = path.join(repository, 'support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun');
const ompRoot = path.join(repository, 'support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent');
const packageName = '@workspace-agent/pi-factory-customers';
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
  const directory = await fs.mkdtemp('/tmp/factory-customers-package-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const packageDir = path.join(directory, 'copied-package'), agentDir = path.join(directory, 'agent');
  await fs.cp(source, packageDir, { recursive: true }); await fs.mkdir(agentDir);
  await assert.rejects(fs.stat(path.join(packageDir, 'node_modules')), { code: 'ENOENT' });
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'));
  assert.equal(manifest.name, packageName); assert.equal(manifest.private, true); assert.equal(manifest.scripts, undefined); assert.equal(manifest.dependencies, undefined);
  const env = { PATH: path.dirname(bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: '1', PI_NO_TITLE: '1', NO_COLOR: '1', TERM: 'dumb',
    WS_AGENT_URL: 'http://127.0.0.1:9', WS_AGENT_TOKEN: 'synthetic-agent-bearer-is-not-a-library-session',
    FACTORY_CUSTOMERS_PI_AI: import.meta.resolve('@earendil-works/pi-ai'), FACTORY_CUSTOMERS_OMP_ROOT: ompRoot };
  if (engine === 'omp') await fs.writeFile(path.join(agentDir, 'config.yml'),
    'startup:\n  checkUpdate: false\n  setupWizard: false\ntelemetry:\n  otlpExportEnabled: false\nretry:\n  enabled: false\n  modelFallback: false\ncompaction:\n  enabled: false\n  midTurnEnabled: false\neval:\n  autoProvision: false\n  py: false\n');
  const executable = engine === 'pi' ? process.execPath : bun;
  const cli = engine === 'pi' ? piCli : path.join(ompRoot, 'dist/cli.js');
  const invoke = async (...args) => {
    const result = await command(executable, [cli, ...args], env, directory);
    assert.equal(result.code, 0, result.output); return result.output;
  };
  const cliFixture = path.join(directory, 'finite-cli.mjs'); await fs.copyFile(new URL('./fixtures/factory-customers-cli.mjs', import.meta.url), cliFixture);
  const verify = async absent => {
    const args = engine === 'pi' ? ['--offline', '--no-session', '--print'] : ['--no-title', '--no-prewalk', '--no-lsp', '--no-rules', '--no-session', '--print'];
    const tools = ['read', 'bash', 'customers_other_plugin', ...absent ? [] : ['workspace_factory_customers_save']].join(',');
    const result = await command(executable, [cli, ...args, '-e', cliFixture, '--tools', tools, '--model', 'factory-customers-cli-faux/finite',
      'Run only the finite explicit keyless package acceptance fixture.'], { ...env, FACTORY_CUSTOMERS_EXPECT: absent ? 'absent' : 'present' }, directory);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, absent ? /FACTORY_CUSTOMERS_ABSENT_AND_OTHER_PLUGIN_VERIFIED/ : /FACTORY_CUSTOMERS_MANIFEST_BLOCKED_AND_NATIVE_COEXISTENCE_VERIFIED/);
    assert.doesNotMatch(result.output, /Failed to load extension/);
  };
  return { directory, packageDir, agentDir, env, executable, invoke, verify };
}
async function save(evidence) {
  facts.push(evidence);
  if (process.env.FACTORY_CUSTOMERS_PACKAGE_FACTS) await fs.writeFile(process.env.FACTORY_CUSTOMERS_PACKAGE_FACTS,
    JSON.stringify({ version: 1, package: packageName, tests: facts }, null, 2) + '\n');
}

test('copied factory customers package uses official Pi manifest, Skill, disable and remove with no injected save Host', { timeout: 120000 }, async t => {
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
    officialManifest: true, skillLoaded: true, ordinaryToolsAndOtherPluginCoexist: true, unconfiguredSaveReceipt: true, retiredResearchAndStatusAbsent: true,
    disabledToolsAndSkillAbsent: true, reenabled: true, officialRemove: true, sourcePackagePreserved: true,
    clientReads: 0, syntheticAgentBearerDoesNotConfigurePublicHost: true, paidModelCalls: 0, realBuyerVerified: false });
});

test('copied factory customers package uses official OMP local link, manifest, Skill, disable and uninstall', { timeout: 120000 }, async t => {
  assert.equal(JSON.parse(await fs.readFile(path.join(ompRoot, 'package.json'))).version, '18.10.4');
  const p = await setup(t, 'omp');
  await p.invoke('plugin', 'link', p.packageDir); assert.match(await p.invoke('plugin', 'list'), /pi-factory-customers/);
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
    unconfiguredSaveReceipt: true, retiredResearchAndStatusAbsent: true, disabledToolsAndSkillAbsent: true, reenabled: true, officialUninstall: true,
    sourcePackagePreserved: true, clientReads: 0, syntheticAgentBearerDoesNotConfigurePublicHost: true,
    paidModelCalls: 0, realBuyerVerified: false });
});

test('official OMP model tool loop selects native public tools directly and saves model-written text through a thin client', { timeout: 90000 }, async t => {
  const p = await setup(t, 'omp'), fixture = path.join(p.directory, 'native.mjs'), configFile = path.join(p.directory, 'native.json');
  await fs.copyFile(new URL('./fixtures/factory-customers-native.mjs', import.meta.url), fixture);
  const evidenceFile = path.join(p.directory, 'native-evidence.json');
  await fs.writeFile(configFile, JSON.stringify({ repository, directory: p.directory, packageDir: p.packageDir, agentDir: p.agentDir, ompRoot, evidenceFile }));
  const result = await command(bun, [fixture, configFile], p.env, p.directory);
  assert.equal(result.code, 0, result.output); assert.match(result.output, /FACTORY_CUSTOMERS_DIRECT_NATIVE_SDK_VERIFIED/);
  await save(JSON.parse(await fs.readFile(evidenceFile)));
});

test('thin save adapter bounds public drafts and preserves original authorization, cancellation, errors and recovery', async () => {
  const model = { id: 'finite' }, controller = new AbortController(), tools = [];
  let dispatches = 0, authorized = 0, permitted = true, mode = 'normal';
  const client = { save: async (input, signal, receiver) => {
    dispatches++; assert.equal(receiver, model); assert.equal(signal, controller.signal);
    if (mode === 'throws') throw new Error('/private/host/secret never disclosed');
    if (mode === 'revoke') permitted = false;
    if (mode === 'cancel') controller.abort();
    return { plugin: 'workspace-factory-customers', status: mode === 'host-blocked' ? 'blocked' : 'saved-draft',
      requestId: input.requestId, documents: input.documents.map(row => ({ name: row.name })), sources: [], sent: false, humanReviewRequired: true };
  } };
  factoryCustomersExtension({ client, authorize: async () => { authorized++; if (!permitted) throw new Error('Synthetic revocation'); } })({ registerTool: tool => tools.push(tool) });
  assert.deepEqual(tools.map(tool => tool.name), ['workspace_factory_customers_save']);
  const input = { requestId: 'stable-original-id', documents: [{ name: 'candidate-notes.md', content: 'Public source statements. Fit and contact permission remain pending.' }], sourceToolCallIds: ['original-native-search'] };
  const validated = validateCustomerDrafts(input); assert.deepEqual(validated, input); assert.notEqual(validated.documents, input.documents); assert.notEqual(validated.sourceToolCallIds, input.sourceToolCallIds);
  const run = (value = input, context = { model }) => tools[0].execute('save', value, controller.signal, undefined, context);
  for (const bad of [
    { ...input, documents: [{ name: '../escape.md', content: 'public' }] },
    { ...input, documents: [{ name: 'candidate.md', content: '{"authorization":{}}' }] },
    { ...input, documents: [{ name: 'candidate.md', content: 'workspace-factory-materials receipt' }] },
    { ...input, documents: [{ name: 'candidate.md', content: '/workspace/private/catalog.pdf' }] },
    { ...input, documents: [{ name: 'candidate.md', content: 'Bearer syntheticCredentialNeverPublic' }] },
    { ...input, documents: [{ name: 'candidate.md', content: 'x'.repeat(24001) }] },
    { ...input, documents: [...input.documents, ...input.documents] },
    { ...input, documents: Array.from({length: 3}, (_, i) => ({name: `draft-${i}.md`, content: 'x'.repeat(21000)})) },
    { ...input, sourceToolCallIds: [] }, { ...input, sourceToolCallIds: ['repeat', 'repeat'] },
    { ...input, sources: [{ url: 'https://forged.invalid' }] }, { ...input, product: 'retired pipeline input' },
  ]) assert.equal((await run(bad)).details.status, 'blocked');
  assert.equal(dispatches, 0); assert.equal(authorized, 0);
  assert.equal((await run(input, {})).details.reason, 'EXACT_MODEL_RECEIVER_REQUIRED'); assert.equal(dispatches, 0);
  const defaults = []; factoryCustomersExtension()({ registerTool: tool => defaults.push(tool) });
  assert.equal((await defaults[0].execute('default', input, controller.signal, undefined, { model })).details.status, 'unconfigured');
  const saved = await run(); assert.equal(saved.details.status, 'saved-draft'); assert.equal(saved.details.sent, false); assert.equal(dispatches, 1); assert.equal(authorized, 2);
  // Text is forwarded, never templated or converted into a fixed task/stage plan.
  assert.deepEqual(saved.details.documents, [{ name: 'candidate-notes.md' }]);
  mode = 'host-blocked'; assert.equal((await run()).isError, true);
  mode = 'throws'; const failed = await run(); assert.equal(failed.details.status, 'blocked'); assert.doesNotMatch(JSON.stringify(failed), /private\/host|secret/);
  mode = 'normal'; assert.equal((await run()).details.status, 'saved-draft');
  mode = 'revoke'; assert.equal((await run()).details.status, 'blocked'); const before = dispatches;
  assert.equal((await run()).details.status, 'blocked'); assert.equal(dispatches, before);
  permitted = true; mode = 'cancel'; assert.equal((await run()).details.reason, 'ORIGINAL_OPERATION_CANCELLED');
  const cancelledCalls = dispatches; assert.equal((await run()).details.reason, 'ORIGINAL_OPERATION_CANCELLED'); assert.equal(dispatches, cancelledCalls);
  await save({ test: 'thin-save-boundaries', publicDraftInvalidInputZeroDispatch: true, missingModelZeroDispatch: true,
    noClientUnconfigured: true, beforeAfterAuthorization: true, hostBlockedPreserved: true, noHostErrorText: true,
    revokedNoReceipt: true, cancelledZeroFurtherDispatch: true, errorRecovery: true, noPackageReceiptAuthority: true,
    noPluginResearchDispatchOrBusinessTask: true, paidModelCalls: 0 });
});
