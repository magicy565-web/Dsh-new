// Pure host configuration preparation. Never reads process.env, files, accounts
// or network; the existing CLI passes its environment explicitly.
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODEL_IDS = Object.freeze(['deepseek-flash', 'deepseek-v4-pro']);

function setting(environment, name) {
  const value = environment[name];
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new TypeError('Pi provider settings must be strings.');
  return value;
}

export function loadPiProviderConfig(environment = {}) {
  const selected = setting(environment, 'PI_PROVIDER') || 'fastaitoken';
  if (selected === 'deepseek') {
    const model = setting(environment, 'PI_MODEL');
    if (!model) throw new TypeError('DeepSeek requires an explicit PI_MODEL; no model is selected automatically.');
    if (!DEEPSEEK_MODEL_IDS.includes(model)) throw new TypeError('Select a currently supported DeepSeek PI_MODEL: deepseek-flash or deepseek-v4-pro.');
    const requestedBase = setting(environment, 'PI_BASE_URL');
    if (requestedBase && ![DEEPSEEK_BASE_URL, DEEPSEEK_BASE_URL + '/'].includes(requestedBase))
      throw new TypeError('DeepSeek uses the pinned official HTTPS API origin; custom destinations are not allowed.');
    return { apiKey: setting(environment, 'DEEPSEEK_API_KEY'), model, baseUrl: DEEPSEEK_BASE_URL, providerId: 'workspace-deepseek' };
  }
  if (selected !== 'fastaitoken') throw new TypeError('PI_PROVIDER must be fastaitoken or deepseek.');
  const baseUrl = setting(environment, 'PI_BASE_URL') || 'https://www.fastaitoken.com/v1';
  let hostname;
  try { hostname = new URL(baseUrl).hostname; } catch { throw new TypeError('PI_BASE_URL must be a valid server-configured URL.'); }
  if (hostname === 'api.deepseek.com') throw new TypeError('The DeepSeek API requires explicit PI_PROVIDER=deepseek and its separate server key.');
  return { apiKey: setting(environment, 'FASTAITOKEN_API_KEY'),
    model: setting(environment, 'PI_MODEL') || setting(environment, 'FASTAITOKEN_MODEL') || 'gpt-6-sol',
    baseUrl, providerId: 'workspace-fastaitoken' };
}
