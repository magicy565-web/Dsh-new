import { supplierHash } from '../supplier-profile.mjs';

export const WECHAT_SUBSCRIBE_SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const result = (status, code, extra = {}) => ({ status, code, automaticRetry: false,
  reconciliationRequired: status === 'unknown', userRead: 'unknown', businessAcceptance: 'not_recorded', ...extra });

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(Error('Stopped'));
  return new Promise((resolve, reject) => {
    const stop = () => reject(Error('Stopped'));
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}
async function boundedJson(response, signal) {
  const reader = response.body?.getReader(); if (!reader) throw Error('Missing response');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const next = await abortable(reader.read(), signal); if (next.done) break;
      size += next.value.byteLength; if (size > 16384) throw Error('Oversized response');
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { reader.cancel().catch(() => {}); throw error; }
}

/** Conservative classifications. Never persist provider errmsg (it can contain identity/data). */
export function classifyWechatSubscriptionResponse(data, evidenceKind = 'wechat_api_response') {
  if (!object(data) || !Number.isSafeInteger(data.errcode)) return result('unknown', 'WECHAT_RESPONSE_UNCERTAIN', { evidenceKind });
  if (data.errcode === 0) return data.errmsg === 'ok'
    ? result('platform_accepted', 'WECHAT_PLATFORM_ACCEPTED', { evidenceKind, providerCode: 0 })
    : result('unknown', 'WECHAT_RESPONSE_UNCERTAIN', { evidenceKind });
  if (data.errcode < 0) return result('unknown', 'WECHAT_PROVIDER_UNCERTAIN', { evidenceKind, providerCode: data.errcode });
  const classification = ({ 40003: 'recipient_invalid', 40037: 'template_invalid', 43101: 'subscription_refused',
    47003: 'template_data_invalid', 40001: 'token_invalid', 40014: 'token_invalid', 42001: 'token_expired',
    45009: 'quota_exceeded' })[data.errcode] || 'provider_rejected_unclassified';
  return result('failed', 'WECHAT_PLATFORM_REJECTED', { evidenceKind, providerCode: data.errcode, classification,
    subscriptionRevoked: data.errcode === 43101 });
}

/** Server-only, once-only template adapter. No env/secret loader, token minting, retries or fallback. */
export function createWechatSubscriptionAdapter({ enabled = false, appId = '', templateId = '',
  fields = null, page = null, miniprogramState = 'formal', officialContractReviewed = false,
  mode = 'production', getAccessToken = null, fetchImpl, timeoutMs = 5000, clock = Date.now } = {}) {
  if (!['production', 'fixture'].includes(mode) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    throw new TypeError('Use a bounded WeChat transport mode/timeout.');
  if (mode === 'fixture' && typeof fetchImpl !== 'function') throw new TypeError('Fixture mode requires a local injected transport.');
  // Pin the reviewed field mapping; later caller mutation cannot change the wire payload under this fingerprint.
  fields = object(fields) ? Object.freeze({ ...fields }) : fields;
  const transport = fetchImpl || fetch;
  const evidenceKind = mode === 'fixture' ? 'local_fixture' : 'wechat_api_response';
  const validFields = object(fields) && Object.keys(fields).length >= 1 && Object.keys(fields).length <= 3
    && Object.entries(fields).every(([key, value]) => /^(thing|phrase|date)[1-9]\d?$/.test(key)
      && ['title', 'status', 'endDate'].includes(value) && (key.startsWith('date') === (value === 'endDate'))
      && (!key.startsWith('phrase') || value === 'status'));
  const validPage = page === null || typeof page === 'string' && /^[A-Za-z0-9_/-]{1,256}$/.test(page)
    && !page.startsWith('/') && !page.includes('..') && !page.includes('//');
  const configured = /^wx[a-f0-9]{16}$/i.test(appId) && opaque(templateId) && validFields && validPage
    && ['formal', 'trial', 'developer'].includes(miniprogramState) && typeof getAccessToken === 'function'
    && typeof transport === 'function' && (mode === 'fixture' || officialContractReviewed === true);
  const config = { channel: 'wechat_subscription', appId, templateId, fields, page, miniprogramState, mode };
  const fingerprint = supplierHash(config);
  const status = () => ({ channel: config.channel, configured, enabled: enabled === true,
    status: enabled === true && configured ? 'configured' : 'blocked',
    code: enabled === true && configured ? null : 'NOTIFICATION_UNCONFIGURED', evidenceKind });
  const validateRecipient = recipient => object(recipient) && recipient.verified === true && recipient.revoked === false
    && recipient.appId === appId && opaque(recipient.openid);
  const validateSubscription = (subscription, { recipient } = {}) => object(subscription) && validateRecipient(recipient)
    && subscription.kind === 'one_time' && subscription.appId === appId && subscription.templateId === templateId
    && subscription.decision === 'accept' && subscription.source === 'wx.requestSubscribeMessage'
    && subscription.provenance === 'authenticated_wechat_client'
    && subscription.evidenceKind === (mode === 'fixture' ? 'local_fixture' : 'wechat_client_subscription');
  return Object.freeze({ channel: config.channel, fingerprint, status, validateRecipient, validateSubscription,
    recipientFingerprint: recipient => supplierHash({ appId: recipient.appId, openid: recipient.openid }),
    async send({ recipient, subscription, summary, beforeSend, signal } = {}) {
      if (status().status !== 'configured') return result('blocked', 'NOTIFICATION_UNCONFIGURED', { evidenceKind });
      // The coordinator checks durable evidence. The transport independently binds its wire identity.
      if (!validateSubscription(subscription, { recipient }))
        return result('blocked', 'WECHAT_SUBSCRIPTION_REQUIRED', { evidenceKind });
      if (!object(summary) || typeof summary.endAt !== 'string' || !Number.isFinite(Date.parse(summary.endAt))
        || typeof summary.provisional !== 'boolean' || typeof beforeSend !== 'function')
        return result('blocked', 'NOTIFICATION_PAYLOAD_INVALID', { evidenceKind });
      const values = { title: '七天经营总结', status: summary.provisional ? '待核实' : '已完成',
        endDate: new Date(summary.endAt).toISOString().slice(0, 10) };
      const data = Object.fromEntries(Object.entries(fields).map(([key, name]) => [key, { value: values[name] }]));
      // No metric amounts, supplier/customer data, full summary, arbitrary page/query or raw IDs are sent.
      const payload = { touser: recipient.openid, template_id: templateId, miniprogram_state: miniprogramState,
        lang: 'zh_CN', data, ...(page === null ? {} : { page }) };
      const timeout = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      if (combined.aborted) return result('cancelled', 'NOTIFICATION_STOPPED_BEFORE_SEND', { evidenceKind });
      let token;
      try { token = await abortable(getAccessToken({ appId, signal: combined }), combined); }
      catch { return result(combined.aborted ? 'cancelled' : 'blocked', 'WECHAT_TOKEN_UNAVAILABLE', { evidenceKind }); }
      if (!object(token) || token.appId !== appId || typeof token.accessToken !== 'string'
        || !/^[A-Za-z0-9_-]{8,2048}$/.test(token.accessToken) || !Number.isFinite(token.expiresAt)
        || token.expiresAt <= clock() + timeoutMs)
        return result('blocked', 'WECHAT_TOKEN_UNAVAILABLE', { evidenceKind });
      const url = new URL(WECHAT_SUBSCRIBE_SEND_URL); url.searchParams.set('access_token', token.accessToken);
      // Must durably reserve the original grant and record the may-submit boundary BEFORE any provider I/O.
      // Persistence errors propagate: no network call can occur after a failed beforeSend.
      await beforeSend();
      if (combined.aborted) return result('cancelled', 'NOTIFICATION_STOPPED_BEFORE_SEND', { evidenceKind });
      let response;
      try { response = await abortable(transport(url, { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload),
        signal: combined }), combined); }
      catch { return result('unknown', 'WECHAT_SEND_UNCERTAIN', { evidenceKind }); }
      if (!response.ok || response.redirected || response.url && response.url !== url.href) {
        response.body?.cancel().catch(() => {});
        return result('unknown', 'WECHAT_HTTP_UNCERTAIN', { evidenceKind });
      }
      try { return classifyWechatSubscriptionResponse(await boundedJson(response, combined), evidenceKind); }
      catch { return result('unknown', 'WECHAT_RESPONSE_UNCERTAIN', { evidenceKind }); }
    },
  });
}
