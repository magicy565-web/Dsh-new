// Manual read-only diagnostic. No model, account discovery, challenge handling
// or alternative route; never runs as part of the ordinary offline test suite.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { createWorkspaceOmpPublicTools } from '../server/workspace-omp-public-tools.mjs';

const mode = process.argv[2];
if (!globalThis.Bun || !['search', 'browser'].includes(mode) || process.argv[3] !== '--confirm-public-network' || process.argv.length !== 4)
  throw new Error('Use the fixed Bun runtime: scripts/omp-public-network-probe.mjs search|browser --confirm-public-network');
const { packageRoot } = workspaceOmpPaths({}), load = name => import(pathToFileURL(path.join(packageRoot, 'src', name)).href);
if (Bun.version !== '1.3.14' || JSON.parse(await fs.readFile(packageRoot + '/package.json')).version !== '18.10.4') throw new Error('Fixed reviewed runtime required.');
const cwd = await fs.mkdtemp('/tmp/omp-public-network-check-');
let authStorage, tools;
const signal = AbortSignal.timeout(20000);
const facts = { observedAt: new Date().toISOString(), mode, ompVersion: '18.10.4', bunVersion: Bun.version,
  status: 'unavailable', sources: [], realModelCalls: 0, paidModelCalls: 0, customerVerification: false,
  credentialsCreated: false, networkRouteChanged: false, challengeBypass: false, externalSending: false };
try {
  const { Settings } = await load('config/settings.ts'), { AuthStorage } = await load('session/auth-storage.ts'), { ModelRegistry } = await load('config/model-registry.ts');
  const settings = await Settings.init({ cwd, agentDir: cwd + '/agent', inMemory: true, overrides: {
    'browser.relay': false, 'browser.tern': false, 'browser.cmux': false, 'browser.headless': true, 'eval.autoProvision': false } });
  authStorage = await AuthStorage.create(cwd + '/empty-auth.db');
  const modelRegistry = new ModelRegistry(authStorage, cwd + '/no-models.yml', { settings, ignoreLocalModelConfig: true,
    fetch: async () => { throw new Error('Model discovery disabled.'); } });
  tools = await createWorkspaceOmpPublicTools({ packageRoot, signal, authorize: async () => {},
    toolSession: { cwd, settings, authStorage, modelRegistry, getSessionId: () => 'manual-public-network', getArtifactsDir: () => cwd },
    configuration: { searchProvider: mode === 'search' ? 'duckduckgo' : 'disabled', browserExecutable: mode === 'browser' ? '/usr/bin/chromium' : null } });
  const args = mode === 'search' ? { query: 'ceramic tableware distributor public product catalog', limit: 2 } : { url: 'https://www.iana.org/help/example-domains' };
  const result = await tools.tools[0].execute('manual-read-only-network-check', args, signal), value = result.details;
  Object.assign(facts, { status: value.status, failure: value.failure || null, httpStatus: value.httpStatus || null,
    ...(mode === 'search' ? { provider: value.provider, sources: value.sources.map(({ title, url }) => ({ title, url })) }
      : { url: args.url, excerptCharacters: value.excerpt?.length || 0, pageScripts: value.pageScripts ?? null }) });
} catch (error) {
  facts.failure = signal.aborted ? 'PUBLIC_READ_TIMEOUT' : 'PUBLIC_READ_FAILED';
  const code = error.code || error.cause?.code;
  if (['EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code)) facts.transportCode = code;
} finally { try { await tools?.close(); } finally { authStorage?.close(); await fs.rm(cwd, { recursive: true, force: true }); } }
console.log(JSON.stringify(facts));
