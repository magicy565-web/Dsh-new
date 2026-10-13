import { AgentPresetError } from './pi-preset.mjs';

const endpoint = 'https://api.search.brave.com/res/v1/web/search';
const fail = code => { throw new AgentPresetError(502, code, '真实检索暂不可用；未生成检索证据或业务完成结论。'); };

/**
 * One explicitly enabled, read-only Pi tool adapter. No agent loop or database.
 * The original Pi invocation reserves a maximum of two reads per admitted stage
 * and saves the source receipts in its durable submission and business run.
 * API contract: https://api-dashboard.search.brave.com/api-reference/web/search/get
 */
export function createBraveResearchAdapter({ environment = process.env, fetchImpl = fetch, clock = Date.now } = {}) {
  const enabled = environment.WS_AGENT_RESEARCH_ENABLED === '1';
  const key = environment.BRAVE_SEARCH_API_KEY || '';
  if (key && (typeof key !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(key))) throw new Error('Invalid host research credential format.');
  return Object.freeze({
    id: 'workspace-brave-web-search', revision: 1, replay: 'safe',
    configured: enabled && Boolean(key), capabilities: enabled && key ? ['web_search'] : [],
    async search({ query, limit = 5, requestId, taskId, stageKey, actor, signal }) {
      if (!enabled || !key) throw new AgentPresetError(409, 'AGENT_REQUIRED_CAPABILITY_MISSING', '未显式启用真实检索工具或未配置主机凭据。');
      if (!actor?.subject || !actor.workspaceId || !taskId || !stageKey || !requestId || typeof query !== 'string' ||
        !query.trim() || query.length > 600 || query.trim().split(/\s+/).length > 75 || /[\x00-\x1f\x7f]/.test(query) ||
        query.includes(key) || /Bearer\s+\S+/i.test(query) || !Number.isInteger(limit) || limit < 1 || limit > 5) {
        throw new AgentPresetError(400, 'AGENT_RESEARCH_QUERY_INVALID', '检索必须来自已授权的原 Pi 阶段，并使用有界公开问题。');
      }
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ q: query, count: String(limit), extra_snippets: 'true', text_decorations: 'false', result_filter: 'web', safesearch: 'moderate' }).toString();
      let response, value;
      try {
        response = await fetchImpl(url, { method: 'GET', redirect: 'error',
          headers: { Accept: 'application/json', 'X-Subscription-Token': key },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
        if (!response.ok) { await response.body?.cancel(); fail(response.status === 429 ? 'AGENT_RESEARCH_RATE_LIMITED' : 'AGENT_RESEARCH_SOURCE_UNAVAILABLE'); }
        if (Number(response.headers.get('content-length') || 0) > 256000) { await response.body?.cancel(); fail('AGENT_RESEARCH_RESPONSE_INVALID'); }
        const chunks = []; let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.length; if (bytes > 256000) fail('AGENT_RESEARCH_RESPONSE_INVALID');
          chunks.push(Buffer.from(chunk));
        }
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (error) {
        if (error instanceof AgentPresetError) throw error;
        fail('AGENT_RESEARCH_SOURCE_UNAVAILABLE');
      }
      if (value?.web?.results !== undefined && !Array.isArray(value.web.results)) fail('AGENT_RESEARCH_RESPONSE_INVALID');
      const sources = (value?.web?.results || []).slice(0, limit).map(row => {
        if (typeof row?.url !== 'string' || typeof row.title !== 'string' || typeof row.description !== 'string') fail('AGENT_RESEARCH_RESPONSE_INVALID');
        return { url: row.url, title: row.title.slice(0, 400),
          excerpt: [row.description, ...(Array.isArray(row.extra_snippets) ? row.extra_snippets.filter(item => typeof item === 'string') : [])].join('\n').slice(0, 6000), type: 'general' };
      });
      // Empty is a truthful empty result; the Pi evidence gate blocks completion.
      return { observedAt: new Date(clock()).toISOString(), sources };
    },
  });
}
