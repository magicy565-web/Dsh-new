// Explicit keyless acceptance fixture: official fixed OMP tools, public synthetic data only.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { WORKSPACE_OMP_PUBLIC_BROWSER_ARGS } from '../../server/workspace-omp-public-tools.mjs';
const root = process.env.OMP_BUILTINS_SDK_ROOT;
const load = relative => import(pathToFileURL(path.join(root, relative)).href);
assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version, '18.10.4');
const { Settings } = await load('src/config/settings.ts');
const { AuthStorage, SqliteAuthCredentialStore } = await load('src/session/auth-storage.ts');
const { ModelRegistry } = await load('src/config/model-registry.ts');
const { WebSearchTool } = await load('src/web/search/index.ts');
const { createBrowserPrelude } = await load('src/tools/browser.ts');
const { ReadTool } = await load('src/tools/read.ts');
const { EvalTool } = await load('src/tools/eval.ts');
const { disposeVmContextsByOwner } = await load('src/eval/js/context-manager.ts');
const settings = await Settings.init({ inMemory: true, overrides: {
  'browser.relay': false, 'browser.tern': false, 'browser.cmux': false,
  'browser.headless': true, 'eval.py': false, 'eval.js': true, 'eval.autoProvision': false } });
const auth = new AuthStorage(await SqliteAuthCredentialStore.open(path.join(process.cwd(), 'empty-auth.db')));
const modelRegistry = new ModelRegistry(auth, path.join(process.cwd(), 'absent-models.yml'), {
  ignoreLocalModelConfig: true, settings, fetch: async () => { throw new Error('Model discovery forbidden in keyless fixture'); } });
const session = { cwd: process.cwd(), settings, authStorage: auth, modelRegistry,
  getSessionId: () => 'public-synthetic-factory-builtins', getArtifactsDir: () => process.cwd(),
  getEvalKernelOwnerId: () => 'public-synthetic-factory-builtins-owner' };
const result = { version: 1, ompVersion: '18.10.4', bunVersion: Bun.version,
  syntheticOnly: true, paidModelCalls: 0, hostCredentialReads: 0, hostBrowserAttach: false,
  toolInvocation: 'official-tool-class-and-eval-browser-prelude; no model session claimed' };
let server;
const prelude = createBrowserPrelude(session);
session.getEvalPreludes = () => [prelude];
try {
  const search = new WebSearchTool(session), savedFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    requests++;
    assert.equal(String(url), 'https://html.duckduckgo.com/html/');
    assert.equal(init.method, 'POST'); assert.match(init.body, /synthetic/);
    return new Response('<div class="result"><a class="result__a" href="https://catalog.example.invalid/synthetic-product">Synthetic public catalog</a><a class="result__snippet">Synthetic catalog for tool verification; not a real customer.</a></div>', { status: 200 });
  };
  try {
    const found = await search.execute('search-source-receipt', { query: 'synthetic product catalog', model: 'web/duckduckgo', limit: 1 });
    assert.equal(found.details.response.provider, 'duckduckgo');
    assert.equal(found.details.response.sources[0].url, 'https://catalog.example.invalid/synthetic-product');
    assert.ok(found.content.some(row => row.text.includes('Synthetic public catalog')));
    result.search = { status: 'synthetic-pass', requests, provider: found.details.response.provider,
      sourceURL: found.details.response.sources[0].url, independentCustomerEvidence: false };
    globalThis.fetch = async () => new Response('synthetic authorization denied', { status: 403 });
    const denied = await search.execute('search-refusal', { query: 'synthetic product', model: 'web/duckduckgo', limit: 1 });
    assert.ok(denied.details.error); assert.equal(denied.details.response.sources.length, 0);
    result.search.refusal = { status: 'synthetic-403-reported', sources: 0, bypass: false };
  } finally { globalThis.fetch = savedFetch; }

  const document = path.join(process.cwd(), 'public-synthetic-product.md');
  await fs.writeFile(document, '# Public synthetic factory product\nProduct: synthetic cup\nCapacity: unknown; requires human review.\n');
  const read = await new ReadTool(session).execute('read-public-document', { path: document });
  assert.ok(read.content.some(row => row.text.includes('Capacity: unknown')));
  result.document = { status: 'synthetic-public-markdown-pass', conversionOrOCRClaimed: false };

  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Public synthetic factory catalog</title><h1>Synthetic cup</h1><p id="conditions">Capacity unknown; human review required.</p>'
      + (req.url === '/no-scripts' ? '<script>document.body.textContent="SYNTHETIC_SCRIPT_EXECUTED_NOT_ALLOWED";</script>' : ''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/synthetic-catalog`;
  const opened = await prelude.invoke({ action: 'open', name: 'factory-synthetic', url,
    allowed_domains: ['127.0.0.1'], app: { relay: false, tern: false }, timeout: 15 }, {});
  assert.equal(opened.details.url, url);
  const content = await prelude.invoke({ action: 'call', name: 'factory-synthetic',
    chain: [{ method: 'text', args: ['body'] }], timeout: 10 }, {});
  assert.ok(JSON.stringify(content).includes('Capacity unknown'));
  result.browser = { status: 'synthetic-owned-http-page-pass', mechanism: 'official-browser-eval-prelude',
    existingChromium: process.env.PUPPETEER_EXECUTABLE_PATH, browserDownload: false, externalCustomerResearch: false };
  await prelude.invoke({ action: 'close', all: true, kill: true }, {});
  const tabs = await prelude.invoke({ action: 'tabs' }, {});
  assert.equal(tabs.details.value.length, 0); result.browser.closedTabs = true;
  await prelude.invoke({ action: 'open', name: 'factory-script-policy', url: url.replace('/synthetic-catalog', '/no-scripts'),
    allowed_domains: ['127.0.0.1'], app: { path: '/usr/bin/chromium', relay: false, tern: false,
      args: [...WORKSPACE_OMP_PUBLIC_BROWSER_ARGS, `--user-data-dir=${path.join(process.cwd(), 'public-browser-profile')}`] }, timeout: 15 }, {});
  const policyBody = await prelude.invoke({ action: 'call', name: 'factory-script-policy', chain: [{ method: 'text', args: ['body'] }], timeout: 10 }, {});
  assert.ok(JSON.stringify(policyBody).includes('Capacity unknown'));
  assert.ok(!JSON.stringify(policyBody).includes('SYNTHETIC_SCRIPT_EXECUTED_NOT_ALLOWED'));
  const observedRequests = await prelude.invoke({ action: 'call', name: 'factory-script-policy', chain: [{ method: 'requests', args: [{ type: 'document', limit: 10 }] }], timeout: 10 }, {});
  assert.ok(observedRequests.details.value.some(row => row.method === 'GET' && row.status === 200));
  await prelude.invoke({ action: 'close', all: true, kill: true }, {});
  assert.equal((await prelude.invoke({ action: 'tabs' }, {})).details.value.length, 0);
  result.browser.controlledScriptPolicy = { status: 'actual-existing-chromium-synthetic-script-disabled-pass',
    pageScriptsExecuted: false, isolatedProfile: true, closedTabs: true, productionPublicURLAdmissionClaim: false };
  const evalTool = new EvalTool(session);
  const evaluated = await evalTool.execute('browser-via-builtin-eval', { language: 'js', timeout: 15,
    code: `const t = await browser.open(${JSON.stringify({ name: 'factory-eval', url, allowed_domains: ['127.0.0.1'], app: { relay: false, tern: false } })}); console.log(await t.text('body')); await browser.close({all:true,kill:true});` });
  assert.ok(evaluated.content.some(row => row.text?.includes('Capacity unknown')));
  result.browser.evalToolChain = 'official-EvalTool → JavaScript kernel → browser prelude → existing Chromium';
  const aborter = new AbortController();
  const cancelledAt = Date.now();
  const cancellation = evalTool.execute('cancel-synthetic-eval', { language: 'js', timeout: 10,
    code: 'await new Promise(resolve => setTimeout(resolve, 10000));' }, aborter.signal);
  setTimeout(() => aborter.abort(), 75);
  const cancelled = await cancellation;
  assert.equal(cancelled.isError, true); assert.match(JSON.stringify(cancelled.content), /abort|cancel/i);
  assert.ok(Date.now() - cancelledAt < 3000, 'Cancellation must stop the wait rather than complete its ten-second timer.');
  result.evalCancellation = { status: 'synthetic-kernel-abort-pass', noSubagentClaim: true };
  if (process.env.OMP_BUILTINS_LIVE_SEARCH === '1') {
    try {
      const live = await search.execute('public-live-source-receipt', { query: 'ceramic tableware distributor public product catalog',
        model: 'web/duckduckgo', limit: 2 }, AbortSignal.timeout(15000));
      result.liveSearch = { status: live.details.error ? 'blocked' : 'available',
        reason: live.details.error, sourceCount: live.details.response.sources.length,
        sources: live.details.response.sources.map(row => ({ title: row.title, url: row.url })) };
    } catch (error) { result.liveSearch = { status: 'blocked', reason: error.message, sourceCount: 0 }; }
  } else result.liveSearch = { status: 'not-executed', sourceCount: 0 };
  await fs.writeFile(process.env.OMP_BUILTINS_EVIDENCE, JSON.stringify(result, null, 2) + '\n');
  console.log('OMP_PUBLIC_SYNTHETIC_BUILTINS_VERIFIED');
} finally {
  await prelude.invoke({ action: 'close', all: true, kill: true }, {}).catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  await disposeVmContextsByOwner('public-synthetic-factory-builtins-owner');
  auth.close();
}
