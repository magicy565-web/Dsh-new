import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { createAgentSession, createMcpExtension, DefaultResourceLoader, ModelRuntime, SettingsManager, SessionManager } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';

const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const faux = fauxProvider({ api: 'faux', provider: 'community-parent', models: [{ id: 'parent', maxTokens: 1000 }] });
const childModel = fauxProvider({ api: 'faux', provider: 'community-keyless', models: [{ id: 'child', maxTokens: 1000 }] });
const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
runtime.registerNativeProvider(faux.provider); runtime.registerNativeProvider(childModel.provider);
const settings = SettingsManager.create(config.cwd, config.agentDir); settings.setCompactionEnabled(false);
const loader = new DefaultResourceLoader({ cwd: config.cwd, agentDir: config.agentDir, settingsManager: settings, noContextFiles: true,
  extensionFactories: config.mcp ? [createMcpExtension()] : [] });
await loader.reload();
const evidence = { officialPiVersion: '1.1.0', nodeVersion: process.version, errors: loader.getExtensions().errors, extensionPaths: loader.getExtensions().extensions.map(row => row.path), calls: [], paidModels: 0 };
await fs.writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2));
assert.deepEqual(evidence.errors, []);
const { session } = await createAgentSession({ cwd: config.cwd, agentDir: config.agentDir, settingsManager: settings, resourceLoader: loader,
  modelRuntime: runtime, model: faux.getModel(), sessionManager: SessionManager.create(config.cwd, config.agentDir + '/sessions') });
session.subscribe(event => {
  const dir = event.type === 'tool_execution_end' ? event.result?.details?.asyncDir : undefined;
  if (dir && process.env.PI_COMMUNITY_CHILD_LAUNCH_FILE) {
    // Record only launches owned by this isolated fixture, for bounded failure cleanup.
    void fs.appendFile(process.env.PI_COMMUNITY_CHILD_LAUNCH_FILE, JSON.stringify({ asyncDir: dir }) + '\n');
  }
});
let shutdownRequested = false;
async function nativeShutdown() {
  if (shutdownRequested) return;
  shutdownRequested = true;
  await session.abort();
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
  session.dispose();
}
process.once('SIGTERM', () => void nativeShutdown().then(() => process.exit(1)));
const server = createServer((req, res) => {
  if (req.url === '/hang') return;
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><title>Public synthetic export distributor</title><article><h1>Example distributor</h1><p>Public synthetic household cup distributor evidence. This fixture is not a real lead.</p></article></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
async function call(tool, args, { allowError = false, cancel = false } = {}) {
  faux.setResponses([fauxAssistantMessage(fauxToolCall(tool, args), { stopReason: 'toolUse' }), fauxAssistantMessage('Explicit synthetic tool receipt checked.')]);
  let timer;
  const off = cancel ? session.subscribe(event => { if (event.type === 'tool_execution_start' && event.toolName === tool) timer = setTimeout(() => void session.abort(), 150); }) : () => {};
  const started = Date.now();
  try { await session.prompt('Execute this exact authorized keyless acceptance call.'); } finally { off(); clearTimeout(timer); }
  const row = session.messages.filter(row => row.role === 'toolResult').at(-1);
  evidence.calls.push({ tool, args: { ...args, ...(args.proxy ? { proxy: '[allowlisted existing transport proxy]' } : {}) }, isError: row?.isError, durationMs: Date.now() - started, content: row?.content, details: row?.details });
  await fs.writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2));
  if (!allowError) assert.equal(row?.isError, false, JSON.stringify(row));
  return row;
}
try {
  await session.bindExtensions({}); evidence.activeTools = session.getActiveToolNames();
  if (config.mode === 'documents-missing-runtime-synthetic') {
    evidence.scenario = 'Synthetic isolation without Python/uv; JS fallback does not establish default document runtime readiness';
    for (const pdf of ['product-text.pdf', 'product-scan.pdf']) {
      await call('doc_to_md', { path: config.cwd + '/' + pdf, outputDir: config.cwd + '/' + pdf + '-bundle', ocr: false });
    }
    evidence.complete = true; await fs.writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2));
    console.log('Synthetic missing-runtime document scenario complete');
    process.exitCode = 0;
  } else {
  for (const tool of ['read', 'bash', 'fetch', 'doc_to_md', 'fetch_content', 'subagent']) assert.ok(evidence.activeTools.includes(tool), tool);
  if (config.factoryPackage) assert.ok(evidence.activeTools.includes('workspace_factory_capabilities'));
  await call('fetch', { url: base + '/source' });
  if (config.mcp) {
    evidence.mcpTools = session.getActiveToolNames().filter(name => name.startsWith('mcp__'));
    assert.ok(evidence.mcpTools.includes('mcp__community_web__fetch_content'));
    await call('mcp__community_web__fetch_content', { url: 'https://example.com', mode: 'raw' }, { allowError: true });
  }
  await call('fetch', { url: base + '/hang', timeoutMs: 10000 }, { cancel: true, allowError: true });
  assert.ok(evidence.calls.at(-1).durationMs < 3000);
  assert.equal(evidence.calls.at(-1).isError, true);
  assert.match(evidence.calls.at(-1).content[0].text, /abort|cancel/i);
  // Source protections stay enabled. Loopback must fail closed for web-access.
  const denied = await call('fetch_content', { url: base + '/source', mode: 'raw' }, { allowError: true });
  evidence.webPrivateAddressDenied = denied.isError === true;
  assert.equal(evidence.webPrivateAddressDenied, true);
  assert.match(denied.content[0].text, /Blocked internal address.*127\.0\.0\.1/);
  await call('fetch_content', { url: 'https://example.com', mode: 'raw' }, { allowError: true });
  if (evidence.activeTools.includes('web_search')) await call('web_search', { query: 'stainless steel reusable cup distributors Europe', provider: 'duckduckgo', numResults: 3, includeContent: false, workflow: 'none', ...(process.env.HTTPS_PROXY ? { proxy: process.env.HTTPS_PROXY } : {}) }, { allowError: true });
  evidence.normalDocToMd = { status: 'blocked-not-executed', reason: 'Source audit finds automatic uv/pip downloads; installed Python lacks required pymupdf4llm>=1.27.0. No approved automatic component installation.' };
  const child = await call('subagent', { agent: 'public-fixture', agentScope: 'user', task: 'Read the supplied public synthetic factory product file and cite it. No external action.', async: true, model: 'community-keyless/child', options: { context: 'fresh', timeoutMs: 15000 } });
  evidence.childLaunch = child;
  const id = child.details?.runId ?? child.details?.id;
  assert.ok(id, JSON.stringify(child));
  // In a headless official SDK host, pi-subagents drains children at agent_end.
  // Inspect its original persisted output and acceptance ledger after that drain.
  evidence.childStatus = JSON.parse(await fs.readFile(child.details.asyncDir + '/status.json', 'utf8'));
  evidence.childOutput = await fs.readFile(child.details.asyncDir + '/output-0.log', 'utf8');
  evidence.childSucceeded = evidence.childStatus.state === 'complete' && evidence.childOutput.includes('KEYLESS_CHILD_READ_VERIFIED');
  assert.equal(evidence.childSucceeded, true);
  assert.equal(evidence.childStatus.steps[0].acceptance.status, 'attested');
  let cancelId, cancelDir;
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('subagent', { agent: 'public-fixture', agentScope: 'user', task: 'CANCEL_FIXTURE', async: true, model: 'community-keyless/child', options: { context: 'fresh', timeoutMs: 15000 } }), { stopReason: 'toolUse' }),
    async context => {
      const result = context.messages.at(-1); cancelId = result.details?.runId; cancelDir = result.details?.asyncDir;
      assert.ok(cancelId, JSON.stringify(result));
      for (let i = 0; i < 80; i++) {
        const marker = await fs.readFile(process.env.PI_COMMUNITY_CHILD_MARKER, 'utf8').catch(() => '');
        if (marker.includes('waiting')) return fauxAssistantMessage(fauxToolCall('subagent', { action: 'stop', id: cancelId }), { stopReason: 'toolUse' });
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Actual child never entered the synthetic cancellable tool');
    },
    fauxAssistantMessage('Explicit child cancellation checked.'),
  ]);
  await session.prompt('Run and cancel the explicitly authorized synthetic child fixture.');
  const marker = await fs.readFile(process.env.PI_COMMUNITY_CHILD_MARKER, 'utf8'); assert.match(marker, /waiting/);
  await new Promise(resolve => setTimeout(resolve, 250));
  evidence.cancelStatus = await call('subagent', { action: 'status', id: cancelId });
  evidence.cancelPersisted = JSON.parse(await fs.readFile(cancelDir + '/status.json', 'utf8'));
  assert.equal(evidence.cancelPersisted.state, 'stopped');
  assert.equal(evidence.cancelPersisted.processTerminal.state, 'observed');
  evidence.childMarkers = marker.trim().split('\n').map(JSON.parse);
  assert.ok(evidence.childMarkers.every(row => row.pid !== process.pid));
  evidence.parentPid = process.pid;
  evidence.childProcessesGone = evidence.childMarkers.every(row => { try { process.kill(row.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
  assert.equal(evidence.childProcessesGone, true);
  if (config.factoryPackage) await call('workspace_factory_capabilities', {});
  evidence.modelCalls = faux.state.callCount; evidence.complete = true;
  await fs.writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ complete: true, tools: evidence.activeTools, childMarkers: evidence.childMarkers }));
  }
} finally { session.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
// The published extension retains service timers in an embedded SDK host.
// Exit only after original stop/process-terminal evidence and child death checks.
process.exit(0);
