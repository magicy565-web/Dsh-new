// Keyless integration fixture. Real native packages; intercepted provider wire.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [source, workspace] = process.argv.slice(2);
const fixtureKey = 'fixture-native-relay-never-a-real-secret';
const requests = [];
const textEvents = [
  { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
  { choices: [{ delta: { content: 'Explicit native relay fixture complete' }, index: 0, finish_reason: null }] },
  { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } },
];
const toolEvents = [
  { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: { name: 'fixture_echo', arguments: '{"text":' } }] }, index: 0, finish_reason: null }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"fixture ping"}' } }] }, index: 0, finish_reason: null }] },
  { choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2 } },
];
// Never forward to the native fetch implementation or open a real socket.
globalThis.fetch = async (input, options = {}) => {
  const request = new Request(input, options);
  assert.equal(request.url, 'https://www.fastaitoken.com/v1/chat/completions');
  assert.equal(request.headers.get('authorization'), 'Bearer ' + fixtureKey);
  const body = await request.json();
  assert.equal(body.model, 'gpt-6-sol'); assert.equal(body.stream, true);
  assert.ok(!JSON.stringify(body).includes(fixtureKey));
  requests.push(body);
  const events = requests.length === 1 ? toolEvents : textEvents;
  return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
};
const load = relative => import(pathToFileURL(path.join(source, relative)).href);
const { Context } = await load('vendor/cordis/src/index.ts');
const { HarnessSdkJsonRpcServer } = await load('packages/sdk/server/src/index.ts');
const { mountAgentLoopTestDependencies } = await load('packages/test-support/agent-loop-testkit/src/index.ts');
const { default: AgentLoop } = await load('packages/core/agent-loop/src/index.ts');
const { default: Jsonl } = await load('packages/session/session-persistence-jsonl/src/index.ts');
const { createUserMessage } = await load('packages/llm/llm/src/index.ts');
const { defineContentToolFixture } = await load('packages/core/tools/src/index.ts');
const PiAi = await load('packages/llm/llm-pi-ai/src/index.ts');
const { createNativeBridgeController } = await import(pathToFileURL(path.join(workspace, 'server/native-bridge.mjs')).href);
const { createNativeRelayOverlay } = await import(pathToFileURL(path.join(workspace, 'server/harness-provider.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'native-relay-source-'));
const nativeId = 'workspace-session-' + 'd'.repeat(32);
let executed = 0;
let active;
async function compose(protocol = 'openai-completions', baseURL = 'https://www.fastaitoken.com/v1') {
  const ctx = new Context();
  await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(Jsonl, { root: path.join(root, 'sessions'), compression: 'none' });
  const rows = createNativeRelayOverlay({ nativeProvider: 'workspace-fastaitoken', nativeProtocol: protocol,
    nativeBaseURL: baseURL, nativeApiKeyEnv: 'FASTAITOKEN_API_KEY', nativeModel: 'gpt-6-sol',
    contextWindow: 16384, maxTokens: 4096 });
  await ctx.plugin(PiAi, rows[0].config);
  ctx.tools.register(defineContentToolFixture({ name: 'fixture_echo', description: 'Synthetic fixture echo only',
    parameters: { text: { type: 'string' } },
    async execute(args) { executed++; return [{ type: 'text', text: 'fixture echo: ' + args.text }]; },
  }));
  const notifications = [];
  const bridge = createNativeBridgeController(ctx, { notify(method, params) { notifications.push({ method, params }); } },
    { HarnessSdkJsonRpcServer, createUserMessage });
  await bridge.request('initialize', { cwd: root, provider: 'workspace-fastaitoken', model: 'gpt-6-sol', maxTokens: 4096 });
  assert.ok(ctx.llm.listProviders().some(value => value.id === 'workspace-fastaitoken'));
  assert.ok(!ctx.llm.listProviders().some(value => value.id === 'deepseek-official'));
  return { ctx, bridge, notifications };
}
async function dispose() { await active?.bridge.close(); await active?.ctx.fiber.dispose(); active = undefined; }
async function contents(dir) {
  let text = '';
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    text += entry.isDirectory() ? await contents(file) : await readFile(file, 'utf8');
  }
  return text;
}
try {
  active = await compose();
  const rejectingServer = new HarnessSdkJsonRpcServer(active.ctx, { notify() {} });
  await assert.rejects(rejectingServer.initialize({ cwd: root, provider: 'unregistered-fixture', model: 'gpt-6-sol', maxTokens: 4096 }), /no adapter registered/);
  await assert.rejects(rejectingServer.initialize({ cwd: root, provider: 'workspace-fastaitoken', model: 'unapproved-fixture-model', maxTokens: 4096 }));
  await rejectingServer.shutdown();
  assert.equal(requests.length, 0);
  await active.bridge.request('workspace/session/open', { version: 1, sessionId: nativeId, mode: 'create' });
  await active.bridge.request('session/prompt', { sessionId: nativeId, contentBlocks: [{ type: 'text', text: 'Original native relay fixture input' }] });
  await active.ctx.agents.get(nativeId).whenIdle();
  assert.equal(requests.length, 2); assert.equal(executed, 1);
  assert.ok(requests[0].tools.some(tool => tool.function.name === 'fixture_echo'));
  assert.match(JSON.stringify(requests[1]), /fixture echo: fixture ping/);
  assert.ok(active.notifications.some(value => value.method === 'session.event'));
  const events = active.ctx.agents.get(nativeId).session.ownEvents();
  assert.match(JSON.stringify(events), /workspace-fastaitoken/);
  assert.match(JSON.stringify(events), /gpt-6-sol/);
  assert.ok(!JSON.stringify(active.notifications).includes(fixtureKey));
  await dispose();
  active = await compose();
  await active.bridge.request('workspace/session/open', { version: 1, sessionId: nativeId, mode: 'resume' });
  assert.equal(requests.length, 2);
  await active.bridge.request('session/prompt', { sessionId: nativeId, contentBlocks: [{ type: 'text', text: 'Resumed native relay fixture input' }] });
  await active.ctx.agents.get(nativeId).whenIdle();
  assert.equal(requests.length, 3); assert.equal(executed, 1);
  assert.match(JSON.stringify(requests[2]), /Original native relay fixture input/);
  assert.match(JSON.stringify(requests[2]), /fixture echo: fixture ping/);
  assert.match(JSON.stringify(requests[2]), /Resumed native relay fixture input/);
  await dispose();
  assert.ok(!(await contents(root)).includes(fixtureKey));
  // Native profile/catalog acceptance only for the other documented protocols.
  // No fixture completion for these protocols and no claim of live availability.
  for (const [protocol, baseURL] of [['openai-responses', 'https://fastaitoken.com/v1'], ['anthropic-messages', 'https://fastaitoken.com/']]) {
    active = await compose(protocol, baseURL);
    assert.equal(requests.length, 3);
    await dispose();
  }
  console.log('Real native relay routing, streamed tool loop and JSONL resume fixture passed; no live relay traffic.');
} finally { await dispose(); await rm(root, { recursive: true, force: true }); }
