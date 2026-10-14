import { loadPiProviderConfig } from './pi-provider-config.mjs';
import { existsSync } from 'node:fs';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { createWorkspaceOmpEngineAdapter, workspaceOmpPaths } from './workspace-omp-bridge.mjs';

// Host configuration only: never scans credentials/accounts or discovers a
// provider. Unknown prices/balance are not treated as zero-cost or free usage.
export function workspaceOmpConfiguration(environment = {}) {
  const configuration = loadPiProviderConfig(environment);
  let cost = null;
  if (environment.WORKSPACE_OMP_PROVIDER_COST_JSON) {
    try { cost = JSON.parse(environment.WORKSPACE_OMP_PROVIDER_COST_JSON); } catch { throw new Error('The trusted host OMP price configuration is invalid.'); }
    if (!cost || Object.keys(cost).some(key => !['input', 'output', 'cacheRead', 'cacheWrite'].includes(key))
      || ['input', 'output', 'cacheRead', 'cacheWrite'].some(key => !Number.isFinite(cost[key]) || cost[key] < 0)) throw new Error('Use reviewed per-million-token OMP provider prices for every cost field.');
  }
  return { ...configuration, cost, remainingBudgetVerified: environment.WORKSPACE_OMP_LIVE_BUDGET_VERIFIED === '1' };
}
export function workspaceOmpConfigured(configuration) {
  return Boolean(configuration.apiKey && configuration.cost && configuration.remainingBudgetVerified);
}
export function workspaceOmpPublicToolConfiguration(environment = {}) {
  const searchProvider = environment.WORKSPACE_OMP_PUBLIC_SEARCH_PROVIDER || 'duckduckgo';
  if (!['duckduckgo', 'startpage', 'disabled'].includes(searchProvider)) throw new Error('Use one explicitly reviewed keyless public search provider.');
  let files = [];
  if (environment.WORKSPACE_OMP_PUBLIC_FILES_JSON) {
    try { files = JSON.parse(environment.WORKSPACE_OMP_PUBLIC_FILES_JSON); } catch { throw new Error('Public material selection must be exact JSON with IDs, paths and SHA256 pins.'); }
    if (!Array.isArray(files) || files.length > 8 || files.length && !environment.WORKSPACE_OMP_PUBLIC_DOCUMENT_ROOT) throw new Error('Public material selection requires a separate explicit public document root.');
  }
  const browserExecutable = environment.WORKSPACE_OMP_BROWSER_BIN === 'disabled' ? null
    : environment.WORKSPACE_OMP_BROWSER_BIN || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : null);
  return { searchProvider, browserExecutable, publicDocumentRoot: environment.WORKSPACE_OMP_PUBLIC_DOCUMENT_ROOT, files };
}
export function createWorkspaceOmpBusinessOptions({ environment = {}, baseURL } = {}) {
  const configuration = workspaceOmpConfiguration(environment), paths = workspaceOmpPaths(environment);
  const model = { provider: configuration.providerId, id: configuration.model, api: 'openai-completions', baseUrl: configuration.baseUrl };
  return { recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, publicTools: workspaceOmpPublicToolConfiguration(environment), infrastructure: environment }),
    resolveBinding: async () => {
      if (!environment.WS_AGENT_TOKEN || !workspaceOmpConfigured(configuration)) return null;
      return { client: createWorkspaceClient({ baseURL: environment.WS_AGENT_URL || baseURL, token: environment.WS_AGENT_TOKEN }), model };
    },
  };
}
