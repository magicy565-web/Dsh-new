// Calls the published OMP TaskTool and its original child AgentSession executor.
// The provider is an explicit bounded keyless fixture, never a production fallback.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.OMP_BUILTINS_SDK_ROOT;
const load = relative => import(pathToFileURL(path.join(root, relative)).href);
assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version, '18.10.4');
const { Settings } = await load('src/config/settings.ts');
const { AuthStorage, SqliteAuthCredentialStore } = await load('src/session/auth-storage.ts');
const { ModelRegistry } = await load('src/config/model-registry.ts');
const { TaskTool } = await load('src/task/index.ts');
const { EventBus } = await load('src/utils/event-bus.ts');
const { AssistantMessageEventStream } = await load('../pi-ai/src/utils/event-stream.ts');
const settings = await Settings.init({ inMemory: true, overrides: { 'task.batch': true,
  'task.enableLsp': false, 'async.enabled': false, 'eval.py': false, 'eval.autoProvision': false,
  'retry.enabled': false, 'retry.modelFallback': false, 'compaction.enabled': false,
  'compaction.midTurnEnabled': false, 'telemetry.otlpExportEnabled': false,
  'startup.checkUpdate': false, 'startup.setupWizard': false, 'title.refreshOnReplan': false } });
const auth = new AuthStorage(await SqliteAuthCredentialStore.open(path.join(process.cwd(), 'empty-auth.db')));
const registry = new ModelRegistry(auth, path.join(process.cwd(), 'absent-models.yml'), { settings,
  ignoreLocalModelConfig: true, fetch: async () => { throw new Error('Model catalog network forbidden'); } });
const provider = 'omp-builtin-task-explicit-faux', modelId = 'finite-public-reader';
let calls = 0, waiting = false, cancelled = false;
const evidence = { version: 1, ompVersion: '18.10.4', bunVersion: Bun.version, syntheticOnly: true,
  executor: 'published-OMP-TaskTool-and-original-child-AgentSession', paidModelCalls: 0,
  originalWorkspaceBusinessExecution: false, hostCredentialReads: 0, childPrivateLibrary: false };
registry.registerProvider(provider, { api: 'omp-builtin-task-explicit-faux', baseUrl: 'https://synthetic.invalid',
  apiKey: 'explicit-keyless-fixture-not-a-credential', models: [{ id: modelId, name: 'Explicit synthetic reader',
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 }],
  streamSimple(model, context, options) {
    const stream = new AssistantMessageEventStream();
    void (async () => {
      const requestNumber = ++calls;
      assert.ok(requestNumber <= 8, 'Finite test provider exhausted; no real fallback');
      const text = JSON.stringify(context.messages);
      if (text.includes('CANCEL_SYNTHETIC_CHILD')) {
        waiting = true;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 10000);
          const abort = () => { clearTimeout(timer); cancelled = true; reject(new Error('Explicit synthetic child aborted')); };
          if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      const previous = context.messages.at(-1), tag = text.includes('BETA') ? 'BETA' : 'ALPHA';
      const content = previous?.role === 'toolResult'
        ? [{ type: 'text', text: `SYNTHETIC_CHILD_${tag}_READ_CONFIRMED; capacity UNKNOWN; no customer or sale proof.` }]
        : [{ type: 'toolCall', id: `synthetic-task-read-${requestNumber}`, name: 'read', arguments: { path: path.join(process.cwd(), tag + '.md') } }];
      if (previous?.role === 'toolResult') assert.match(JSON.stringify(previous.content), /capacity UNKNOWN/);
      const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: previous?.role === 'toolResult' ? 'stop' : 'toolUse',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'start', partial: message });
      for (let index = 0; index < content.length; index++) stream.push(content[index].type === 'text'
        ? { type: 'text_end', contentIndex: index, content: content[index].text, partial: message }
        : { type: 'toolcall_end', contentIndex: index, toolCall: content[index], partial: message });
      stream.push({ type: 'done', reason: message.stopReason, message });
    })().catch(error => stream.fail(error));
    return stream;
  } });
const agent = { name: 'factory-public-reader', description: 'Read only explicitly supplied public synthetic products.',
  systemPrompt: 'Read the specified public synthetic file using read. Do not create files, contact anyone or infer capacity.',
  tools: ['read'], spawns: [], model: [`${provider}/${modelId}`], source: 'session', blocking: true };
const session = { cwd: process.cwd(), settings, authStorage: auth, modelRegistry: registry,
  skills: [], rules: [], contextFiles: [], promptTemplates: [], extensionPaths: [], preparedExtensions: [], customToolPaths: [],
  enableMCP: false, enableLsp: false, enableIrc: false, taskDepth: 0,
  eventBus: new EventBus(), subagentEventBus: new EventBus(),
  getSessionSpawns: () => 'factory-public-reader', getSessionAgents: () => [agent],
  getSessionFile: () => null, getSessionId: () => 'synthetic-public-task-root', getArtifactsDir: () => process.cwd(),
  getActiveModel: () => registry.find(provider, modelId), getActiveModelString: () => `${provider}/${modelId}`,
  getModelString: () => `${provider}/${modelId}` };
const activeChildren = new Set(), allChildren = new Set(); let maxActiveChildren = 0, finishedReads = 0;
const unsubscribe = session.subagentEventBus.on('task:subagent:event', ({ id, event }) => {
  allChildren.add(id);
  if (event.type === 'agent_start') { activeChildren.add(id); maxActiveChildren = Math.max(maxActiveChildren, activeChildren.size); }
  if (event.type === 'agent_end') activeChildren.delete(id);
  if (event.type === 'tool_execution_end' && event.toolName === 'read' && !event.isError) finishedReads++;
});
try {
  for (const tag of ['ALPHA', 'BETA']) await fs.writeFile(path.join(process.cwd(), tag + '.md'), `# Public synthetic ${tag} product\ncapacity UNKNOWN\n`);
  const task = await TaskTool.create(session);
  const output = await task.execute('synthetic-public-division', { context: 'Public synthetic product review only.',
    tasks: ['ALPHA', 'BETA'].map(tag => ({ name: tag, agent: agent.name,
      task: `Read ${tag}.md and report capacity UNKNOWN.`, solutionSpace: 'Use read on this file only.' })) });
  assert.ok(!output.isError, JSON.stringify(output));
  assert.match(JSON.stringify(output), /SYNTHETIC_CHILD_ALPHA_READ_CONFIRMED/);
  assert.match(JSON.stringify(output), /SYNTHETIC_CHILD_BETA_READ_CONFIRMED/);
  assert.equal(finishedReads, 2); assert.equal(allChildren.size, 2); assert.ok(maxActiveChildren >= 2);
  evidence.division = { status: 'synthetic-two-child-read-pass', modelCalls: calls,
    tool: 'task', childTools: ['read'], recursiveSpawns: false, actualChildCount: allChildren.size,
    observedMaxActiveChildren: maxActiveChildren, finishedReadReceipts: finishedReads };
  const aborter = new AbortController();
  const stopping = task.execute('synthetic-child-cancel', { context: 'Public synthetic cancellation check only.', tasks: [{
    name: 'cancel', agent: agent.name, task: 'CANCEL_SYNTHETIC_CHILD', solutionSpace: 'Synthetic wait only.' }] }, aborter.signal);
  const timer = setInterval(() => { if (waiting) aborter.abort(); }, 25);
  let stopped;
  try { stopped = await stopping; } finally { clearInterval(timer); }
  assert.equal(cancelled, true); assert.match(JSON.stringify(stopped), /abort|cancel/i);
  assert.equal(activeChildren.size, 0);
  evidence.cancellation = { status: 'synthetic-original-child-signal-abort-pass', providerObservedAbort: cancelled,
    returnedCancellation: true, activeChildrenAfterStop: activeChildren.size, osSubprocessClaim: false };
  evidence.modelCalls = calls;
  await fs.writeFile(process.env.OMP_BUILTINS_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  console.log('OMP_BUILTIN_TASK_CHILDREN_VERIFIED');
} finally { unsubscribe(); auth.close(); }
