import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

// Shared official SDK profile. Credentials are a host-owned in-memory resolver;
// this helper never reads a file, environment, account or credential store.
export function createWorkspacePiModelProfile({ apiKey = '', model, baseUrl, providerId, api = openAICompletionsApi() }) {
  if (!/^[a-zA-Z0-9_.:/-]{1,160}$/.test(model || '')) throw new TypeError('Pi model must be a bounded server-configured model ID.');
  let endpoint;
  try {
    if (typeof baseUrl !== 'string' || !baseUrl || baseUrl.length > 2048 || /\s/.test(baseUrl)) throw new Error();
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error();
    endpoint = url.href.replace(/\/+$/, '');
  } catch { throw new TypeError('Pi baseUrl must be a server-configured HTTPS URL without credentials, query or fragment.'); }
  const deepseek = providerId === 'workspace-deepseek';
  if (deepseek && endpoint !== 'https://api.deepseek.com') throw new TypeError('The DeepSeek profile requires its pinned official HTTPS API origin.');
  return createProvider({ id: providerId, name: 'Workspace server-configured Pi model', baseUrl: endpoint,
    auth: { apiKey: { name: deepseek ? 'Host-managed DeepSeek key' : 'Host-managed FastAIToken key', resolve: async () => apiKey.trim() ? { auth: { apiKey } } : undefined } },
    // SDK cost placeholders are not prices or a monetary hard cap.
    models: [{ id: model, name: model, api: 'openai-completions', provider: providerId, baseUrl: endpoint, reasoning: deepseek,
      input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1600,
      ...(deepseek ? { compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false,
        maxTokensField: 'max_tokens', thinkingFormat: 'deepseek', supportsLongCacheRetention: false } } : {}) }],
    api });
}
