import { randomBytes } from 'node:crypto';
import { API_VERSION, API_PREFIX, REQUIRED_SCOPES, normalizeShop, safeScopes, verifyOauthCallback, reject } from './core.js';

const SHOP_QUERY = 'query DshShopIdentity { shop { id name myshopifyDomain } }';
const PRODUCTS_QUERY = 'query DshShopProducts { products(first: 10) { nodes { id title handle status } } }';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function assertCredentials(value) {
  if (typeof value?.access_token !== 'string' || value.access_token.length < 10 || value.access_token.length > 4096 ||
      typeof value?.refresh_token !== 'string' || value.refresh_token.length < 10 || value.refresh_token.length > 4096 ||
      !Number.isInteger(value.expires_in) || value.expires_in < 60 || value.expires_in > 86400 ||
      !Number.isInteger(value.refresh_token_expires_in) || value.refresh_token_expires_in < 60) {
    reject('TOKEN_RESPONSE_INVALID', 'Shopify did not return a valid expiring offline token pair.', 502);
  }
  return { accessToken: value.access_token, refreshToken: value.refresh_token,
    expiresIn: value.expires_in, refreshExpiresIn: value.refresh_token_expires_in,
    scopes: safeScopes(value.scope) };
}
function parsedResponse(response, json) {
  if (!response.ok || !json || typeof json !== 'object' || Array.isArray(json)) reject('SHOPIFY_UNAVAILABLE', 'Shopify returned an unusable response.', 502);
  return json;
}
export function createShopifyBindingService({ registry, store, clientId, clientSecret, redirectUri, enterpriseWorkspaceId, suggestedShopDomain, fetchImpl = fetch, clock = Date.now }) {
  const configured = !!(store && clientId && clientSecret && redirectUri && enterpriseWorkspaceId);
  const suggestedShop = suggestedShopDomain ? normalizeShop(suggestedShopDomain) : null;
  if (configured) {
    const uri = new URL(redirectUri);
    if (uri.protocol !== 'https:' || uri.username || uri.password || uri.hash || uri.search || uri.pathname !== API_PREFIX + '/oauth/callback') {
      throw new Error('Shopify OAuth redirect URI must be a fixed public HTTPS callback path.');
    }
  }
  const refreshPending = new Map();
  const requireConfigured = () => { if (!configured) reject('SETUP_REQUIRED', 'Set Shopify app ID, secret, a registered HTTPS callback, enterprise workspace ID and private AES-256 key on this Host.', 503); };
  function sessionScope(sessionId) {
    if (typeof sessionId !== 'string' || !ID.test(sessionId)) reject('SESSION_REQUIRED', 'Use a current DSH workspace conversation.', 403);
    const w = registry.list().find(row => row.sessionIds?.includes(sessionId));
    if (!w || !registry.get(w.id) || (enterpriseWorkspaceId && w.id !== enterpriseWorkspaceId)) reject('SESSION_REQUIRED', 'The session is not assigned to the pinned enterprise Workspace.', 403);
    return w.id;
  }
  async function jsonPost(url, form, headers) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { accept: 'application/json', ...headers }, body: form,
      });
    } catch { reject('SHOPIFY_UNAVAILABLE', 'Shopify authentication or API request failed.', 502); }
    let data;
    try {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 256 * 1024) reject('SHOPIFY_RESPONSE_TOO_LARGE', 'Shopify response is too large.', 502);
      data = JSON.parse(text);
    } catch { reject('SHOPIFY_UNAVAILABLE', 'Shopify returned invalid JSON.', 502); }
    return { response, data: parsedResponse(response, data) };
  }
  async function tokenRequest(shop, fields) {
    requireConfigured();
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...fields });
    const { data } = await jsonPost('https://' + shop + '/admin/oauth/access_token', body,
      { 'content-type': 'application/x-www-form-urlencoded' });
    return assertCredentials(data);
  }
  async function graphQL(shop, token, query) {
    const { response, data } = await jsonPost('https://' + shop + '/admin/api/' + API_VERSION + '/graphql.json', JSON.stringify({ query }),
      { 'content-type': 'application/json', 'x-shopify-access-token': token });
    if (response.headers?.get?.('x-shopify-api-version') !== API_VERSION || data.errors || !data.data) {
      reject('SHOPIFY_SCHEMA_UNAVAILABLE', 'Shopify Admin API version or response did not match the reviewed contract.', 502);
    }
    return data.data;
  }
  function validateIdentity(value, expectedShop) {
    const shop = value?.shop;
    if (!shop || !/^gid:\/\/shopify\/Shop\/\d+$/.test(shop.id ?? '') ||
        normalizeShop(shop.myshopifyDomain) !== expectedShop ||
        typeof shop.name !== 'string' || !shop.name.trim() || shop.name.length > 500) {
      reject('SHOP_ID_MISMATCH', 'Shopify identity did not match the authorized store.', 403);
    }
    return { shopGid: shop.id, shopName: shop.name };
  }
  function status(sessionId) {
    const workspaceId = sessionScope(sessionId);
    return { workspaceId, mode: 'shopify-admin-as-erp', commerceAuthority: 'Shopify',
      readOnly: true, apiVersion: API_VERSION, ...(suggestedShop ? { suggestedShop } : {}),
      ...(configured ? store.status(workspaceId) : { status: 'setup_required', adminUrl: null, shop: null }) };
  }
  function begin(sessionId, shopInput) {
    requireConfigured();
    const workspaceId = sessionScope(sessionId);
    const shop = normalizeShop(shopInput);
    const nonce = randomBytes(32).toString('hex');
    store.start(workspaceId, sessionId, shop, nonce, clock());
    const url = new URL('https://' + shop + '/admin/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('scope', REQUIRED_SCOPES.join(','));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', nonce);
    return { authorizeUrl: url.href, shop, accessRequested: [...REQUIRED_SCOPES], mode: 'merchant-oauth-expiring-offline' };
  }
  async function finish(params) {
    requireConfigured();
    const signed = verifyOauthCallback(params, clientSecret, clock());
    const pending = store.consume(signed.state, signed.shop, clock());
    if (sessionScope(pending.session_id) !== pending.workspace_id) reject('SCOPE_CHANGED', 'Enterprise workspace membership changed during Shopify authorization.', 403);
    const tokens = await tokenRequest(signed.shop, { code: signed.code, expiring: '1' });
    const data = await graphQL(signed.shop, tokens.accessToken, SHOP_QUERY);
    const identity = validateIdentity(data, signed.shop);
    if (sessionScope(pending.session_id) !== pending.workspace_id) reject('SCOPE_CHANGED', 'Enterprise membership was revoked during Shopify authorization.', 403);
    const result = store.bind({ workspaceId: pending.workspace_id, shop: signed.shop, ...identity, ...tokens, now: clock() });
    return { status: result.status, shop: result.shop, shopName: result.shopName, adminUrl: result.adminUrl };
  }
  async function currentToken(workspaceId) {
    const prior = store.tokens(workspaceId);
    if (prior.accessExpiresAt - clock() > 60_000) return prior;
    if (prior.refreshExpiresAt <= clock()) reject('REAUTHORIZE_REQUIRED', 'The Shopify refresh credential expired. The merchant must reauthorize.', 409);
    if (!refreshPending.has(workspaceId)) {
      const operation = (async () => {
        const fresh = await tokenRequest(prior.shop, { grant_type: 'refresh_token', refresh_token: prior.refreshToken });
        store.rotate(workspaceId, prior.revision, fresh, clock());
        return store.tokens(workspaceId);
      })();
      refreshPending.set(workspaceId, operation);
      operation.finally(() => { if (refreshPending.get(workspaceId) === operation) refreshPending.delete(workspaceId); }).catch(() => {});
    }
    return refreshPending.get(workspaceId);
  }
  async function read(sessionId, resource = 'shop') {
    requireConfigured();
    if (!['shop', 'products'].includes(resource)) reject('RESOURCE_DENIED', 'Only the Shopify shop identity and first 10 product summaries are enabled.', 403);
    const workspaceId = sessionScope(sessionId);
    const token = await currentToken(workspaceId);
    const data = await graphQL(token.shop, token.accessToken, resource === 'shop' ? SHOP_QUERY : PRODUCTS_QUERY);
    const current = store.status(workspaceId);
    if (sessionScope(sessionId) !== workspaceId || current.shop !== token.shop || current.status !== 'connected' || current.revision !== token.revision) {
      reject('SCOPE_CHANGED', 'Shopify session or binding changed while reading.', 409);
    }
    if (resource === 'shop') {
      const identity = validateIdentity(data, token.shop);
      if (identity.shopGid !== token.shopGid) reject('SHOP_ID_MISMATCH', 'Shopify identity changed after authorization.', 403);
      return { source: 'shopify-admin-graphql', asOf: new Date(clock()).toISOString(), shop: token.shop, adminUrl: 'https://' + token.shop + '/admin', shopName: identity.shopName, shopGid: identity.shopGid };
    }
    if (!Array.isArray(data?.products?.nodes) || data.products.nodes.length > 10) reject('SHOPIFY_SCHEMA_UNAVAILABLE', 'Shopify product summary shape changed.', 502);
    return { source: 'shopify-admin-graphql', asOf: new Date(clock()).toISOString(), shop: token.shop,
      products: data.products.nodes.map(row => ({ id: row.id, title: row.title, handle: row.handle, status: row.status })) };
  }
  function uninstall(shop, eventId) { requireConfigured(); return store.uninstall(normalizeShop(shop), eventId, clock()); }
  return { status, begin, finish, read, uninstall, configured, sessionScope };
}
