// Harness plugin: bridge the repository's reviewed DeepSeek runtime provider into
// ctx.llm. Disabled by default: configuration is explicit (enabled: true), the
// credential comes only from a named server environment variable, and neither the
// credential nor provider error text ever reaches health output or model errors.
import { createDeepSeekProvider } from '../../../server/provider.mjs';
import { ERROR, HarnessError } from '../../../packages/harness-contracts/src/index.mjs';
import { createRuntimeProvider } from './adapter.mjs';

const DEFAULT_ENV = 'DEEPSEEK_API_KEY';
// Capability declaration: this plugin may only read variables listed here (and in
// harness.plugin.json `env`). A composition cannot point apiKeyEnv at some other
// secret that the plugin was never allowed to see.
const DECLARED_ENV = Object.freeze([DEFAULT_ENV]);

export async function apply(ctx, config = {}) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('workspace-llm-bridge requires a kernel context.');
  if (!ctx.llm?.register) throw new HarnessError(ERROR.pluginMissingDependency, 'workspace-llm-bridge requires ctx.llm.');
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean')
    throw new HarnessError(ERROR.manifestInvalid, 'enabled must be a boolean.');
  if (config.model !== undefined && (typeof config.model !== 'string' || !config.model.trim()))
    throw new HarnessError(ERROR.manifestInvalid, 'model must be non-empty text.');
  if (config.apiKeyEnv !== undefined && (typeof config.apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]{1,127}$/u.test(config.apiKeyEnv)))
    throw new HarnessError(ERROR.manifestInvalid, 'apiKeyEnv must be an upper-case environment variable name.');
  if (config.maxTokens !== undefined && (!Number.isInteger(config.maxTokens) || config.maxTokens < 1 || config.maxTokens > 32_000))
    throw new HarnessError(ERROR.manifestInvalid, 'maxTokens must be an integer between 1 and 32000.');
  if (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 600_000))
    throw new HarnessError(ERROR.manifestInvalid, 'timeoutMs must be an integer between 1000 and 600000.');

  const apiKeyEnv = config.apiKeyEnv ?? DEFAULT_ENV;
  if (!DECLARED_ENV.includes(apiKeyEnv))
    throw new HarnessError(ERROR.manifestInvalid, `apiKeyEnv must be one of the declared environment variables (${DECLARED_ENV.join(', ')}).`);
  const model = config.model ?? 'deepseek-flash';
  const providerId = config.providerId ?? 'workspace-deepseek';

  const report = detail => {
    if (!ctx.health?.register) return;
    ctx.health.register('llm-bridge', () => ({ status: 'ok', detail }));
  };

  if (config.enabled !== true) {
    report({ configured: false, reason: 'disabled in composition', provider: null });
    return async () => {};
  }
  const credential = process.env[apiKeyEnv];
  const apiKey = typeof credential === 'string' ? credential.trim() : '';
  if (!apiKey) {
    report({ configured: false, reason: 'provider credential is not set in the server environment', env: apiKeyEnv, provider: null });
    return async () => {};
  }

  const runtime = createDeepSeekProvider({ apiKey, timeoutMs: config.timeoutMs ?? 60_000 });
  const provider = createRuntimeProvider({
    id: providerId,
    model,
    label: config.label,
    maxTokens: config.maxTokens,
    complete: request => runtime.complete(request),
  });
  const unregister = ctx.llm.register(provider);
  report({ configured: true, provider: provider.id, model, env: apiKeyEnv });
  let disposed = false;
  return async () => {
    if (disposed) return;
    disposed = true;
    try { unregister(); } catch { /* the llm seam owns the registry */ }
  };
}

export default { apply };
