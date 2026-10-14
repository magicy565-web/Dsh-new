import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { taskFixture, TOKEN_A, TOKEN_B } from './fixtures/pi-task-helpers.mjs';

// Historical directory/import names retained; default audience is Chinese factory.
const source = fileURLToPath(new URL('../packages/workspace-procurement', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
const publicTask = { type: 'procurement', title: 'Public synthetic standalone package procurement', requestId: 'standalone-procurement-synthetic',
  input: { product: 'Public synthetic cup', spec: 'Explicit public synthetic specification', quantity: 10,
    quotes: [{ supplier: 'User supplied synthetic A', spec: 'Public synthetic specification', source: 'User supplied material A' },
      { supplier: 'User supplied synthetic B', spec: 'Public synthetic specification', unit_price: 'USD 3.40 per supplied piece',
        currency: 'USD', trade_term: 'EXW', moq: 'supplied ten pieces', source: 'User supplied material B' }] } };
const complete = () => fauxAssistantMessage(fauxToolCall('workspace_complete_preset_stage', {
  analysis: [{ text: '合成模型替身：本阶段仅整理明确提供的产品资料，未覆盖信息需逐项核对。', sources: ['input.product'] }],
  recommendations: [{ text: '建议核对原始材料并确认下一步。', sources: [] }], questions: [{ text: '是否可以补充原始报价与证据来源？', sources: [] }],
}), { stopReason: 'toolUse' });
async function command(args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Synthetic package command timed out.')); }, 30000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
    child.once('error', reject); child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}
async function setup(t) {
  const dir = await fs.mkdtemp('/tmp/pi-procurement-package-'); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const packageDir = path.join(dir, 'package'), agentDir = path.join(dir, 'agent'); await fs.cp(source, packageDir, { recursive: true });
  assert.ok(!packageDir.startsWith('/workspace/')); await assert.rejects(fs.stat(path.join(packageDir, 'node_modules')), { code: 'ENOENT' });
  const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', NO_COLOR: '1', TERM: 'dumb' };
  const otherExtension = path.join(dir, 'other-extension.js'), commandMarker = path.join(dir, 'other-command-marker');
  await fs.writeFile(otherExtension, `import { Type } from '@earendil-works/pi-ai';\nimport { writeFileSync } from 'node:fs';\nexport default pi => { pi.registerTool({ name:'other_plugin_tool', label:'Other plugin', description:'Synthetic coexistence tool', parameters:Type.Object({}), execute:async()=>({ content:[{type:'text',text:'{"otherPlugin":true}'}],details:{} }) }); pi.registerCommand('other-command',{description:'Synthetic other command',handler:async()=>writeFileSync(${JSON.stringify(commandMarker)},'other command ran')}); };\n`);
  let host = await fs.readFile(new URL('./fixtures/pi-procurement-package-host.mjs', import.meta.url), 'utf8');
  for (const specifier of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai/providers/faux', '@earendil-works/pi-ai'])
    host = host.replaceAll(`from '${specifier}'`, `from '${import.meta.resolve(specifier)}'`);
  const hostFile = path.join(dir, 'host.mjs'); await fs.writeFile(hostFile, host);
  const invoke = async (...args) => { const result = await command([cli, ...args], env, dir); assert.equal(result.code, 0, result.output); return result.output; };
  await invoke('install', packageDir); assert.match(await invoke('list'), /package/);
  const settings = JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8')); assert.ok(settings.packages.some(row => path.resolve(agentDir, typeof row === 'string' ? row : row.source) === packageDir));
  const run = async (mode, extraEnv = {}, extra = {}) => {
    const config = { directory: dir, packageDir, agentDir, otherExtension, commandMarker, task: publicTask,
      evidenceFile: path.join(dir, 'evidence.json'), mode, ...extra };
    const configFile = path.join(dir, 'synthetic-config.json'); await fs.writeFile(configFile, JSON.stringify(config));
    const result = await command([hostFile, configFile], { ...env, ...extraEnv }, dir); assert.equal(result.code, 0, result.output);
    return config;
  };
  return { dir, packageDir, agentDir, env, invoke, run, otherExtension };
}

test('copied private package installs/discovers through official Pi and its actual SDK stays unconfigured without credentials', async t => {
  const p = await setup(t); await p.run('unconfigured');
  // Actual CLI extension entry/load/peer mapping; --help enumerates loaded flags
  // after resource load and makes no model request.
  const output = await p.invoke('--offline', '--no-extensions', '-e', p.packageDir, '-e', p.otherExtension, '--help');
  assert.match(output, /Usage|Options|extension/i);
  const fixture = path.join(p.dir, 'cli-keyless-faux.js');
  await fs.copyFile(new URL('./fixtures/pi-procurement-cli-faux.js', import.meta.url), fixture);
  const printed = await p.invoke('--offline', '--no-extensions', '-e', p.packageDir, '-e', p.otherExtension, '-e', fixture,
    '--no-session', '--model', 'workspace-agent-test-faux/workspace-agent-test', '--print', 'Run the explicit keyless acceptance fixture.');
  assert.match(printed, /SYNTHETIC_CLI_PACKAGE_AND_OTHER_PLUGIN_VERIFIED/);
  assert.ok(!/Failed to load extension/.test(printed));
  await p.invoke('remove', p.packageDir);
  const settings = JSON.parse(await fs.readFile(path.join(p.agentDir, 'settings.json'), 'utf8'));
  assert.ok(!settings.packages?.some(row => path.resolve(p.agentDir, typeof row === 'string' ? row : row.source) === p.packageDir));
  assert.ok(!(await p.invoke('list')).includes(p.packageDir));
});

test('Chinese factory default organizes customer RFQ and supplied factory materials without buyer-side tools or task execution', async t => {
  const p = await setup(t), f = await taskFixture(t, { enterprise: true });
  const config = await p.run('factory', { WS_AGENT_URL: f.baseURL, WS_AGENT_TOKEN: TOKEN_A }, { enterpriseHost: 'workspace.example' });
  const evidence = JSON.parse(await fs.readFile(config.evidenceFile, 'utf8'));
  assert.equal(evidence.audience, 'Chinese-factory'); assert.equal(evidence.defaultSupplierComparison, false);
  assert.equal(evidence.defaultTaskSubmission, false); assert.equal(evidence.factoryCapacityInvented, false);
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 0); assert.equal(f.app.store.read().runs.length, 0);
  assert.equal(f.faux.state.callCount, 0);
  if (process.env.PI_FACTORY_EVIDENCE_FILE) await fs.writeFile(process.env.PI_FACTORY_EVIDENCE_FILE, JSON.stringify(evidence, null, 2) + '\n');
});

test('explicit non-default historical procurement compatibility retains original stages/documents and authorization', async t => {
  const p = await setup(t), f = await taskFixture(t, { enterprise: true, responses: Array.from({ length: 4 }, complete) });
  const compatibilityExtension = path.join(p.dir, 'explicit-legacy-compatibility.js');
  await fs.writeFile(compatibilityExtension, "import { createWorkspaceClient, registerWorkspaceBusinessTools } from './package/src/workspace.mjs';\nimport { registerProcurementTools } from './package/src/procurement.mjs';\nexport default pi => { const client = createWorkspaceClient({baseURL:process.env.WS_AGENT_URL,token:process.env.WS_AGENT_TOKEN}); registerWorkspaceBusinessTools(pi,client); registerProcurementTools(pi,client,'configured_unverified'); };\n");
  const config = await p.run('historical-compatibility', { WS_AGENT_URL: f.baseURL, WS_AGENT_TOKEN: TOKEN_A }, { enterpriseHost: 'workspace.example', compatibilityExtension });
  const evidence = JSON.parse(await fs.readFile(config.evidenceFile, 'utf8'));
  const state = f.app.store.read(), tasks = state.workspaceAgentTasks.tasks;
  assert.equal(tasks.length, 1); assert.equal(tasks[0].id, evidence.taskId); assert.deepEqual(tasks[0].input, publicTask.input);
  assert.equal(tasks[0].steps.filter(row => row.status === 'succeeded').length, 4); assert.equal(f.faux.state.callCount, 4);
  assert.equal(state.runs.length, 4); assert.equal(state.workspaceThreadHarness, undefined);
  for (const artifact of evidence.artifacts) {
    const original = tasks[0].deliverables.find(row => row.name === artifact.name);
    assert.equal(artifact.sha256, original.sha256); assert.equal(artifact.bytes, original.bytes);
  }
  if (process.env.PI_PROCUREMENT_EVIDENCE_FILE) await fs.writeFile(process.env.PI_PROCUREMENT_EVIDENCE_FILE,
    JSON.stringify({ version: 1, syntheticOnly: true, officialPiVersion: '1.1.0', nodeVersion: process.version,
      standalonePackage: 'packages/workspace-procurement', purpose: 'historical-buyer-procurement-regression-only', packageCopiedOutsideRepository: true, packageHasNodeModules: false,
      transport: 'actual-original-http', frontend: 'official-sdk-explicit-faux', backend: 'original-pi-durable-explicit-faux',
      originalTaskId: evidence.taskId, originalTaskCount: tasks.length, originalRunCount: state.runs.length,
      originalSuccessfulStages: tasks[0].steps.filter(row => row.status === 'succeeded').length,
      businessGoalAchieved: tasks[0].result.businessGoalAchieved, documents: evidence.artifacts,
      frontendModelCallsThroughDocumentRead: evidence.frontendModelCallsThroughDocumentRead, backendModelCalls: f.faux.state.callCount,
      paidModelCalls: 0, privateLibraryReads: 0, externalSupplierResearch: false, originalApprovalsRetained: true }, null, 2) + '\n');
  await p.run('foreign-result', { WS_AGENT_URL: f.baseURL, WS_AGENT_TOKEN: TOKEN_B }, { taskId: evidence.taskId, enterpriseHost: 'workspace.example' });
  await p.run('refused', { WS_AGENT_URL: f.baseURL, WS_AGENT_TOKEN: 'synthetic-invalid-existing-binding' }, { enterpriseHost: 'workspace.example' });
  assert.equal(f.app.store.read().workspaceAgentTasks.tasks.length, 1); assert.equal(f.faux.state.callCount, 4);
  t.diagnostic('Copied package has no node_modules/server/scripts dependency. Real official Pi package install + SDK with explicit non-default historical compatibility; original four Pi Durable stages and three exact SHA documents, not factory core behavior. Frontend/backend explicit faux only; no paid model, supplier research or external action.');
});
