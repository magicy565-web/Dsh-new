import { loadPiProviderConfig } from './pi-provider-config.mjs';
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
export function createWorkspaceOmpBusinessOptions({ environment = {}, baseURL } = {}) {
  const configuration = workspaceOmpConfiguration(environment), paths = workspaceOmpPaths(environment);
  const model = { provider: configuration.providerId, id: configuration.model, api: 'openai-completions', baseUrl: configuration.baseUrl };
  return { recipient: { kind: 'pi-coding-agent', provider: model.provider, model: model.id, destination: model.baseUrl },
    engineAdapter: createWorkspaceOmpEngineAdapter({ paths, configuration, infrastructure: environment }),
    resolveBinding: async () => {
      if (!environment.WS_AGENT_TOKEN || !workspaceOmpConfigured(configuration)) return null;
      return { client: createWorkspaceClient({ baseURL: environment.WS_AGENT_URL || baseURL, token: environment.WS_AGENT_TOKEN }), model };
    },
  };
}
