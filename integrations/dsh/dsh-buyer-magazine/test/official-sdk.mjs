// Opt-in synthetic SDK acceptance. No Agent factory/AgentLoop/model/HTTP/browser.
import assert from 'node:assert/strict';
import { cp, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { issueFixture, json } from './fixture.mjs';
const runtime = process.argv[2];
if (!runtime || !isAbsolute(runtime)) throw new Error('Supply an explicit absolute existing runtime. No SDK was loaded.');
const source = fileURLToPath(new URL('../', import.meta.url)), req = createRequire(join(runtime, 'package.json'));
const names = ['cordis', 'dsh-tools', 'dsh-system-prompt', 'dsh-llm', 'dsh-fs', 'dsh-fs-sandbox', 'dsh-working-directory', 'dsh-sandbox-policy', 'dsh-session', 'dsh-session-projection', 'dsh-scope', 'dsh-tool-present', 'dsh-fs-observation-policy'];
const entries = {};
for (const name of names) {
  const manifest = req.resolve('@deepseek-ai/' + name + '/package.json');
  assert.equal(JSON.parse(await readFile(manifest, 'utf8')).version, name === 'cordis' ? '4.0.5' : '0.2.1-rc.2');
  entries[name] = { entry: req.resolve('@deepseek-ai/' + name), root: dirname(manifest) };
}
const root = await mkdtemp(join(tmpdir(), 'dsh-magazine-present-sdk-'));
let ctx, scope;
try {
  const bundle = join(root, 'bundle'), workspace = join(root, 'owned-synthetic-workspace'); await mkdir(workspace);
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  for (const file of ['package.json', ...manifest.files]) {
    const target = join(bundle, file); await mkdir(dirname(target), { recursive: true }); await cp(join(source, file), target, { recursive: true });
  }
  await mkdir(join(root, 'node_modules/@deepseek-ai'), { recursive: true });
  for (const [name, value] of Object.entries(entries)) await symlink(value.root, join(root, 'node_modules/@deepseek-ai', name), 'dir');
  const bundleReq = createRequire(join(bundle, 'package.json'));
  assert.equal(await realpath(bundleReq.resolve('@deepseek-ai/dsh-llm')), await realpath(entries['dsh-llm'].entry));
  const load = name => import(pathToFileURL(entries[name].entry).href);
  const [{ Context }, { default: ToolRuntime }, { default: SystemPrompt }, { ToolCallId }, { default: SandboxedFileSystem },
    { default: WorkingDirectory }, { default: SandboxPolicy, setSandboxMode }, { Session, SessionId }, { SessionProjectionRegistry },
    { createScope }, { apply: mountPresent }, { apply: mountObservation }, { z }] = await Promise.all([
    load('cordis'), load('dsh-tools'), load('dsh-system-prompt'), load('dsh-llm'), load('dsh-fs-sandbox'), load('dsh-working-directory'),
    load('dsh-sandbox-policy'), load('dsh-session'), load('dsh-session-projection'), load('dsh-scope'), load('dsh-tool-present'), load('dsh-fs-observation-policy'), import(pathToFileURL(req.resolve('zod')).href),
  ]);
  const { compileDraft } = await import(pathToFileURL(join(bundle, 'compiler.js')).href);
  const { apply } = await import(pathToFileURL(join(bundle, 'index.js')).href);
  ctx = new Context(); new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false });
  new SessionProjectionRegistry(ctx); new SandboxPolicy(ctx, { mode: 'workspace-write', workspaceRoot: workspace });
  new SandboxedFileSystem(ctx, { cwd: workspace, diffBasisMaxBytes: 1024 * 1024 }); new WorkingDirectory(ctx, { defaultDirectory: workspace }); new ToolRuntime(ctx, { mode: 'native' });
  mountObservation(ctx); mountPresent(ctx, { maxFiles: 1 }); apply(ctx, {legacyCompiler:true});
  // Minimal test-only turnBoundary fold; production owns this in AgentLoop, which is NOT imported.
  ctx.sessionProjections.register({ key: 'turnBoundary', stateVersion: 1,
    stateSchema: z.object({ lastTurn: z.number(), openTurnStartSeq: z.number().nullable() }), init: () => ({ lastTurn: 0, openTurnStartSeq: null }),
    apply: (state, event) => event.type === 'turn/start' ? { lastTurn: event.data.turn, openTurnStartSeq: event.seq }
      : event.type === 'turn/end' ? { ...state, openTurnStartSeq: null } : state });
  ctx.sessionProjections.register({ key: 'syntheticDeliveryReceipt', stateVersion: 1,
    stateSchema: z.object({ count: z.number(), paths: z.array(z.string()) }), init: () => ({ count: 0, paths: [] }),
    apply: (state, event) => event.type === 'deliverables/presented' ? { count: state.count + 1, paths: event.data.files.map(f => f.path) } : state });
  const id = SessionId('synthetic-magazine-session');
  const session = Session.create(id, [], { version: 4, id, createdAt: 0, cwd: workspace, isSeeded: false });
  const agent = { session }; scope = createScope(ctx, agent); agent.ctx = scope.ctx; // structural fixture, not live Agent
  let writes = 0, dispatches = 0; const nativeWrite = ctx.fs.writeText.bind(ctx.fs);
  ctx.fs.writeText = async (...args) => { assert.equal(args[2].kind, 'createIfAbsent'); const result = await nativeWrite(...args); writes++; return result; };
  const dispatch = (name, args, actor = agent) => ctx.tools.execute({ name, callId: ToolCallId(`synthetic-magazine-call-${++dispatches}`),
    arguments: args, ...(actor ? { agent: actor } : {}), signal: new AbortController().signal });
  const generate = value => dispatch('buyer_magazine_generate', { issueJson: json(value) });
  const good = issueFixture(), expected = compileDraft(json(good));
  assert.equal((await dispatch('buyer_magazine_validate_issue', { issueJson: json(good) })).isError, false);
  assert.equal((await dispatch('buyer_magazine_generate', { issueJson: json(good) }, null)).error.info.code, 'MAGAZINE_SESSION_REQUIRED');
  assert.equal((await dispatch('buyer_magazine_generate', { issueJson: '{}' })).error.info.code, 'MAGAZINE_ISSUE_INVALID'); assert.equal(writes, 0);
  const first = await generate(good); assert.equal(first.isError, false); assert.equal(writes, 1); assert.deepEqual(await readFile(first.value.path), expected.data);
  const authored = await dispatch('buyer_magazine_review_artifact', {htmlPath:first.value.path,view:'screen'});
  assert.equal(authored.isError,false);assert.equal(authored.value.reason,'NATIVE_IMAGE_ROUTE_UNAVAILABLE');
  assert.equal(authored.value.sha256,expected.sha256);assert.equal(writes,1);
  const escapedReview=await dispatch('buyer_magazine_review_artifact',{htmlPath:join(root,'outside.html'),view:'screen'});
  assert.equal(escapedReview.error.info.code,'MAGAZINE_WORKSPACE_DENIED');
  const before = await stat(first.value.path, { bigint: true }); const repeated = await generate(good); const after = await stat(first.value.path, { bigint: true });
  assert.equal(repeated.value.reused, true); assert.equal(writes, 1); assert.equal(before.mtimeNs, after.mtimeNs); assert.equal(before.ino, after.ino);
  assert.equal(first.value.presentation, 'pending-official-present'); assert.equal(ctx.sessionProjections.stateOf(session, 'syntheticDeliveryReceipt').count, 0);
  const files = [{ path: first.value.path, description: 'Synthetic review-only HTML magazine' }];
  assert.equal((await dispatch('present', { files })).isError, true); // closed turn
  session.append('turn/start', { turn: 1 }); // synthetic log event, no model turn
  assert.equal((await dispatch('present', { files })).isError, false);
  assert.deepEqual(ctx.sessionProjections.stateOf(session, 'syntheticDeliveryReceipt'), { count: 1, paths: [first.value.path] });
  const restrict = scope.ctx.tools.restrict({ deny: ['present'] }); assert.equal((await dispatch('present', { files })).isError, true); restrict();
  const guard = scope.ctx.tools.guard(exec => exec.name === 'buyer_magazine_generate' ? 'Synthetic guard denial' : undefined);
  assert.equal((await generate(good)).isError, true); guard(); assert.equal(writes, 1);
  assert.equal(ctx.sessionProjections.stateOf(session, 'syntheticDeliveryReceipt').count, 1);
  setSandboxMode(session, 'read-only'); assert.equal((await generate(good)).error.info.code, 'MAGAZINE_WORKSPACE_DENIED'); assert.equal(writes, 1); setSandboxMode(session, 'workspace-write');
  const conflictIssue = issueFixture(); conflictIssue.id = 'synthetic-conflict'; const conflictDraft = compileDraft(json(conflictIssue));
  const conflictPath = join(workspace, conflictDraft.name), unrelated = Buffer.alloc(conflictDraft.data.length, 88); await writeFile(conflictPath, unrelated);
  assert.equal((await generate(conflictIssue)).error.info.code, 'MAGAZINE_TARGET_CONFLICT'); assert.deepEqual(await readFile(conflictPath), unrelated); assert.equal(writes, 1);
  const linkedIssue = issueFixture(); linkedIssue.id = 'synthetic-symlink'; const linked = compileDraft(json(linkedIssue));
  const outside = join(root, 'owned-outside.txt'); await writeFile(outside, 'synthetic outside sentinel'); await symlink(outside, join(workspace, linked.name));
  assert.equal((await generate(linkedIssue)).error.info.code, 'MAGAZINE_WORKSPACE_DENIED'); assert.equal(await readFile(outside, 'utf8'), 'synthetic outside sentinel'); assert.equal(writes, 1);
  for (const name of ['agents', 'sessions', 'llm', 'credentials', 'profileContext', 'connection', 'loader']) assert.equal(ctx.get(name), undefined);
  console.log(JSON.stringify({ status: 'passed', runtime: '0.2.1-rc.2', node: process.version, nativeFileWrites: writes, verifiedHtmlBytes: expected.data.length,
    reusePreservedMtimeAndInode: true, nativeToolDispatches: dispatches, officialPresentEvents: 1, syntheticDetachedSessions: 1, structuralAgentCarriers: 1,
    liveAgents: 0, syntheticTurnBoundaryFixture: true, syntheticTurnStartEvents: 1, modelTurns: 0, agentLoops: 0, httpServers: 0,
    browserAcceptance: 'not-run', productionHostAcceptance: 'not-run' }));
} finally {
  try { await scope?.dispose(); await ctx?.fiber.dispose(); }
  finally { await rm(root, { recursive: true, force: true }); await assert.rejects(stat(root), { code: 'ENOENT' }); }
}
