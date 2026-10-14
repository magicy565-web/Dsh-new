import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createWorkspaceOmpPublicTools } from '../../server/workspace-omp-public-tools.mjs';
const packageRoot = process.env.WORKSPACE_OMP_PACKAGE_ROOT, load = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const { Settings } = await load('config/settings.ts'), { AuthStorage } = await load('session/auth-storage.ts'), { ModelRegistry } = await load('config/model-registry.ts');
const cwd = process.cwd(), settings = await Settings.init({ cwd, agentDir: cwd + '/agent', inMemory: true, overrides: {
  'browser.relay': false, 'browser.tern': false, 'browser.cmux': false, 'browser.headless': true, 'eval.autoProvision': false } });
const authStorage = await AuthStorage.create(cwd + '/empty-auth.db');
const modelRegistry = new ModelRegistry(authStorage, cwd + '/no-models.yml', { settings, ignoreLocalModelConfig: true,
  fetch: async () => { throw new Error('No credential or model discovery in this fixture.'); } });
const toolSession = { cwd, settings, authStorage, modelRegistry, getSessionId: () => 'public-tool-test', getArtifactsDir: () => cwd };
let authorizations = 0, requests = 0;
const evidence = { version: 1, testedAt: new Date().toISOString(), ompVersion: '18.10.4', bunVersion: Bun.version,
  syntheticToolTests: true, paidModelCalls: 0, productionBusinessCalls: 0, credentialCreation: false, externalActions: false };
const configuration = { searchProvider: 'duckduckgo', publicFiles: [{ id: 'product', content: 'Public synthetic cup\nCapacity unknown.\n',
  sha256: createHash('sha256').update('Public synthetic cup\nCapacity unknown.\n').digest('hex') }] };
const configured = await createWorkspaceOmpPublicTools({ packageRoot, toolSession, configuration,
  authorize: async () => { authorizations++; }, fetchImpl: async (url, init) => {
    requests++; assert.equal(url.href, 'https://html.duckduckgo.com/html/'); assert.equal(init.redirect, 'error');
    return new Response('<div class="result"><a class="result__a" href="https://example.com/synthetic-catalog">Synthetic distributor catalog</a><a class="result__snippet">Public synthetic candidate, not a real buyer.</a></div>');
  } });
try {
  const search = configured.tools.find(row => row.name === 'workspace_public_search');
  const source = await search.execute('public-search', { query: 'Public synthetic cup distributor', limit: 1 });
  assert.equal(source.details.status, 'sources_observed'); assert.equal(source.details.sources[0].url, 'https://example.com/synthetic-catalog');
  assert.equal(source.details.verifiedBuyer, false); assert.equal(source.details.contactPermission, false);
  evidence.search = { status: 'actual-native-provider-synthetic-transport-pass', sourceCount: source.details.sources.length, requests };
  const read = configured.tools.find(row => row.name === 'workspace_public_document');
  const document = await read.execute('public-document', { documentId: 'product' });
  assert.match(JSON.stringify(document.content), /Capacity unknown/); assert.equal(JSON.stringify(document).includes(cwd), false);
  await assert.rejects(read.execute('nonselected', { documentId: 'auth.db' }), /not explicitly selected/);
  await assert.rejects(read.execute('arbitrary-path', { documentId: 'product', path: cwd + '/empty-auth.db' }), /not explicitly selected/);
  await assert.rejects(search.execute('secret', { query: 'api_key=syntheticSecretValue123' }), /credentials/);
  const dirs = (await fs.readdir(cwd)).filter(name => name.startsWith('selected-public-materials-'));
  await fs.writeFile(path.join(cwd, dirs[0], 'product.txt'), 'Altered public bytes.');
  await assert.rejects(read.execute('changed', { documentId: 'product' }), /changed/);
  evidence.documents = { status: 'actual-native-read-pass', exactIDAndHash: true, pathNotDisclosed: true, changeRejected: true, privateLibrary: 'disabled' };
  let deniedNetworkCalls = 0;
  const denied = await createWorkspaceOmpPublicTools({ packageRoot, toolSession, authorize: async () => { throw new Error('Original member binding revoked.'); },
    fetchImpl: async () => { deniedNetworkCalls++; return new Response('Must not run'); } });
  await assert.rejects(denied.tools[0].execute('denied', { query: 'public product' }), /revoked/);
  evidence.deniedNetworkCalls = deniedNetworkCalls;
  const refusal = await createWorkspaceOmpPublicTools({ packageRoot, toolSession, authorize: async () => {},
    fetchImpl: async () => new Response('Synthetic forbidden.', { status: 403 }) });
  const failed = await refusal.tools[0].execute('provider-403', { query: 'public synthetic catalog' });
  assert.equal(failed.isError, true); assert.equal(failed.details.sources.length, 0); assert.equal(failed.details.status, 'unavailable');
  evidence.refusal = { status: 'synthetic-403-refusal-pass', sources: 0, fallback: false };
  const browser = await createWorkspaceOmpPublicTools({ packageRoot, toolSession, authorize: async () => {},
    configuration: { searchProvider: 'disabled', browserExecutable: '/usr/bin/chromium' }, lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }] });
  await assert.rejects(browser.tools[0].execute('private-dns', { url: 'https://example.com/catalog' }), /private or reserved/);
  await assert.rejects(browser.tools[0].execute('local-url', { url: 'http://127.0.0.1/catalog' }), /public HTTPS/);
  await browser.close(); evidence.browser = { status: 'private-URL-and-DNS-admission-rejected-before-browser', realPublicNavigation: 'not-executed' };
  if (process.env.WORKSPACE_OMP_PUBLIC_LIVE_PROVIDER) {
    const provider = process.env.WORKSPACE_OMP_PUBLIC_LIVE_PROVIDER;
    const live = await createWorkspaceOmpPublicTools({ packageRoot, toolSession, authorize: async () => {}, configuration: { searchProvider: provider } });
    const value = await live.tools[0].execute('public-live', { query: 'ceramic tableware distributor public product catalog', limit: 2 });
    evidence.live = { provider, status: value.details.status, failure: value.details.failure,
      sources: value.details.sources.map(({ title, url }) => ({ title, url })),
      noPaidCalls: true, challengeBypass: false, noBuyerVerification: true }; await live.close();
  }
  evidence.authorizations = authorizations;
  await fs.writeFile(process.env.WORKSPACE_OMP_PUBLIC_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  console.log('PUBLIC_OMP_ADMISSION_VERIFIED');
} finally { await configured.close(); authStorage.close(); }
