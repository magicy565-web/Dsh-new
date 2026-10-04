// Keyless integration: actual native Session, JSONL, AgentLoop and scripted in-process tool execution.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile, readdir, cp, rename, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [source, workspace] = process.argv.slice(2);
const load = relative => import(pathToFileURL(path.join(source, relative)).href);
globalThis.fetch = () => { throw new Error('Native recovery fixture forbids network requests'); };
const { Context } = await load('vendor/cordis/src/index.ts');
const { default: SessionStore, SESSION_FORMAT_VERSION, interruptedTurnClosers } = await load('packages/core/session/src/index.ts');
const { projectKey } = await load('packages/session/session-persistence-jsonl/src/format.ts');
const { default: Jsonl } = await load('packages/session/session-persistence-jsonl/src/index.ts');
const { setSandboxMode } = await load('packages/sandbox/sandbox-policy/src/index.ts');
const { setApprovalPolicy } = await load('packages/interaction/user-approval/src/index.ts');
const { foldGoal } = await load('packages/goal/goal/src/index.ts');
const { tryLockExclusive } = await load('native/system/packages/entry/lib/flock.js');
const { mountAgentLoopTestDependencies } = await load('packages/test-support/agent-loop-testkit/src/index.ts');
const { default: AgentLoop } = await load('packages/core/agent-loop/src/index.ts');
const { LlmAdapter, createUserMessage } = await load('packages/llm/llm/src/index.ts');
const { default: Storage } = await load('packages/storage/storage/src/index.ts');
const StorageJson = await load('packages/storage/storage-json/src/index.ts');
const { default: LocalSpillStore } = await load('packages/spill/spill-local/src/index.ts');
const { formatSpillNotice } = await load('packages/spill/spill-policy/src/notice.ts');
const { default: LocalAttachmentStore } = await load('packages/attachment/attachment-local/src/index.ts');
const { defineContentToolFixture } = await load('packages/core/tools/src/index.ts');
const { createNativeRecoveryAdapter } = await import(pathToFileURL(path.join(workspace, 'server/native-recovery.mjs')).href);
const { createBackup, verifyBackup, restoreBackup } = await import(pathToFileURL(path.join(workspace, 'scripts/recovery.mjs')).href);
const { generateNativeStorageOverlay } = await import(pathToFileURL(path.join(workspace, 'scripts/generate-native-bridge.mjs')).href);
const { createApp } = await import(pathToFileURL(path.join(workspace, 'server/index.mjs')).href);
const dependencies = { Context, Jsonl, SessionStore, SESSION_FORMAT_VERSION, interruptedTurnClosers, setSandboxMode, setApprovalPolicy, foldGoal, tryLockExclusive };
const adapter = createNativeRecoveryAdapter(dependencies);
const root = await mkdtemp(path.join(tmpdir(), 'native-recovery-source-'));
const data = path.join(root, 'data'), sessionRoot = path.join(data, 'harness', 'sessions'), cwd = path.join(data, 'agent-workspace');
const id = 'workspace-session-' + 'e'.repeat(32);
let requests = 0, executed = 0, ctx;
class Script extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream() {
    requests++;
    if (requests === 1) yield* [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'fixture-tool-call', name: 'fixture_echo', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ];
    else yield* [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Explicit recovery fixture response' } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ];
  }
}
async function compose() {
  const ctx = new Context(); await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(Jsonl, { root: sessionRoot, compression: 'none' });
  ctx.llm.registerAdapter(['fixture'], new Script());
  ctx.tools.register(defineContentToolFixture({ name: 'fixture_echo', description: 'In-process synthetic fixture only', parameters: {}, async execute() { executed++; return [{ type: 'text', text: 'Fixture tool receipt' }]; } }));
  return ctx;
}
async function storage(rootPath, compression = 'none') {
  const ctx = new Context(); await ctx.plugin(SessionStore); await ctx.plugin(Jsonl, { root: rootPath, compression }); return ctx;
}
async function stored(rootPath = sessionRoot, sessionId = id) {
  const s = await storage(rootPath); try { const h = await s.sessionPersistence.open(sessionId, 'read'); try { return { header: structuredClone(h.header), inheritedEventCount: h.inheritedEventCount, events: (await h.read()).events }; } finally { await h.close(); } } finally { await s.fiber.dispose(); }
}
async function allFiles(dir) {
  const out = {};
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) for (const [name, bytes] of Object.entries(await allFiles(file))) out[`${item.name}/${name}`] = bytes;
    else if (item.name !== 'session.lock') out[item.name] = (await readFile(file)).toString('base64');
  }
  return out;
}
try {
  const overlayHome = path.join(root, 'overlay-home'), overlayPath = path.join(root, 'storage.patch.yml');
  await generateNativeStorageOverlay({ dshHome: overlayHome, compression: 'none', outputPath: overlayPath });
  const rows = JSON.parse(await readFile(overlayPath, 'utf8'));
  const config = id => rows.find(row => row.id === id).config;
  const baseProfile = await readFile(path.join(source, 'packages/bundle/base/cordis.patch.yml'), 'utf8');
  for (const row of rows) assert.ok(baseProfile.includes(`- id: ${row.id}\n`));
  const overlayCtx = new Context(); await overlayCtx.plugin(SessionStore); await overlayCtx.plugin(Storage);
  await overlayCtx.plugin(Jsonl, config('session-persistence-jsonl'));
  await overlayCtx.plugin(LocalAttachmentStore, config('attachment-local'));
  await overlayCtx.plugin(StorageJson, config('storage-json'));
  // Isolate this fixture from the runtime's unrelated age-based OS-temp cleanup sweep.
  await overlayCtx.plugin(LocalSpillStore, { ...config('spill-local'), cleanupPeriodDays: 0 });
  const overlaySession = await overlayCtx.sessionPersistence.create({ id: 'overlay-session', version: 4, cwd, createdAt: 1, isSeeded: false });
  await overlaySession.flush(); await overlaySession.close();
  await overlayCtx.attachments.saveFile({ data: Buffer.from('Overlay file bytes'), name: 'overlay.txt' });
  const unit = await overlayCtx.storage.backend.get('json').kv.open({ name: 'fixture', version: 1, tables: ['records'], hasGlobal: false });
  await unit.putRecord('records', 'one', { value: 'Overlay storage bytes' }); await unit.close();
  const overlaySpill = await overlayCtx.spillStore.saveText({ owner: { sessionId: 'overlay-session' }, source: { kind: 'tool', toolName: 'fixture_echo', callId: 'overlay-call', label: 'result' }, suggestedName: 'fixture.txt', content: 'Overlay spill bytes' });
  assert.ok(overlaySpill.locator.startsWith(path.join(overlayHome, 'spills') + path.sep));
  assert.equal((await readdir(path.join(overlayHome, 'sessions'))).length, 1);
  assert.ok((await readdir(path.join(overlayHome, 'attachments', 'v1'))).includes('file-objects'));
  assert.ok((await readdir(path.join(overlayHome, 'storages'))).includes('fixture.json'));
  await overlayCtx.fiber.dispose();
  const app = await createApp({ dataDirectory: data }); await app.close(); await mkdir(cwd, { recursive: true, mode: 0o700 });
  ctx = await compose();
  const h = await ctx.agents.create({ sessionId: id, meta: { cwd }, agentOptions: { provider: 'fixture', model: 'fixture' } });
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Original fixture input' }], source: { kind: 'user' } }));
  await h.agent.whenIdle(); await ctx.sessions.flush(h.agent.session); assert.equal(requests, 2); assert.equal(executed, 1);
  await assert.rejects(adapter.acquireLeases(sessionRoot), { code: 'NATIVE_RECOVERY_ACTIVE_WRITER' });
  await h.dispose(); await ctx.fiber.dispose(); ctx = undefined;
  const completed = await stored();
  // A real tool-call prefix models a crash after external dispatch but before result commit.
  const end = completed.events.findIndex(event => event.type === 'tool/call'); assert.ok(end >= 0);
  const crashed = structuredClone(completed.events.slice(0, end + 1));
  const attachmentCtx = new Context(); await attachmentCtx.plugin(LocalAttachmentStore, { dshHome: path.join(data, 'harness') });
  const attachmentBytes = Buffer.from('Native attachment exact bytes');
  const attachment = await attachmentCtx.attachments.saveFile({ data: attachmentBytes, name: 'fixture.txt' });
  await attachmentCtx.fiber.dispose();
  const attachmentHash = attachment.attachmentId.slice('sha256:'.length);
  const attachmentObject = path.join(data, 'harness', 'attachments', 'v1', 'file-objects', attachmentHash.slice(0, 2), attachmentHash);
  const attachmentFile = path.join(data, 'harness', 'attachments', 'v1', 'files', attachmentHash.slice(0, 2), attachmentHash, 'fixture.txt');
  assert.ok((await stat(attachmentFile)).nlink > 1);
  const append = (type, payload) => crashed.push({ type, seq: crashed.length, time: Date.now(), data: payload });
  append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [createUserMessage({ content: [{ type: 'text', text: 'Queued input must never replay' }, { type: 'file', attachment }], source: { kind: 'user' } })] });
  append('permission/preset', { preset: 'auto' }); append('sandbox/mode', { mode: 'danger-full-access' }); append('approval/policy', { policy: 'ask' });
  append('goal/change', { kind: 'goal/change', version: 1, operation: 'create', goal: { id: 'fixture-goal', revision: 1, objective: 'Never auto-resume fixture', phase: 'active', maxGoalRounds: 4 }, roundsStarted: 0, createdAt: 1, updatedAt: 1 });
  await rm(sessionRoot, { recursive: true });
  ctx = await storage(sessionRoot); const crashedHandle = await ctx.sessionPersistence.create(completed.header, { inheritedEventCount: completed.inheritedEventCount });
  await crashedHandle.append(crashed); await crashedHandle.flush(); await crashedHandle.close(); await ctx.fiber.dispose(); ctx = undefined;
  const state = JSON.parse(await readFile(path.join(data, 'workspace.json'), 'utf8'));
  state.conversations.push({ id: 'fixture-conversation', nativeSessionId: id, title: 'Recovery fixture', status: 'running' });
  state.runs.push({ id: 'fixture-run', nativeSessionId: id, status: 'running' });
  await writeFile(path.join(data, 'workspace.json'), JSON.stringify(state));
  await mkdir(path.join(data, 'harness', 'storages'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(data, 'harness', 'storages', 'schedule.json'), '{"fixture":"must remain inactive"}', { mode: 0o600 });
  await writeFile(path.join(data, 'harness', '.credentials.yaml'), 'fixture-secret-never-copied', { mode: 0o600 });
  const original = await allFiles(sessionRoot), summary = await adapter.inspect(sessionRoot, 'none', { workspaceDirectory: cwd });
  assert.equal(summary.sessions[0].id, id); assert.equal(summary.sessionFormatVersion, 4);
  assert.equal(summary.sessions[0].eventCount, crashed.length); assert.ok(!JSON.stringify(summary).includes('Original fixture input'));
  await rename(attachmentFile, attachmentFile + '.temporarily-missing');
  await assert.rejects(adapter.inspect(sessionRoot, 'none'), { code: 'NATIVE_RECOVERY_REFERENCE_MISSING' });
  await rename(attachmentFile + '.temporarily-missing', attachmentFile);
  await rename(attachmentObject, attachmentObject + '.held');
  await writeFile(attachmentObject, 'Changed fixture bytes', { mode: 0o600 });
  await assert.rejects(adapter.inspect(sessionRoot, 'none'), { code: 'NATIVE_RECOVERY_REFERENCE' });
  await rm(attachmentObject); await rename(attachmentObject + '.held', attachmentObject);
  const backup = path.join(root, 'backup'), restored = path.join(root, 'restored');
  await createBackup(data, backup, { nativeAdapter: adapter, native: { compression: 'none' } });
  await verifyBackup(backup, { nativeAdapter: adapter });
  assert.deepEqual(await allFiles(sessionRoot), original);
  const backupBefore = await allFiles(path.join(backup, 'harness', 'sessions'));
  await assert.rejects(stat(path.join(backup, 'harness', '.credentials.yaml')), { code: 'ENOENT' });
  const result = await restoreBackup(backup, restored, { nativeAdapter: adapter });
  assert.equal(result.nativeRuntimeIncluded, true); assert.equal(requests, 2); assert.equal(executed, 1);
  assert.deepEqual(await allFiles(path.join(backup, 'harness', 'sessions')), backupBefore);
  assert.deepEqual(await allFiles(sessionRoot), original);
  const restoredAttachment = path.join(restored, path.relative(data, attachmentFile));
  assert.deepEqual(await readFile(restoredAttachment), attachmentBytes); assert.equal((await stat(restoredAttachment)).nlink, 1);
  assert.equal(await readFile(path.join(restored, 'recovery-quarantine', result.sourceManifestSha256, 'harness', 'storages', 'schedule.json'), 'utf8'), '{"fixture":"must remain inactive"}');
  await assert.rejects(stat(path.join(restored, 'harness', 'storages', 'schedule.json')), { code: 'ENOENT' });
  const recovered = await stored(path.join(restored, 'harness', 'sessions'));
  assert.deepEqual(recovered.events.slice(0, crashed.length), crashed);
  assert.equal(recovered.events.filter(event => event.type === 'sandbox/mode').at(-1).data.mode, 'read-only');
  assert.equal(recovered.events.filter(event => event.type === 'approval/policy').at(-1).data.policy, 'never');
  assert.equal(recovered.events.filter(event => event.type === 'permission/preset').at(-1).data.preset, 'custom');
  assert.equal(foldGoal(recovered.events).goal.phase, 'paused');
  assert.ok(recovered.events.some(event => event.type === 'tool/result' && event.data.error?.code === 'TOOL_OUTCOME_UNKNOWN'));
  assert.ok(recovered.events.some(event => event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled'));
  await rename(data, path.join(root, 'preserved-original')); await rename(restored, data);
  ctx = await compose(); const resumed = await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'fixture', model: 'fixture' } });
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(requests, 2); assert.equal(executed, 1);
  assert.equal(resumed.agent.inbox.nextTurn.length, 0); assert.equal(resumed.agent.inbox.nextStep.length, 0);
  resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Explicit post-restore request' }], source: { kind: 'user' } }));
  await resumed.agent.whenIdle(); assert.equal(requests, 3); assert.equal(executed, 1);
  await resumed.dispose(); await ctx.fiber.dispose(); ctx = undefined;

  // Native parent catalogs require their exact child histories; every child is quarantined too.
  const family = path.join(root, 'family'); ctx = await storage(family);
  const childId = 'fixture-native-child', childCreatedAt = 2;
  const familyParent = await ctx.sessionPersistence.create({ ...completed.header });
  const familyEvents = structuredClone(completed.events);
  familyEvents.push({ type: 'subagent/catalog', seq: familyEvents.length, time: 2, data: { version: 0, childId, childCreatedAt, mode: 'one-shot', label: 'Fixture child' } });
  await familyParent.append(familyEvents); await familyParent.flush(); await familyParent.close();
  const childHeader = { ...completed.header, id: childId, parentSession: id, createdAt: childCreatedAt, origin: 'subagent', delegationDepth: 1 };
  const familyChild = await ctx.sessionPersistence.create(childHeader);
  await familyChild.append([{ type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } }, { type: 'subagent/descriptor', seq: 1, time: 2, data: { version: 3, mode: 'one-shot', provider: 'spawn', label: 'Fixture child' } }]);
  await familyChild.flush(); await familyChild.close(); await ctx.fiber.dispose(); ctx = undefined;
  assert.equal((await adapter.inspect(family, 'none')).sessions.length, 2);
  assert.equal((await adapter.quarantine(family, 'none')).sessions.length, 2);
  const childDirectory = path.join(family, projectKey(cwd), childId);
  await rename(childDirectory, path.join(root, 'held-child'));
  await assert.rejects(adapter.inspect(family, 'none'), { code: 'NATIVE_RECOVERY_LINEAGE' });

  // Physical Zstandard handling remains native-owned, including restrictive append on the copied root.
  const compressed = path.join(root, 'compressed'); ctx = await storage(compressed, 'zstd');
  const compressedHandle = await ctx.sessionPersistence.create({ ...completed.header, id: 'fixture-zstd' });
  await compressedHandle.append(completed.events); await compressedHandle.flush(); await compressedHandle.close(); await ctx.fiber.dispose(); ctx = undefined;
  assert.equal((await adapter.inspect(compressed, 'zstd')).sessions[0].eventCount, completed.events.length);
  assert.equal((await adapter.quarantine(compressed, 'zstd')).permissionsReset, true);
  await assert.rejects(adapter.inspect(compressed, 'none'), { code: 'NATIVE_RECOVERY_LAYOUT' });

  // Real native spill output must live in the reviewed captured root, and every locator must resolve.
  const spillData = path.join(root, 'spill-data'), spillRoot = path.join(spillData, 'harness', 'spills');
  const spillSessions = path.join(spillData, 'harness', 'sessions');
  const spillCtx = new Context(); await spillCtx.plugin(LocalSpillStore, { root: spillRoot, cleanupPeriodDays: 0 });
  const spill = await spillCtx.spillStore.saveText({ owner: { sessionId: id }, source: { kind: 'tool', toolName: 'fixture_echo', callId: 'fixture-tool-call', label: 'result' }, suggestedName: 'fixture.txt', content: 'Native spill exact bytes' });
  await spillCtx.fiber.dispose();
  const spillEvents = structuredClone(completed.events);
  const toolResult = spillEvents.find(event => event.type === 'tool/result');
  toolResult.data.message.content = [{ type: 'text', text: formatSpillNotice({ kind: 'exact', count: 5 }, spill) }];
  ctx = await storage(spillSessions); const spillHandle = await ctx.sessionPersistence.create({ ...completed.header, cwd: path.join(spillData, 'agent-workspace') });
  await spillHandle.append(spillEvents); await spillHandle.flush(); await spillHandle.close(); await ctx.fiber.dispose(); ctx = undefined;
  await adapter.inspect(spillSessions, 'none');
  await rename(spill.locator, spill.locator + '.held');
  await assert.rejects(adapter.inspect(spillSessions, 'none'), { code: 'NATIVE_RECOVERY_REFERENCE_MISSING' });
  await rename(spill.locator + '.held', spill.locator);
  const externalSpill = path.join(root, 'external-spill-sessions'); ctx = await storage(externalSpill);
  const externalHandle = await ctx.sessionPersistence.create({ ...completed.header });
  await externalHandle.append(spillEvents); await externalHandle.flush(); await externalHandle.close(); await ctx.fiber.dispose(); ctx = undefined;
  await assert.rejects(adapter.inspect(externalSpill, 'none'), { code: 'NATIVE_RECOVERY_EXTERNAL_SPILL' });

  // Supported V3 header migration is native-owned and retains byte-identical predecessor data.
  const historical = path.join(root, 'historical'), project = projectKey(cwd), histId = 'fixture-history';
  const histDir = path.join(historical, project, histId); await mkdir(histDir, { recursive: true, mode: 0o700 });
  const v3 = JSON.stringify({ type: 'session', version: 3, id: histId, cwd, createdAt: 1, isSeeded: false, delegationDepth: 0 }) + '\n';
  await writeFile(path.join(histDir, 'session.v3.jsonl'), v3, { mode: 0o600 });
  assert.equal((await adapter.inspect(historical, 'none')).sessions[0].eventCount, 0);
  const migrated = await adapter.quarantine(historical, 'none');
  assert.equal(migrated.migrations[0].from, 3); assert.equal(await readFile(path.join(histDir, 'session.v3.jsonl'), 'utf8'), v3);
  assert.ok((await readdir(histDir)).includes('session.v4.jsonl'));
  // A failed native migration leaves the immutable source untouched (wrapper removes failed stage).
  const faulty = path.join(root, 'faulty'); await mkdir(path.join(faulty, project, histId), { recursive: true, mode: 0o700 });
  await writeFile(path.join(faulty, project, histId, 'session.v3.jsonl'), v3, { mode: 0o600 });
  const faultyBefore = await allFiles(faulty);
  class FailingJsonl extends Jsonl { async open(id, access, options) { if (access === 'write') throw new Error('Explicit fixture migration failure'); return super.open(id, access, options); } }
  const failing = createNativeRecoveryAdapter({ ...dependencies, Jsonl: FailingJsonl });
  await assert.rejects(failing.quarantine(faulty, 'none'), /fixture migration failure/); assert.deepEqual(await allFiles(faulty), faultyBefore);
  const future = path.join(root, 'future'); await cp(historical, future, { recursive: true });
  await writeFile(path.join(future, project, histId, 'session.v5.jsonl'), JSON.stringify({ type: 'session', version: 5, id: histId }) + '\n', { mode: 0o600 });
  const futureBefore = await allFiles(future); await assert.rejects(adapter.quarantine(future, 'none'), { code: 'NATIVE_RECOVERY_FORMAT' }); assert.deepEqual(await allFiles(future), futureBefore);
  console.log('Real native backup, immutable-source migration, restrictive quarantine and no-replay recovery fixture passed; no live model or network.');
} finally { await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
