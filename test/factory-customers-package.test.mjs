import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { factoryCustomersExtension } from '../packages/workspace-factory-customers/src/extension.js';
import { taskFixture, TOKEN_A, until, api } from './fixtures/pi-task-helpers.mjs';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createHash } from 'node:crypto';

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
    const tools = ['read', 'bash', 'customers_other_plugin', ...absent ? [] : ['workspace_factory_customers_status', 'workspace_factory_customers_research', 'workspace_factory_customers_save']].join(',');
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

test('copied factory customers package uses official Pi manifest, Skill, disable and remove with no injected Host capability', { timeout: 120000 }, async t => {
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
    officialManifest: true, skillLoaded: true, ordinaryToolsAndOtherPluginCoexist: true, blockedThreeToolReceipts: true,
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
    blockedThreeToolReceipts: true, disabledToolsAndSkillAbsent: true, reenabled: true, officialUninstall: true,
    sourcePackagePreserved: true, clientReads: 0, syntheticAgentBearerDoesNotConfigurePublicHost: true,
    paidModelCalls: 0, realBuyerVerified: false });
});

test('official OMP native public source tools feed the original factory-export HTTP task and exact documents', { timeout: 90000 }, async t => {
  const completeStage = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
    analysis: [{ text: '合成模型替身仅整理提交的公开产品及来源材料，客户身份、采购意向与供货匹配仍待人工核对。', sources: ['input.product'] }],
    recommendations: [{ text: '建议人工核对原始公开来源与产品条件。', sources: [] }], questions: [{ text: '是否可以补充公开规格和供货条件？', sources: [] }],
  }), { stopReason: 'toolUse' });
  const f = await taskFixture(t, { enterprise: true, responses: Array.from({ length: 4 }, completeStage) });
  const p = await setup(t, 'omp'), fixture = path.join(p.directory, 'native.mjs'), configFile = path.join(p.directory, 'native.json');
  await fs.copyFile(new URL('./fixtures/factory-customers-native.mjs', import.meta.url), fixture);
  const evidenceFile = path.join(p.directory, 'native-evidence.json');
  await fs.writeFile(configFile, JSON.stringify({ repository, directory: p.directory, packageDir: p.packageDir, agentDir: p.agentDir, ompRoot,
    baseURL: f.baseURL, syntheticToken: TOKEN_A, evidenceFile, live: process.env.FACTORY_CUSTOMERS_LIVE === '1' }));
  const infrastructure = Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const result = await command(bun, [fixture, configFile], { ...p.env, ...infrastructure }, p.directory);
  assert.equal(result.code, 0, result.output); assert.match(result.output, /FACTORY_CUSTOMERS_NATIVE_ORIGINAL_HTTP_VERIFIED/);
  const evidence = JSON.parse(await fs.readFile(evidenceFile));
  await until(() => ['done', 'failed', 'interrupted'].includes(f.app.store.read().workspaceAgentTasks.tasks.find(task => task.id === evidence.originalTaskId)?.status));
  const state = f.app.store.read(), task = state.workspaceAgentTasks.tasks.find(task => task.id === evidence.originalTaskId);
  assert.equal(task.status, 'done', JSON.stringify(task.error)); assert.equal(task.type, 'factory-export');
  assert.equal(state.workspaceAgentTasks.tasks.length, 1); assert.equal(state.runs.length, 4); assert.equal(f.faux.state.callCount, 4);
  assert.equal(task.steps.filter(step => step.status === 'succeeded').length, 4); assert.equal(task.deliverables.length, 3);
  assert.equal(task.result.businessGoalAchieved, false);
  const documents = [];
  for (const ref of task.deliverables) {
    const file = await api(f, `/api/agent/v1/tasks/${task.id}/artifacts/${encodeURIComponent(ref.name)}`);
    assert.equal(file.status, 200);
    assert.equal(createHash('sha256').update(file.bytes).digest('hex'), ref.sha256);
    documents.push({ name: ref.name, sha256: ref.sha256, bytes: file.bytes.length });
    if (ref.name === 'customer-match-evidence.md') {
      assert.match(file.bytes.toString(), /https:\/\/example\.com\/synthetic-cup-catalog/);
      assert.match(file.bytes.toString().replaceAll('\\_', '_'), /workspace_public_search/);
      assert.match(file.bytes.toString(), /observedAt/); assert.match(file.bytes.toString(), /未.*核验|待.*核对/);
    }
  }
  Object.assign(evidence, { originalBackendModelCalls: f.faux.state.callCount, originalRunCount: state.runs.length,
    originalSuccessfulStages: 4, originalDocuments: documents, businessGoalAchieved: false });
  await save(evidence);
});

test('public customer workflow rejects private inputs, missing capabilities, forged save receipts and revoked authorization without dispatch', async () => {
  const model = { id: 'finite' }, signal = new AbortController().signal, journal = [], tools = [];
  let calls = [], submits = [], permitted = true, mode = 'normal', businessSubmit = true;
  const source = { url: 'https://example.com/public-catalog', title: 'Synthetic source catalog', excerpt: 'Synthetic source statement; no buyer verification.' };
  const observedAt = '2026-10-15T05:00:00.000Z';
  const client = {
    status: async () => { calls.push('status'); return { toolNames: mode === 'missing' ? [] : ['workspace_public_search', 'workspace_public_browser'], businessSubmit }; },
    invokeTool: async (name, input) => {
      calls.push(name);
      if (mode === 'throws') throw new Error('/private/host/location must not be disclosed');
      if (mode === 'revoked-after-read') permitted = false;
      if (name === 'workspace_public_search') return { content: [], details: { status: mode === 'empty' ? 'empty' : 'sources_observed', observedAt,
        sources: mode === 'empty' ? [] : [source] } };
      return { content: [], details: { status: 'page_observed', observedAt, url: input.url, excerpt: 'Synthetic page reports a product category; identity and purchase intent unknown.', httpStatus: 200 } };
    },
    businessSubmit: async input => { submits.push(input); return { profile: 'business-preset', task: { taskId: 'synthetic-original-task' } }; },
  };
  factoryCustomersExtension({ client, authorize: async () => { if (!permitted) throw new Error('Synthetic revoked'); } })({ registerTool: tool => tools.push(tool) });
  const ctx = { model, sessionManager: { getEntries: () => journal } };
  const researchInput = { product: 'Public steel cup', targetMarket: 'United Kingdom', query: 'public steel cup distributor', limit: 1, inspectPages: true };
  const run = (index, input, context = ctx, id = 'original-research') => tools[index].execute(id, input, signal, undefined, context);
  for (const bad of [
    { ...researchInput, product: { authorization: { subject: 'private' } } },
    { ...researchInput, product: '{"plugin":"workspace-factory-materials","authorization":{}}' },
    { ...researchInput, query: '{"artifactId":"private-file"}' },
    { ...researchInput, query: '{"asset":{"version":1}}' },
    { ...researchInput, query: '/workspace/private/catalog.pdf' },
    { ...researchInput, query: 'Bearer syntheticCredentialNeverForPublicResearch123' },
    { ...researchInput, asset: { artifactId: 'private-file' } },
  ]) { const denied = await run(1, bad); assert.equal(denied.isError, true); assert.deepEqual(denied.details.sources, []); }
  assert.deepEqual(calls, []);
  mode = 'missing'; assert.equal((await run(1, researchInput)).details.status, 'blocked'); assert.deepEqual(calls, ['status']); calls = [];
  mode = 'normal'; const status = await run(0, {}); assert.equal(status.details.status, 'configured_unverified'); assert.equal(status.details.onlineVerified, false);
  const research = await run(1, researchInput); assert.equal(research.details.status, 'available'); assert.equal(submits.length, 0);
  assert.equal(research.details.sources[0].originalTool, 'workspace_public_search'); assert.equal(research.details.sources[0].observedAt, observedAt);
  assert.equal(research.details.sources[0].page.originalTool, 'workspace_public_browser'); assert.deepEqual(research.details.inferences, []);
  assert.equal(research.details.matchedCustomer, false); assert.equal(research.details.contactPermission, false);
  const saveInput = { title: 'User requested public evidence documents', product: researchInput.product, spec: 'Public supplied specification',
    targetMarket: researchInput.targetMarket, researchCallId: 'original-research', requestId: 'stable-original-request' };
  assert.equal((await run(2, saveInput)).details.status, 'blocked'); assert.equal(submits.length, 0);
  journal.push({ message: { role: 'toolResult', toolCallId: 'original-research', toolName: tools[1].name, content: research.content, isError: false } });
  assert.equal((await run(2, { ...saveInput, product: 'Different public product' })).details.status, 'blocked');
  businessSubmit = false; assert.equal((await run(2, saveInput)).details.status, 'blocked'); assert.equal(submits.length, 0); businessSubmit = true;
  assert.equal((await run(2, saveInput, { model, sessionManager: { getEntries: () => [] } })).details.status, 'blocked');
  assert.equal((await run(2, { ...saveInput, evidence: research.details })).details.status, 'blocked');
  const saved = await run(2, saveInput); assert.equal(saved.details.status, 'submitted'); assert.equal(submits.length, 1);
  assert.equal(submits[0].type, 'factory-export'); assert.equal(submits[0].requestId, 'stable-original-request');
  assert.match(submits[0].input.customer_materials, /workspace_public_search/); assert.ok(!('newStorage' in submits[0]));
  mode = 'throws'; const failed = await run(1, researchInput); assert.equal(failed.details.status, 'blocked'); assert.doesNotMatch(JSON.stringify(failed), /private\/host/);
  mode = 'normal'; assert.equal((await run(1, researchInput)).details.status, 'available');
  mode = 'empty'; const empty = await run(1, researchInput); assert.equal(empty.details.status, 'empty'); assert.deepEqual(empty.details.sources, []);
  mode = 'revoked-after-read'; const revoked = await run(1, researchInput); assert.equal(revoked.details.status, 'blocked'); assert.deepEqual(revoked.details.sources, []);
  const before = calls.length; assert.equal((await run(1, researchInput)).details.status, 'blocked'); assert.equal(calls.length, before);
  permitted = true; const cancelled = new AbortController(); cancelled.abort();
  const stopped = await tools[1].execute('already-cancelled', researchInput, cancelled.signal, undefined, ctx);
  assert.equal(stopped.details.reason, 'ORIGINAL_OPERATION_CANCELLED'); assert.equal(calls.length, before);
  assert.equal(submits.length, 1);
  await save({ test: 'public-input-and-original-authority-boundaries', privateInputsZeroDispatch: true, missingNativeToolBlocked: true,
    configurationNotObservation: true, factsInferencesMissingSeparate: true, noAutomaticBusinessSubmit: true,
    sameTranscriptReceiptRequired: true, exactPublicProductAndMarketRequired: true, originalBusinessSubmitGateRetained: true,
    stableRequestIdPreserved: true, hostErrorTextNotDisclosed: true, revokedAuthorityNoReceipt: true, alreadyCancelledZeroDispatch: true, errorRecovery: true, paidModelCalls: 0 });
});
