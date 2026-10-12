import { createHmac } from 'node:crypto';

export const WECHAT_CODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session';
export class WechatLoginError extends Error {
  constructor(status, code, message) { super(message); this.name = 'WechatLoginError'; this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new WechatLoginError(status, code, message); };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._@:+|/-]{1,128}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateWechatLoginCode(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{8,512}$/.test(code)) fail(400, 'WECHAT_CODE_INVALID', 'Provide a fresh wx.login code without identity or permission fields.');
  return code;
}

/** Official HTTPS API adapter. Server credentials and code are never logged,
 * placed in errors or returned as public data. No retry/fallback/redirect. */
export function createWechatCodeExchange({ appId = '', appSecret = '', fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new TypeError('WeChat exchange timeout must be bounded.');
  const configured = Boolean(appId && appSecret);
  if (configured && (!/^wx[a-f0-9]{16}$/i.test(appId) || !/^[A-Za-z0-9_-]{16,256}$/.test(appSecret))) fail(503, 'WECHAT_SETUP_REQUIRED', 'The server WeChat credential configuration is invalid.');
  return Object.freeze({ configured, appId,
    async exchange(code, { signal } = {}) {
      if (!configured) fail(503, 'WECHAT_SETUP_REQUIRED', 'WeChat code exchange is not configured on this server.');
      validateWechatLoginCode(code);
      const url = new URL(WECHAT_CODE2SESSION_URL);
      url.searchParams.set('appid', appId); url.searchParams.set('secret', appSecret);
      url.searchParams.set('js_code', code); url.searchParams.set('grant_type', 'authorization_code');
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try { response = await fetchImpl(url, { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' }, signal: combined }); }
      catch {
        if (signal?.aborted) fail(503, 'WECHAT_EXCHANGE_STOPPED', 'The server stopped this login exchange. Obtain a fresh login code.');
        if (timeout.aborted) fail(504, 'WECHAT_EXCHANGE_UNCERTAIN', 'WeChat exchange timed out. Obtain a fresh code; this code will not be retried.');
        fail(502, 'WECHAT_EXCHANGE_UNCERTAIN', 'WeChat exchange could not be confirmed. Obtain a fresh code; no automatic retry was made.');
      }
      if (!response.ok || response.redirected || response.url && new URL(response.url).origin !== 'https://api.weixin.qq.com') {
        await response.body?.cancel().catch(() => {});
        fail(502, 'WECHAT_EXCHANGE_FAILED', 'WeChat did not return an acceptable login response.');
      }
      let data;
      try {
        const reader = response.body?.getReader(); if (!reader) throw Error('Missing response');
        const chunks = []; let length = 0;
        while (true) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > 16384) { await reader.cancel(); throw Error('Oversized response'); } chunks.push(next.value); }
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch { fail(502, 'WECHAT_RESPONSE_INVALID', 'WeChat returned an invalid bounded login response.'); }
      if (!record(data)) fail(502, 'WECHAT_RESPONSE_INVALID', 'WeChat returned an invalid login response.');
      if (data.errcode !== undefined && data.errcode !== 0) {
        if (data.errcode === 40029) fail(401, 'WECHAT_CODE_INVALID', 'The login code is invalid or expired. Obtain a fresh code.');
        if (data.errcode === 40163) fail(409, 'WECHAT_CODE_USED', 'The login code was already used. Obtain a fresh code.');
        fail(502, 'WECHAT_EXCHANGE_REJECTED', 'WeChat rejected this login exchange.');
      }
      if (typeof data.openid !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(data.openid) || typeof data.session_key !== 'string' || data.session_key.length > 256 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.session_key))
        fail(502, 'WECHAT_RESPONSE_INVALID', 'WeChat did not return a valid server-only identity and session key.');
      const key = Buffer.from(data.session_key, 'base64');
      if (key.length < 16 || key.toString('base64') !== data.session_key) fail(502, 'WECHAT_RESPONSE_INVALID', 'WeChat returned an invalid session key.');
      if (data.unionid !== undefined && (typeof data.unionid !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(data.unionid))) fail(502, 'WECHAT_RESPONSE_INVALID', 'WeChat returned an invalid optional identity.');
      // Internal only. The broker derives a reviewed digest and discards these
      // values; never serialize this object as an HTTP/login response.
      return { appId, openid: data.openid, sessionKey: data.session_key, ...(data.unionid ? { unionid: data.unionid } : {}) };
    },
  });
}

export function wechatIdentityDigest({ appId, appSecret, openid }) {
  if (!appId || !appSecret || typeof openid !== 'string') fail(503, 'WECHAT_SETUP_REQUIRED', 'Server-owned identity digest inputs are required.');
  return createHmac('sha256', appSecret).update(`workspace.wechat.openid.v1\0${appId}\0${openid}`).digest('hex');
}
export function wechatCodeDigest({ appId, appSecret, code }) {
  validateWechatLoginCode(code);
  if (!appId || !appSecret) fail(503, 'WECHAT_SETUP_REQUIRED', 'Server WeChat credentials are required.');
  return createHmac('sha256', appSecret).update(`workspace.wechat.code.v1\0${appId}\0${code}`).digest('hex');
}

/** Reviewed host configuration only; no automatic account/member registration,
 * unionid matching, role field or client-provided subject/owner. */
export function validateWechatBindingProfile(profile, { appId, workspaceId, members, now = Date.now() }) {
  const invalid = () => fail(503, 'WECHAT_BINDING_REVIEW_REQUIRED', 'An exact reviewed server WeChat/member binding is required.');
  if (!record(profile) || Object.keys(profile).some(key => !['version', 'appId', 'workspaceId', 'review', 'bindings'].includes(key)) || profile.version !== 1 || profile.appId !== appId || profile.workspaceId !== workspaceId || !(members instanceof Map)) invalid();
  const review = profile.review;
  if (!record(review) || Object.keys(review).some(key => !['id', 'reviewedBy', 'reviewedAt', 'expiresAt'].includes(key)) || !identifier(review.id) || members.get(review.reviewedBy) !== 'admin') invalid();
  const reviewedAt = Date.parse(review.reviewedAt), expiresAt = Date.parse(review.expiresAt);
  if (typeof review.reviewedAt !== 'string' || typeof review.expiresAt !== 'string' || !Number.isFinite(reviewedAt) || !Number.isFinite(expiresAt) || reviewedAt > now || expiresAt <= now || expiresAt <= reviewedAt) invalid();
  if (!Array.isArray(profile.bindings) || !profile.bindings.length || profile.bindings.length > 500) invalid();
  const seen = new Set(), bindings = new Map();
  for (const row of profile.bindings) {
    if (!record(row) || Object.keys(row).some(key => !['openidDigest', 'subject'].includes(key)) || !digest(row.openidDigest) || !identifier(row.subject) || !members.has(row.subject) || seen.has(row.openidDigest)) invalid();
    seen.add(row.openidDigest); bindings.set(row.openidDigest, row.subject);
  }
  return Object.freeze({ appId, workspaceId, reviewId: review.id, reviewedBy: review.reviewedBy, expiresAt, bindings });
}
