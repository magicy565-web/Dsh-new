import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createWorkspaceOmpPublicTools, snapshotWorkspaceOmpPublicFiles } from '../../server/workspace-omp-public-tools.mjs';

const packageRoot = process.env.WORKSPACE_OMP_PACKAGE_ROOT, cwd = process.cwd();
assert.equal(Bun.version, '1.3.14');
assert.equal(JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'))).version, '18.10.4');
const load = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
let networkCalls = 0;
const noNetwork = async () => { networkCalls++; throw new Error('No network is admitted by the public cleanup fixture.'); };
globalThis.fetch = noNetwork;
const { Settings } = await load('config/settings.ts'), { AuthStorage } = await load('session/auth-storage.ts'), { ModelRegistry } = await load('config/model-registry.ts');
const settings = await Settings.init({ cwd, agentDir: path.join(cwd, 'agent'), inMemory: true,
  overrides: { 'browser.relay': false, 'browser.tern': false, 'browser.cmux': false, 'eval.autoProvision': false } });
const authStorage = await AuthStorage.create(path.join(cwd, 'empty-auth.db'));
const modelRegistry = new ModelRegistry(authStorage, path.join(cwd, 'no-models.yml'), { settings, ignoreLocalModelConfig: true, fetch: noNetwork });
const toolSession = { cwd, settings, authStorage, modelRegistry, getSessionId: () => 'public-cleanup', getArtifactsDir: () => cwd };
const sourceRoot = path.join(cwd, 'public-originals'); await fs.mkdir(sourceRoot);
const source = path.join(sourceRoot, 'product.md'), content = '# PUBLIC SYNTHETIC PRODUCT\nCapacity unknown. No production material.\n';
await fs.writeFile(source, content);
const sha256 = createHash('sha256').update(content).digest('hex');
const snapshots = await snapshotWorkspaceOmpPublicFiles({ root: sourceRoot, files: [{ id: 'product', path: source, sha256 }] });
const configuration = { searchProvider: 'disabled', publicFiles: snapshots };
const directoryNames = async () => (await fs.readdir(cwd)).filter(name => name.startsWith('selected-public-materials-')).sort();
const exists = async filename => fs.lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const document = tools => tools.tools.find(tool => tool.name === 'workspace_public_document');
const make = options => createWorkspaceOmpPublicTools({ packageRoot, toolSession, configuration, authorize: async () => {}, fetchImpl: noNetwork, ...options });
const until = async check => { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Owned snapshot cleanup did not complete.'); };
const live = [], facts = { ompVersion: '18.10.4', bunVersion: Bun.version, realPublishedReadTool: true,
  syntheticPublicMaterial: true, paidModelCalls: 0, externalBusinessCalls: 0 };
try {
  const first = await make(), firstDirectory = (await directoryNames())[0]; live.push(first);
  const other = await make(), otherDirectory = (await directoryNames()).find(name => name !== firstDirectory); live.push(other);
  assert.notEqual(firstDirectory, otherDirectory);
  const receipt = await document(first).execute('real-read-before-close', { documentId: 'product' });
  assert.match(receipt.content.map(block => block.text).join('\n'), /Capacity unknown/);
  assert.equal(JSON.stringify(receipt).includes(cwd), false);
  const firstClose = first.close(), secondClose = first.close(); assert.equal(firstClose, secondClose); await Promise.all([firstClose, secondClose]);
  assert.equal(await exists(path.join(cwd, firstDirectory)), false);
  assert.equal(await exists(path.join(cwd, otherDirectory)), true);
  await assert.rejects(document(first).execute('closed-read', { documentId: 'product' }), /closed/);
  const otherReceipt = await document(other).execute('real-other-run-read', { documentId: 'product' });
  assert.match(otherReceipt.content.map(block => block.text).join('\n'), /Capacity unknown/);
  facts.normalClose = { ownedDirectoryRemoved: true, concurrentAndRepeatedClose: true, closedToolsRefused: true, otherRunStillReadable: true };

  const beforeFailure = await directoryNames();
  await assert.rejects(make({ configuration: { ...configuration, publicFiles: [snapshots[0], { id: 'invalid-second', content: 'PUBLIC invalid pin', sha256: '0'.repeat(64) }] } }), /snapshot/);
  assert.deepEqual(await directoryNames(), beforeFailure);
  await assert.rejects(make({ configuration: { ...configuration, browserExecutable: 'not-an-admitted-browser' } }), /reviewed Chromium/);
  assert.deepEqual(await directoryNames(), beforeFailure);
  facts.initializationFailure = { partialSnapshotWriteCleaned: true, laterComponentFailureCleaned: true, otherRunPreserved: true };

  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(make({ signal: alreadyAborted.signal }), /cancelled/);
  assert.deepEqual(await directoryNames(), beforeFailure);
  const idleController = new AbortController(), idle = await make({ signal: idleController.signal }); live.push(idle);
  const idleDirectory = (await directoryNames()).find(name => !beforeFailure.includes(name));
  await document(idle).execute('idle-after-real-read', { documentId: 'product' }, idleController.signal);
  idleController.abort(); await until(async () => !await exists(path.join(cwd, idleDirectory))); await idle.close();
  assert.deepEqual(await directoryNames(), beforeFailure);
  facts.lifecycleCancellation = { preAbortedCreatesNoSnapshot: true, idleAbortRemovesOwnedSnapshot: true, lifecycleListenerSurvivesCompletedToolCall: true };

  // Cancel after the actual ReadTool has completed but while the original
  // post-read authorization is pending. No result may escape after revocation.
  for (const useLifecycleSignal of [true, false]) {
    const controller = new AbortController(); let authorizationCalls = 0, entered, release;
    const postRead = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const active = await make({ ...(useLifecycleSignal ? { signal: controller.signal } : {}), authorize: async () => {
      if (++authorizationCalls === 2) { entered(); await gate; }
    } }); live.push(active);
    const activeDirectory = (await directoryNames()).find(name => !beforeFailure.includes(name));
    const pending = document(active).execute('real-read-cancelled-before-receipt', { documentId: 'product' }, controller.signal);
    await postRead; controller.abort();
    try { await until(async () => !await exists(path.join(cwd, activeDirectory))); }
    finally { release(); }
    await assert.rejects(pending, /cancelled/); await active.close();
    assert.deepEqual(await directoryNames(), beforeFailure);
    assert.equal(await exists(path.join(cwd, otherDirectory)), true);
  }
  facts.activeCancellation = { actualReadCompletedBeforeAbort: true, lifecycleAndToolSignalsTested: true, cancelledReceiptRejected: true, otherRunPreserved: true };
  assert.equal(await fs.readFile(source, 'utf8'), content);
  assert.equal(createHash('sha256').update(await fs.readFile(source)).digest('hex'), sha256);
  await other.close(); assert.deepEqual(await directoryNames(), []);
  facts.originalSourcePreserved = true; facts.networkCalls = networkCalls; assert.equal(networkCalls, 0);
  await fs.writeFile(process.env.WORKSPACE_OMP_PUBLIC_CLEANUP_EVIDENCE, JSON.stringify(facts, null, 2) + '\n');
  console.log('PUBLIC_OMP_SNAPSHOT_CLEANUP_VERIFIED');
} finally { await Promise.all(live.map(tools => tools.close())); authStorage.close(); }
