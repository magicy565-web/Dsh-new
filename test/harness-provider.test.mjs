import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateNativeBridgeOverlay } from '../scripts/generate-native-bridge.mjs';
import { createHarnessProvider } from '../server/harness-provider.mjs';
import { createNativeBridgeController, loadNativeBridgeDependencies } from '../server/native-bridge.mjs';

async function fixture(t, HarnessClass, overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'workspace-sdk-fixture-'));
  const bin = path.join(dir, 'bin.mjs');
  await writeFile(bin, '// Explicit SDK test fixture, never a model or real Harness runtime.\n');
  await writeFile(path.join(dir, 'profile.yml'), '# Explicit reviewed-profile test fixture only\n');
  const options = { apiKey: 'fixture-not-a-real-key', dshBin: bin, profilePatch: path.join(dir, 'profile.yml'),
    dshHome: dir, workspaceDirectory: dir, ...(HarnessClass ? { HarnessClass } : {}), ...overrides };
  const provider = createHarnessProvider(options);
  t.after(async () => { await provider.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  return { provider, options, dir, bin };
}
const messages = [{ role: 'user', content: 'Fixture request' }];

class SuccessfulFixture {
  async run(input, { sessionId }) { return { sessionId, finalResponse: `Fixture: ${input}` }; }
  async close() {}
}

test('fixture: missing explicit native configuration never constructs a runtime', async () => {
  let constructed = false;
  const provider = createHarnessProvider({ HarnessClass: class { constructor() { constructed = true; } } });
  assert.equal(provider.configured, false);
  await assert.rejects(provider.complete({ messages }), { code: 'SETUP_REQUIRED' });
  assert.equal(constructed, false);
});

test('fixture: live sessions reuse official run options without replaying old conversation', async t => {
  const calls = []; let constructions = 0; let closed = 0; let options;
  const { provider } = await fixture(t, class {
    constructor(value) { options = value; constructions++; }
    async run(input, value) { calls.push({ input, ...value }); return { sessionId: value.sessionId, finalResponse: 'Fixture response' }; }
    async close() { closed++; }
  });
  const first = await provider.complete({ messages });
  const second = await provider.complete({ nativeSessionId: first.nativeSessionId, messages: [
    { role: 'system', content: 'Updated fixture context' }, ...messages,
    { role: 'assistant', content: 'Earlier fixture response' }, { role: 'user', content: 'New fixture input' },
  ] });
  assert.equal(options.profile, 'sdk'); assert.equal(options.provider, 'deepseek-official');
  assert.equal(first.nativeSessionId, second.nativeSessionId); assert.equal(second.nativeSessionContinued, true);
  assert.equal(constructions, 1); assert.equal(closed, 0);
  assert.match(calls[1].input, /Updated fixture context/); assert.match(calls[1].input, /New fixture input/);
  assert.doesNotMatch(calls[1].input, /Earlier fixture response|Fixture request/);
  await provider.close(); assert.equal(closed, 1);
  await assert.rejects(provider.complete({ messages }), { code: 'RUNTIME_CLOSED' });
});

test('fixture: observer exceptions, payload secrets, unrelated sessions and late events are contained', async t => {
  let notify; let id; const observed = [];
  const { provider } = await fixture(t, class {
    async run(_input, { sessionId, onNotification }) {
      notify = onNotification; id = sessionId;
      for (const [target, type] of [[sessionId, 'tool/result'], ['other-session', 'forbidden/event']]) {
        notify({ method: 'session.event', params: { sessionId: target, event: { type, data: { apiKey: 'SECRET' } } } });
      }
      notify({ method: 'subagent.started', params: { parentSessionId: id, childSessionId: 'fixture-child' } });
      notify({ method: 'session.event', params: { sessionId: 'fixture-child', event: { type: 'tool/child' } } });
      return { sessionId, finalResponse: 'Fixture response' };
    }
    async close() {}
  });
  const result = await provider.complete({ messages, onEvent(event) { observed.push(event); throw new Error('observer fixture'); } });
  assert.deepEqual(observed.map(event => event.type), ['native.session', 'tool/result', 'subagent.started', 'tool/child']);
  assert.doesNotMatch(JSON.stringify(result.nativeEvents), /SECRET|forbidden/);
  notify({ method: 'session.event', params: { sessionId: id, event: { type: 'late/result' } } });
  assert.equal(observed.length, 4);
});

test('fixture: rejecting or permanently pending async observers do not stall completion', async t => {
  const { provider } = await fixture(t, SuccessfulFixture);
  await provider.complete({ messages, onEvent: () => Promise.reject(new Error('observer fixture')) });
  await provider.complete({ messages, onEvent: () => new Promise(() => {}) });
});

test('fixture: cancellation closes owned runtime, rejects stale output, and cannot target next run', async t => {
  let finish; let closed = 0; let runs = 0;
  const { provider } = await fixture(t, class {
    async run(_input, { sessionId }) {
      if (++runs > 1) return { sessionId, finalResponse: 'New fixture result' };
      return new Promise(resolve => { finish = () => resolve({ sessionId, finalResponse: 'Stale fixture result' }); });
    }
    async close() { closed++; finish?.(); }
  });
  const controller = new AbortController();
  const running = provider.complete({ messages, signal: controller.signal });
  controller.abort();
  await assert.rejects(running, { code: 'CANCELLED' });
  assert.equal(closed, 1);
  const next = await provider.complete({ messages }); assert.equal(next.content, 'New fixture result');
  assert.equal(closed, 1);
});

test('fixture: concurrency and shutdown-failure fence prevent competing processes', async t => {
  let rejectRun; let closed = 0;
  const { provider } = await fixture(t, class {
    run() { return new Promise((_r, reject) => { rejectRun = reject; }); }
    async close() { closed++; throw new Error('SECRET'); }
  });
  const running = provider.complete({ messages });
  await assert.rejects(provider.complete({ messages }), { code: 'RUNTIME_BUSY' });
  rejectRun(new Error('SECRET upstream'));
  await assert.rejects(running, error => error.code === 'HARNESS_SHUTDOWN' && !error.message.includes('SECRET'));
  await assert.rejects(provider.complete({ messages }), { code: 'RUNTIME_BUSY' }); assert.equal(closed, 1);
});

test('fixture: malformed mapping, setup exceptions and unapproved interactions fail closed', async t => {
  let count = 0;
  const { provider } = await fixture(t, class { constructor() { count++; throw new Error('SECRET'); } });
  for (let index = 0; index < 2; index++) await assert.rejects(provider.complete({ messages }), { code: 'HARNESS_SETUP' });
  assert.equal(count, 2);
  const valid = (await fixture(t, SuccessfulFixture)).provider;
  await assert.rejects(valid.complete({ messages, onApproval() {} }), { code: 'NATIVE_APPROVAL_UNSUPPORTED' });
  await assert.rejects(valid.complete({ messages, nativeSessionId: '../../secret' }), { code: 'INVALID_NATIVE_SESSION' });
  await assert.rejects(valid.complete({ messages: [{ role: 'tool', content: 'bypass' }] }), { code: 'INVALID_INPUT' });
  const mismatch = (await fixture(t, class { async run() { return { sessionId: 'wrong', finalResponse: 'fixture' }; } async close() {} })).provider;
  await assert.rejects(mismatch.complete({ messages }), { code: 'NATIVE_SESSION_MISMATCH' });
});

test('fixture: stock SDK refuses post-restart resume without constructing a replacement session', async t => {
  const { provider, options } = await fixture(t, SuccessfulFixture);
  const first = await provider.complete({ messages }); await provider.close();
  let constructed = 0;
  const restarted = createHarnessProvider({ ...options, HarnessClass: class { constructor() { constructed++; } } });
  await assert.rejects(restarted.complete({ messages, nativeSessionId: first.nativeSessionId }), { code: 'NATIVE_RESUME_UNSUPPORTED' });
  assert.equal(constructed, 0);
});

test('fixture: bridge explicitly opens/resumes exact native session and retains same persistence configuration', async t => {
  const opens = []; let options;
  class BridgeFixture extends SuccessfulFixture {
    constructor(value) { super(); options = value; this.client = { request: async (method, params) => {
      opens.push({ method, params }); return { version: 1, sessionId: params.sessionId, resumed: params.mode === 'resume' };
    } }; }
    async start() {}
  }
  const { provider, options: config } = await fixture(t, BridgeFixture, { nativeBridge: true });
  const first = await provider.complete({ messages }); await provider.close();
  const restarted = createHarnessProvider(config); t.after(() => restarted.close());
  const resumed = await restarted.complete({ messages, nativeSessionId: first.nativeSessionId });
  assert.equal(resumed.nativeSessionId, first.nativeSessionId);
  assert.equal(options.dshHome, config.dshHome);
  assert.deepEqual(opens.map(call => call.params.mode), ['create', 'resume']);
  assert.ok(opens.every(call => call.method === 'workspace/session/open'));
});

test('fixture: close during native opening drains the same process and rejects prompt', async t => {
  let releaseStart; let runs = 0; let closes = 0;
  const { provider } = await fixture(t, class extends SuccessfulFixture {
    start() { return new Promise(resolve => { releaseStart = resolve; }); }
    async run(...args) { runs++; return super.run(...args); }
    async close() { closes++; releaseStart?.(); }
  }, { nativeBridge: true });
  const running = provider.complete({ messages }); await provider.close();
  await assert.rejects(running, { code: 'CANCELLED' }); assert.equal(runs, 0); assert.equal(closes, 1);
});

function bridgeFixture() {
  const owned = new Map(); const stored = new Map(); const calls = []; let disposed = 0;
  const ctx = {
    get() { return undefined; },
    sessionPersistence: { async stat(id) { return stored.get(id); } },
    agents: {
      get(id) { return owned.get(id)?.agent; },
      async create(options) {
        calls.push({ create: options });
        if (stored.has(options.sessionId)) throw new Error('fixture already exists');
        stored.set(options.sessionId, { header: { id: options.sessionId, cwd: options.meta.cwd } });
        return handle(options.sessionId);
      },
      async resume(options) { calls.push({ resume: options }); return handle(options.resumeSessionId); },
    },
  };
  function handle(id) {
    const value = { agent: { followup(message) { calls.push({ followup: message }); } }, async dispose() { owned.delete(id); disposed++; } };
    owned.set(id, value); return value;
  }
  const dependencies = { HarnessSdkJsonRpcServer: class {
    async initialize() { return { serverInfo: { name: 'fixture-native-runtime' } }; }
    async shutdown() {}
  }, createUserMessage: value => ({ ...value, id: 'fixture-message' }) };
  return { ctx, stored, calls, dependencies, disposed: () => disposed,
    controller: () => createNativeBridgeController(ctx, { notify() {} }, dependencies) };
}
const nativeId = 'workspace-session-' + 'a'.repeat(32);
const init = { cwd: '/fixture-workspace', provider: 'fixture', model: 'fixture', maxTokens: 100 };

test('fixture: bridge uses public native resume, preserves native ownership, and denies missing/out-of-scope history', async () => {
  const fixture = bridgeFixture(); let bridge = fixture.controller();
  await bridge.request('initialize', init);
  await bridge.request('workspace/session/open', { version: 1, sessionId: nativeId, mode: 'create' });
  await bridge.request('session/prompt', { sessionId: nativeId, contentBlocks: [{ type: 'text', text: 'Fixture' }] });
  await bridge.close(); assert.equal(fixture.disposed(), 1);
  bridge = fixture.controller(); await bridge.request('initialize', init);
  await bridge.request('workspace/session/open', { version: 1, sessionId: nativeId, mode: 'resume' });
  assert.equal(fixture.calls.filter(call => call.resume).length, 1);
  await bridge.close();
  bridge = fixture.controller(); await bridge.request('initialize', { ...init, cwd: '/other' });
  await assert.rejects(bridge.request('workspace/session/open', { version: 1, sessionId: nativeId, mode: 'resume' }), /outside workspace/);
  await assert.rejects(bridge.request('workspace/session/open', { version: 1, sessionId: 'workspace-session-' + 'b'.repeat(32), mode: 'resume' }), /missing/);
  await bridge.close();
});

test('fixture: bridge never maps approvals, arbitrary RPC, attachments or unowned sessions to native actions', async () => {
  const fixture = bridgeFixture(); const bridge = fixture.controller();
  await assert.rejects(bridge.request('session/prompt', {}), /initialize first/);
  await bridge.request('initialize', init);
  for (const method of ['approval/respond', 'goal/set', 'worker/submit', 'exec']) await assert.rejects(bridge.request(method, {}), /unsupported method/);
  await assert.rejects(bridge.request('session/prompt', { sessionId: nativeId, contentBlocks: [{ type: 'text', text: 'no permission' }] }), /not open/);
  await assert.rejects(bridge.request('workspace/session/open', { version: 1, sessionId: nativeId, mode: 'create', permissions: 'all' }), /invalid request/);
  await bridge.request('workspace/session/open', { version: 1, sessionId: nativeId, mode: 'create' });
  await assert.rejects(bridge.request('session/prompt', { sessionId: nativeId, contentBlocks: [{ type: 'image', data: 'private' }] }), /invalid request/);
  await bridge.close(); assert.equal(fixture.calls.filter(call => call.followup).length, 0);
});

test('fixture: native module loading rejects other packages before importing their code', async t => {
  const { dir } = await fixture(t, SuccessfulFixture); const manifest = path.join(dir, 'package.json');
  await writeFile(manifest, JSON.stringify({ name: 'unreviewed-runtime', version: '0.2.0-rc.2' }));
  await assert.rejects(loadNativeBridgeDependencies(manifest), /reviewed Harness/);
});

test('official SDK transport with explicit process fixture retains a named session across turns', async t => {
  const { options, bin } = await fixture(t);
  await writeFile(bin, `// Explicit JSON-RPC process fixture; no model, native tools, or external service.\n
import { createInterface } from 'node:readline';
const counts = new Map();
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line), params = frame.params || {};
  if (frame.method === 'initialize') return send({ jsonrpc: '2.0', id: frame.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: 'fixture' } } });
  if (frame.method === 'shutdown') { send({ jsonrpc: '2.0', id: frame.id, result: {} }); setTimeout(() => process.exit(0), 5); return; }
  const count = (counts.get(params.sessionId) || 0) + 1; counts.set(params.sessionId, count);
  const messageId = 'fixture-message-' + count;
  send({ jsonrpc: '2.0', id: frame.id, result: { messageId } });
  const event = (type, data) => send({ jsonrpc: '2.0', method: 'session.event', params: { sessionId: params.sessionId, event: { type, data } } });
  event('agent/inbox/spliced', { inserted: [{ id: messageId }] });
  event('assistant/message', { message: { content: [{ type: 'text', text: 'Fixture turn ' + count }] } });
  send({ jsonrpc: '2.0', method: 'session.status', params: { sessionId: params.sessionId, status: 'idle' } });
});`);
  const provider = createHarnessProvider(options); t.after(() => provider.close());
  const first = await provider.complete({ messages });
  const second = await provider.complete({ messages, nativeSessionId: first.nativeSessionId });
  assert.equal(first.content, 'Fixture turn 1'); assert.equal(second.content, 'Fixture turn 2');
  await provider.close();
});


test('fixture: launch-policy fingerprint fences modified profiles and never exposes active credentials', async t => {
  const { provider, options } = await fixture(t, SuccessfulFixture);
  assert.match(provider.permissionFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(provider.containsCredential('The value is fixture-not-a-real-key'), true);
  assert.equal(provider.containsCredential('ordinary fixture text'), false);
  await provider.complete({ messages });
  await writeFile(options.profilePatch, '# Changed permission fixture\n');
  await assert.rejects(provider.complete({ messages }), { code: 'NATIVE_POLICY_CHANGED' });
  const changed = createHarnessProvider(options); t.after(() => changed.close());
  assert.notEqual(changed.permissionFingerprint, provider.permissionFingerprint);
  assert.doesNotMatch(provider.permissionFingerprint, /fixture-not-a-real-key/);
});

const sourceRoot = process.env.DSH_TEST_SOURCE_ROOT || fileURLToPath(new URL('../../muse-development/deepseek-harness-enterprise/', import.meta.url));
const sourceLoader = path.join(sourceRoot, 'node_modules/tsx/dist/esm/index.mjs');
// Packaged native releases retain the source-resolution facade, not a root project.
const sourceTsconfig = path.join(sourceRoot, existsSync(path.join(sourceRoot, 'tsconfig.base.json')) ? 'tsconfig.base.json' : 'tsconfig.json');
test('real source with scripted model fixture: native AgentLoop and JSONL preserve session across restart',
  { skip: !existsSync(sourceLoader), timeout: 30_000 }, async t => {
    const dir = await mkdtemp(path.join(tmpdir(), 'workspace-source-fixture-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const script = path.join(dir, 'native-lifecycle-fixture.mjs');
    await writeFile(script, String.raw`import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const source = process.argv[2];
const { Context } = await import(pathToFileURL(path.join(source, 'vendor/cordis/src/index.ts')).href);
const { HarnessSdkJsonRpcServer } = await import(pathToFileURL(path.join(source, 'packages/sdk/server/src/index.ts')).href);
const { mountAgentLoopTestDependencies } = await import(pathToFileURL(path.join(source, 'packages/test-support/agent-loop-testkit/src/index.ts')).href);
const { default: AgentLoop } = await import(pathToFileURL(path.join(source, 'packages/core/agent-loop/src/index.ts')).href);
const { default: Jsonl } = await import(pathToFileURL(path.join(source, 'packages/session/session-persistence-jsonl/src/index.ts')).href);
const { LlmAdapter, createUserMessage } = await import(pathToFileURL(path.join(source, 'packages/llm/llm/src/index.ts')).href);
const { createNativeBridgeController } = await import(pathToFileURL(process.argv[3]).href);
const root = await mkdtemp(path.join(tmpdir(), 'native-real-fixture-'));
class Script extends LlmAdapter {
  requests=[];
  async resolveModel(provider, model) { return { provider,id:model,name:model }; }
  async *stream(request) { this.requests.push(request); yield* [
    {type:'block-start',index:0,blockType:'text'}, {type:'block-end',index:0,block:{type:'text',text:'Explicit scripted fixture result'}},
    {type:'usage',usage:{inputTokens:1,outputTokens:1,totalTokens:2}}, {type:'finish',reason:{kind:'stop'}},
  ]; }
}
async function compose() {
 const ctx=new Context(); await mountAgentLoopTestDependencies(ctx); await ctx.plugin(AgentLoop,{agents:[]}); await ctx.plugin(Jsonl,{root:path.join(root,'sessions'),compression:'none'});
 const script=new Script(); ctx.llm.registerAdapter(['fixture'],script); const notifications=[];
 const bridge=createNativeBridgeController(ctx,{notify(method,params){notifications.push({method,params})}},{HarnessSdkJsonRpcServer,createUserMessage});
 await bridge.request('initialize',{cwd:root,provider:'fixture',model:'fixture',maxTokens:100});
 return {ctx,script,bridge,notifications};
}
const id='workspace-session-'+'c'.repeat(32);
let f;
try {
 f=await compose(); await f.bridge.request('workspace/session/open',{version:1,sessionId:id,mode:'create'});
 assert.equal(f.script.requests.length,0);
 await f.bridge.request('session/prompt',{sessionId:id,contentBlocks:[{type:'text',text:'Original fixture request'}]});
 await f.ctx.agents.get(id).whenIdle();
 const count=f.ctx.agents.get(id).session.ownEvents().length;
 assert.equal(f.script.requests.length,1); assert.ok(count>0);
 await f.bridge.close(); await f.ctx.fiber.dispose();
 f=await compose(); await f.bridge.request('workspace/session/open',{version:1,sessionId:id,mode:'resume'});
 assert.equal(f.script.requests.length,0); assert.ok(f.ctx.agents.get(id).session.ownEvents().length>=count);
 await f.bridge.request('session/prompt',{sessionId:id,contentBlocks:[{type:'text',text:'Next fixture request'}]});
 await f.ctx.agents.get(id).whenIdle();
 assert.equal(f.script.requests.length,1); assert.match(JSON.stringify(f.script.requests[0]),/Original fixture request/);
 assert.ok(f.notifications.some(n=>n.method==='session.event')); console.log('Real native AgentLoop + JSONL restart fixture passed; no live model or network.');
} finally { await f?.bridge.close(); await f?.ctx.fiber.dispose(); await rm(root,{recursive:true,force:true}); }`);
    const { stdout } = await promisify(execFile)(process.execPath,
      ['--import', sourceLoader, script, sourceRoot, fileURLToPath(new URL('../server/native-bridge.mjs', import.meta.url))],
      { env: { PATH: process.env.PATH, HOME: dir, TSX_TSCONFIG_PATH: sourceTsconfig }, timeout: 25_000 });
    assert.match(stdout, /Real native AgentLoop \+ JSONL restart fixture passed/);
  });


test('fixture: bridge shutdown joins pending initialization before disposing native server', async () => {
  const fixture = bridgeFixture(); let resolveInitialize; let serverClosed = 0;
  const bridge = createNativeBridgeController(fixture.ctx, { notify() {} }, {
    ...fixture.dependencies, HarnessSdkJsonRpcServer: class {
      initialize() { return new Promise(resolve => { resolveInitialize = resolve; }); }
      async shutdown() { serverClosed++; }
    },
  });
  const initializing = bridge.request('initialize', init);
  await new Promise(resolve => setImmediate(resolve));
  const closing = bridge.close(); assert.equal(serverClosed, 0);
  resolveInitialize({ serverInfo: { name: 'fixture' } });
  await assert.rejects(initializing, /closed/); await closing; assert.equal(serverClosed, 1);
});

test('fixture: bridge shutdown aborts and drains delayed native resume without leaking an owned handle', async () => {
  const fixture = bridgeFixture(); let resolveResume; let disposed = 0;
  fixture.stored.set(nativeId, { header: { id: nativeId, cwd: init.cwd } });
  fixture.ctx.agents.resume = () => new Promise(resolve => { resolveResume = resolve; });
  const bridge = fixture.controller(); await bridge.request('initialize', init);
  const opening = bridge.request('workspace/session/open', { version: 1, sessionId: nativeId, mode: 'resume' });
  await new Promise(resolve => setImmediate(resolve));
  const closing = bridge.close();
  resolveResume({ agent: {}, async dispose() { disposed++; } });
  await assert.rejects(opening, /closed/); await closing; assert.equal(disposed, 1);
});


test('fixture: overlay generator checks reviewed public exports and writes only a new private review file', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'workspace-overlay-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-sdk-jsonrpc-server', version: '0.2.0-rc.2', type: 'module', exports: './index.mjs' }));
  await writeFile(path.join(root, 'index.mjs'), 'export class HarnessSdkJsonRpcServer {} // Explicit package fixture\n');
  for (const [name, source] of [
    ['dsh-sdk-protocol', 'export class JsonRpcLineTransport {}'],
    ['dsh-llm', 'export function createUserMessage() {}'],
  ]) {
    const dir = path.join(root, 'node_modules/@deepseek-ai', name); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/' + name, version: '0.2.0-rc.2', type: 'module', exports: './index.mjs' }));
    await writeFile(path.join(dir, 'index.mjs'), source + ' // Explicit package fixture\n');
  }
  const outputPath = path.join(root, 'review.patch.yml'); const sdkPackagePath = path.join(root, 'package.json');
  await generateNativeBridgeOverlay({ sdkPackagePath, outputPath });
  const content = await readFile(outputPath, 'utf8');
  assert.match(content, /id: sdk-jsonrpc-server\n  disabled: true/);
  assert.match(content, /workspace-native-bridge/);
  assert.doesNotMatch(content, /danger-full-access|apiKey|token/);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  await assert.rejects(generateNativeBridgeOverlay({ sdkPackagePath, outputPath }), { code: 'EEXIST' });
  assert.equal(await readFile(outputPath, 'utf8'), content);
});
