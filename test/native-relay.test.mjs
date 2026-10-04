import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHarnessProvider, createNativeRelayOverlay } from '../server/harness-provider.mjs';
import { generateNativeRelayOverlay } from '../scripts/generate-native-bridge.mjs';

// The model is the user's explicit selection. Capacity and key here are synthetic,
// not catalog evidence, live account configuration or authorization to call it.
const route = { nativeProvider: 'workspace-fastaitoken', nativeModel: 'gpt-6-sol', nativeProfile: 'sdk',
  nativeProtocol: 'openai-completions', nativeBaseURL: 'https://www.fastaitoken.com/v1',
  nativeApiKeyEnv: 'FASTAITOKEN_API_KEY' };
const limits = { contextWindow: 16384, maxTokens: 4096 };
const fixtureKey = 'fixture-native-relay-never-a-real-secret';
const messages = [{ role: 'user', content: 'Explicit relay fixture input' }];
class ScriptedHarness {
  async run(_input, { sessionId }) { return { sessionId, finalResponse: 'Explicit relay fixture response' }; }
  async close() {}
}
async function fixture(t, overrides = {}, HarnessClass = ScriptedHarness) {
  const dir = await mkdtemp(path.join(tmpdir(), 'workspace-native-relay-'));
  const dshBin = path.join(dir, 'bin.mjs'), profilePatch = path.join(dir, 'profile.yml');
  const relayPatch = path.join(dir, 'relay.patch.yml');
  await writeFile(dshBin, '// Scripted SDK process fixture only\n');
  await writeFile(profilePatch, '# Synthetic reviewed permission profile\n');
  await generateNativeRelayOverlay({ ...route, ...limits, ...overrides, outputPath: relayPatch });
  const options = { ...route, ...overrides, apiKey: fixtureKey, dshBin, profilePatch, relayPatch,
    dshHome: dir, workspaceDirectory: dir, HarnessClass };
  const provider = createHarnessProvider(options);
  t.after(async () => { await provider.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  return { provider, options, dir };
}

test('native relay: constructor requires exact reviewed protocol, endpoint, model and allowlisted credential reference', async t => {
  const { options, provider } = await fixture(t);
  assert.equal(provider.provider, 'fastaitoken'); assert.deepEqual(provider.models, ['gpt-6-sol']);
  for (const change of [
    { nativeModel: '' }, { nativeModel: undefined }, { nativeProvider: 'deepseek-official' },
    { nativeProvider: 'openai' }, { nativeApiKeyEnv: 'NODE_OPTIONS' }, { nativeApiKeyEnv: 'DEEPSEEK_API_KEY' },
    { nativeBaseURL: 'https://www.fastaitoken.com.evil.example/v1' },
    { nativeBaseURL: 'https://www.fastaitoken.com/v1?token=fixture' },
    { nativeBaseURL: 'http://www.fastaitoken.com/v1' },
    { nativeBaseURL: 'https://fixture@www.fastaitoken.com/v1' },
    { nativeProtocol: 'openai-responses' }, { nativeProfile: '../../profile' },
  ]) assert.throws(() => createHarnessProvider({ ...options, ...change }), /Invalid reviewed native provider/);
  const missing = createHarnessProvider({ ...options, relayPatch: '' });
  assert.equal(missing.configured, false);
  await assert.rejects(missing.complete({ messages }), { code: 'SETUP_REQUIRED' });
});

test('native relay: generated patch is private, credential-free, single-route, no-clobber and rejects unreviewed extensions', async t => {
  const { dir, options } = await fixture(t);
  const patch = JSON.parse(await readFile(options.relayPatch, 'utf8'));
  assert.deepEqual(patch, createNativeRelayOverlay({ ...route, ...limits }));
  assert.deepEqual(Object.keys(patch[0].config.providers), ['workspace-fastaitoken']);
  assert.equal((await stat(options.relayPatch)).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(patch), /fixture-native-relay-never-a-real-secret|deepseek-official|danger-full-access|headers/);
  await assert.rejects(generateNativeRelayOverlay({ ...route, ...limits, outputPath: options.relayPatch }), { code: 'EEXIST' });
  for (const mutate of [
    value => { value[0].config.providers['workspace-fastaitoken'].headers = { Authorization: 'fixture' }; },
    value => { value[0].config.providers['workspace-fastaitoken'].models[0].id = 'unapproved-model'; },
    value => { value.push({ id: 'safety-policy', disabled: true }); },
  ]) {
    const changed = structuredClone(patch); mutate(changed);
    const relayPatch = path.join(dir, 'changed.yml'); await writeFile(relayPatch, JSON.stringify(changed));
    assert.throws(() => createHarnessProvider({ ...options, relayPatch }), /Invalid reviewed native provider/);
  }
});

test('native relay: provider/model/profile/config bytes affect execution scope; keys never enter fingerprints', async t => {
  const { provider, options } = await fixture(t);
  const rotated = createHarnessProvider({ ...options, apiKey: 'fixture-rotated-key' }); t.after(() => rotated.close());
  assert.equal(provider.permissionFingerprint, rotated.permissionFingerprint);
  const profile = createHarnessProvider({ ...options, nativeProfile: 'reviewed-sdk' }); t.after(() => profile.close());
  assert.notEqual(profile.permissionFingerprint, provider.permissionFingerprint);
  const before = provider.permissionFingerprint;
  await writeFile(options.relayPatch, (await readFile(options.relayPatch, 'utf8')) + '\n');
  await assert.rejects(provider.complete({ messages }), { code: 'NATIVE_POLICY_CHANGED' });
  const changed = createHarnessProvider(options); t.after(() => changed.close());
  assert.notEqual(before, changed.permissionFingerprint);
  assert.doesNotMatch(JSON.stringify(provider), /fixture-native-relay-never-a-real-secret/);
});

test('native relay: SDK receives selected route, only selected credential, and separate reviewed patches', async t => {
  let launch;
  const { provider, options } = await fixture(t, {}, class extends ScriptedHarness { constructor(value) { super(); launch = value; } });
  await provider.complete({ messages });
  assert.equal(launch.provider, route.nativeProvider); assert.equal(launch.model, 'gpt-6-sol'); assert.equal(launch.profile, 'sdk');
  assert.deepEqual(launch.patches, [options.profilePatch, options.relayPatch]);
  assert.equal(launch.env.FASTAITOKEN_API_KEY, fixtureKey);
  assert.equal(Object.hasOwn(launch.env, 'DEEPSEEK_API_KEY'), false);
  assert.equal(Object.hasOwn(launch.env, 'NODE_OPTIONS'), false);
  assert.deepEqual(Object.keys(launch.env).sort(), ['DSH_HOME', 'FASTAITOKEN_API_KEY', 'HOME', 'LANG', 'PATH']);
  await assert.rejects(provider.complete({ messages, maxTokens: 4097 }), { code: 'INVALID_INPUT' });
});

test('native relay: credentials in native results and event discriminants never leave the adapter', async t => {
  const seen = [];
  const { provider } = await fixture(t, {}, class extends ScriptedHarness {
    async run(_input, { sessionId, onNotification }) {
      onNotification({ method: 'session.event', params: { sessionId, event: { type: fixtureKey } } });
      return { sessionId, finalResponse: 'Fixture leaked ' + fixtureKey };
    }
  });
  await assert.rejects(provider.complete({ messages, onEvent: event => seen.push(event) }), error => {
    assert.equal(error.code, 'CREDENTIAL_IN_RESPONSE'); assert.ok(!error.message.includes(fixtureKey)); return true;
  });
  assert.ok(!JSON.stringify(seen).includes(fixtureKey));
});

test('native relay: official SDK sends selected provider/model in actual JSON-RPC initialize', async t => {
  const { options } = await fixture(t);
  await writeFile(options.dshBin, `import { createInterface } from 'node:readline';
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
let initialized=false;
createInterface({input:process.stdin}).on('line',line=>{
 const frame=JSON.parse(line),p=frame.params||{};
 if(frame.method==='initialize') {
  initialized=p.provider==='workspace-fastaitoken'&&p.model==='gpt-6-sol'&&process.env.FASTAITOKEN_API_KEY==='${fixtureKey}'&&!process.env.DEEPSEEK_API_KEY&&!process.env.NODE_OPTIONS;
  return send({jsonrpc:'2.0',id:frame.id,...(initialized?{result:{serverInfo:{name:'deepseek-harness-sdk-runtime',version:'fixture'}}}:{error:{code:-32602,message:'Unexpected fixture route'}})});
 }
 if(frame.method==='shutdown'){send({jsonrpc:'2.0',id:frame.id,result:{}});setTimeout(()=>process.exit(0),5);return;}
 if(!initialized) return;
 const messageId='fixture-message';
 send({jsonrpc:'2.0',id:frame.id,result:{messageId}});
 const event=(type,data)=>send({jsonrpc:'2.0',method:'session.event',params:{sessionId:p.sessionId,event:{type,data}}});
 event('agent/inbox/spliced',{inserted:[{id:messageId}]});
 event('assistant/message',{message:{content:[{type:'text',text:'Explicit native relay SDK fixture'}]}});
 send({jsonrpc:'2.0',method:'session.status',params:{sessionId:p.sessionId,status:'idle'}});
});`);
  const { HarnessClass, ...actual } = options;
  const provider = createHarnessProvider(actual); t.after(() => provider.close());
  assert.equal((await provider.complete({ messages })).content, 'Explicit native relay SDK fixture');
});

const sourceRoot = process.env.DSH_TEST_SOURCE_ROOT || fileURLToPath(new URL('../../muse-development/deepseek-harness-enterprise/', import.meta.url));
const sourceLoader = path.join(sourceRoot, 'node_modules/tsx/dist/esm/index.mjs');
test('native relay: real native SDK server, llm-pi-ai stream/tool loop and JSONL resume use the selected route',
  { skip: !existsSync(sourceLoader), timeout: 30_000 }, async t => {
    const home = await mkdtemp(path.join(tmpdir(), 'workspace-relay-source-home-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      ['--import', sourceLoader, fileURLToPath(new URL('./fixtures/native-relay-source.mjs', import.meta.url)), sourceRoot,
        fileURLToPath(new URL('../', import.meta.url))],
      { env: { PATH: process.env.PATH, HOME: home, FASTAITOKEN_API_KEY: fixtureKey,
        TSX_TSCONFIG_PATH: path.join(sourceRoot, 'tsconfig.json') }, timeout: 25_000 });
    assert.match(stdout, /Real native relay routing, streamed tool loop and JSONL resume fixture passed/);
    assert.ok(!(stdout + stderr).includes(fixtureKey));
  });

test('native relay: CLI generation has explicit capacities, safe errors and no environment credential lookup', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'workspace-relay-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outputPath = path.join(dir, 'review.patch.yml');
  const script = fileURLToPath(new URL('../scripts/generate-native-bridge.mjs', import.meta.url));
  const env = { PATH: process.env.PATH, HOME: dir, FASTAITOKEN_API_KEY: fixtureKey };
  const args = [script, '--relay', route.nativeProtocol, route.nativeBaseURL, route.nativeModel, '16384', '4096', outputPath];
  const { stdout, stderr } = await promisify(execFile)(process.execPath, args, { env });
  assert.match(stdout, /No runtime or model was started/); assert.equal(stderr, '');
  assert.ok(!(await readFile(outputPath, 'utf8')).includes(fixtureKey));
  await assert.rejects(promisify(execFile)(process.execPath, args, { env }), error => {
    assert.match(error.stderr, /Overlay was not generated/); assert.ok(!error.stderr.includes(fixtureKey)); return true;
  });
  const invalid = [...args]; invalid[5] = ''; invalid[7] = path.join(dir, 'unreviewed.yml');
  await assert.rejects(promisify(execFile)(process.execPath, invalid, { env }));
  assert.equal(existsSync(invalid[7]), false);
});
