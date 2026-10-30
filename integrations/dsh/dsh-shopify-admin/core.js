import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const API_VERSION = '2026-10';
export const API_PREFIX = '/shopify-admin-binding';
export const REQUIRED_SCOPES = Object.freeze(['read_products']);
export const STATE_LIFETIME_MS = 10 * 60_000;

export class ShopifyBindingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ShopifyBindingError';
    this.code = code;
    this.status = status;
  }
}
export const reject = (code, message, status = 400) => { throw new ShopifyBindingError(code, message, status); };

export function normalizeShop(value) {
  if (typeof value !== 'string' || value.trim() !== value) reject('SHOP_INVALID', 'Use the canonical shopname.myshopify.com domain.');
  const shop = value.toLowerCase();
  if (shop.length > 80 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shop)) {
    reject('SHOP_INVALID', 'Only a canonical *.myshopify.com shop domain is allowed.');
  }
  return shop;
}
export function adminUrl(shop) { return 'https://' + normalizeShop(shop) + '/admin'; }
export function nonceHash(nonce) { return createHash('sha256').update(nonce, 'utf8').digest('hex'); }
export function safeEqual(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
export function verifyOauthCallback(params, secret, now = Date.now()) {
  if (!(params instanceof URLSearchParams)) reject('CALLBACK_INVALID', 'Invalid Shopify callback.', 400);
  const fields = new Map();
  for (const [key, value] of params) {
    if (fields.has(key)) reject('CALLBACK_DUPLICATE', 'Duplicate OAuth parameter.', 400);
    fields.set(key, value);
  }
  const hmac = fields.get('hmac');
  const state = fields.get('state');
  const code = fields.get('code');
  const timestamp = fields.get('timestamp');
  if (!/^[a-f0-9]{64}$/i.test(hmac ?? '') || !/^[a-f0-9]{64}$/.test(state ?? '') ||
      !code || code.length > 2048 || !/^\d{10}$/.test(timestamp ?? '')) reject('CALLBACK_INVALID', 'Required signed OAuth fields are missing.', 400);
  const ageMs = now - Number(timestamp) * 1000;
  if (Math.abs(ageMs) > STATE_LIFETIME_MS) reject('CALLBACK_EXPIRED', 'The Shopify authorization expired.', 403);
  fields.delete('hmac');
  const message = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => k + '=' + v).join('&');
  const expected = createHmac('sha256', secret).update(message).digest();
  if (!safeEqual(Buffer.from(hmac, 'hex'), expected)) reject('CALLBACK_SIGNATURE', 'Shopify OAuth signature was not verified.', 403);
  return { shop: normalizeShop(fields.get('shop')), state, code };
}
export function verifyUninstall(body, headerSignature, secret) {
  if (!Buffer.isBuffer(body) || body.length > 256 * 1024 || !/^[A-Za-z0-9+/]{43}=$/.test(headerSignature ?? '')) {
    reject('WEBHOOK_INVALID', 'Invalid webhook payload or signature.', 401);
  }
  const digest = createHmac('sha256', secret).update(body).digest();
  if (!safeEqual(Buffer.from(headerSignature, 'base64'), digest)) reject('WEBHOOK_SIGNATURE', 'Webhook signature mismatch.', 401);
  let data;
  try { data = JSON.parse(body.toString('utf8')); } catch { reject('WEBHOOK_INVALID', 'Invalid signed Shopify webhook JSON.', 400); }
  if (typeof data !== 'object' || !data || Array.isArray(data)) reject('WEBHOOK_INVALID', 'Expected a signed shop object.');
  return normalizeShop(data.myshopify_domain);
}
export function safeScopes(value) {
  if (typeof value !== 'string') reject('SCOPE_MISSING', 'Shopify did not return an approved scope list.', 403);
  const scopes = [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))].sort();
  if (!REQUIRED_SCOPES.every(scope => scopes.includes(scope))) reject('SCOPE_MISSING', 'Required read_products permission was not approved.', 403);
  return scopes;
}
