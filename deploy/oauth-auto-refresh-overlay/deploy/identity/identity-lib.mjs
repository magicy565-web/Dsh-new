import { randomBytes, scrypt, timingSafeEqual, createHmac, createPrivateKey } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { openPrivateFile } from '../../server/store.mjs';
import { assertOwnerControlledFile, createPrivateDirectory, writePrivateNewFile } from '../../server/file-permissions.mjs';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const derive = promisify(scrypt);
export const randomToken = () => randomBytes(32).toString('base64url');
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function passwordRecord(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 256) throw Error('Use a password of at least 12 characters and at most 256 bytes.');
  const salt = randomBytes(16);
  return { salt: salt.toString('base64url'), hash: (await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('base64url') };
}
export async function checkPassword(password, record) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 256) return false;
  const actual = await derive(password, Buffer.from(record.salt, 'base64url'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(record.hash, 'base64url');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
const exactOrigin = value => { const u = new URL(value); if (u.origin !== value || u.protocol !== 'https:' || u.username || u.password || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw Error('An exact public HTTPS origin is required.'); return u; };
export function validateIdentity(config) {
  exactOrigin(config.issuer); exactOrigin(config.publicOrigin);
  const resource = new URL(config.resource);
  if (resource.protocol !== 'https:' || resource.username || resource.password || resource.href !== config.resource || resource.pathname !== '/mcp/dot' || resource.search || resource.hash) throw Error('An exact HTTPS dot resource is required.');
  if (!/^[A-Za-z0-9._@:+|/-]{1,128}$/.test(config.workspaceId) || !/^[A-Za-z0-9._@:+|/-]{1,128}$/.test(config.account?.subject) || !/^[A-Za-z0-9._@-]{1,64}$/.test(config.account?.username)) throw Error('Explicit workspace and account identities are required.');
  if (Buffer.from(config.account.password?.salt || '', 'base64url').length !== 16 || Buffer.from(config.account.password?.hash || '', 'base64url').length !== 64) throw Error('An operator-enrolled password is required.');
  if (!Array.isArray(config.cookieKeys) || config.cookieKeys.length !== 2 || config.cookieKeys.some(k => Buffer.from(k, 'base64url').length !== 32)) throw Error('Persistent cookie signing keys are required.');
  const key = createPrivateKey({ key: config.jwk, format: 'jwk' });
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072 || config.jwk.alg !== 'RS256' || !config.jwk.kid) throw Error('A private RSA-3072 signing key is required.');
  if (!Number.isInteger(config.identityPort) || !Number.isInteger(config.gatewayPort) || !Number.isInteger(config.backendPort) || [config.identityPort, config.gatewayPort, config.backendPort].some(p => p < 1024 || p > 65535) || new Set([config.identityPort, config.gatewayPort, config.backendPort]).size !== 3) throw Error('Three distinct unprivileged loopback ports are required.');
  if (!path.isAbsolute(config.databaseFile) || createPrivateKey(config.ingressPrivateKey).asymmetricKeyType !== 'ed25519') throw Error('Explicit private storage and ingress signing key are required.');
  if (!Array.isArray(config.dotRedirectURIs) || !config.dotRedirectURIs.length || config.dotRedirectURIs.length > 5 || config.dotRedirectURIs.some(x => x !== 'https://chatgpt.com/connector_platform_oauth_redirect' && !/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/.test(x))) throw Error('Only reviewed exact ChatGPT callback URLs are accepted.');
  return config;
}
export async function loadIdentity(filename) {
  if (!filename || !path.isAbsolute(filename)) throw Error('Set WORKSPACE_IDENTITY_FILE to a private absolute path.');
  const handle = await openPrivateFile(filename);
  try { await assertOwnerControlledFile(handle); if ((await handle.stat()).size > 64000) throw Error('Identity configuration is too large.'); return validateIdentity(JSON.parse(await handle.readFile('utf8'))); }
  finally { await handle.close(); }
}
export async function persistentAdapter(filename) {
  await createPrivateDirectory(path.dirname(filename));
  const directory = await fs.lstat(path.dirname(filename));
  if (!directory.isDirectory() || directory.isSymbolicLink() || process.platform !== 'win32' && directory.mode & 0o077) throw Error('Identity storage directory must be private.');
  try { const handle = await openPrivateFile(filename); try { await assertOwnerControlledFile(handle); } finally { await handle.close(); } }
  catch (error) { if (error.code !== 'ENOENT') throw error; await writePrivateNewFile(filename, ''); }
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS oidc (model TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, expires INTEGER, grant_id TEXT, uid TEXT, user_code TEXT, consumed INTEGER, PRIMARY KEY(model,id)); CREATE INDEX IF NOT EXISTS grant_lookup ON oidc(grant_id); CREATE INDEX IF NOT EXISTS uid_lookup ON oidc(model,uid);');
  const clock = () => Math.floor(Date.now() / 1000);
  const clean = () => db.prepare('DELETE FROM oidc WHERE expires IS NOT NULL AND expires<=?').run(clock());
  const unpack = row => row ? { ...JSON.parse(row.payload), ...(row.consumed ? { consumed: row.consumed } : {}) } : undefined;
  class Adapter {
    constructor(model) { this.model = model; }
    async upsert(id, payload, expiresIn) {
      if (JSON.stringify(payload).length > 64000) throw Error('Identity record exceeds limit.');
      clean();
      if (db.prepare('SELECT COUNT(*) AS n FROM oidc').get().n >= 10000 && !db.prepare('SELECT 1 FROM oidc WHERE model=? AND id=?').get(this.model, id)) throw Error('Identity storage limit reached.');
      db.prepare('INSERT INTO oidc(model,id,payload,expires,grant_id,uid,user_code,consumed) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(model,id) DO UPDATE SET payload=excluded.payload,expires=excluded.expires,grant_id=excluded.grant_id,uid=excluded.uid,user_code=excluded.user_code,consumed=COALESCE(oidc.consumed,excluded.consumed)').run(this.model, id, JSON.stringify(payload), Number.isFinite(expiresIn) ? clock() + expiresIn : null, payload.grantId || null, payload.uid || null, payload.userCode || null, payload.consumed || null);
    }
    async find(id) { clean(); return unpack(db.prepare('SELECT * FROM oidc WHERE model=? AND id=?').get(this.model, id)); }
    async findByUid(uid) { clean(); return unpack(db.prepare('SELECT * FROM oidc WHERE model=? AND uid=?').get(this.model, uid)); }
    async findByUserCode(code) { clean(); return unpack(db.prepare('SELECT * FROM oidc WHERE model=? AND user_code=?').get(this.model, code)); }
    async destroy(id) { db.prepare('DELETE FROM oidc WHERE model=? AND id=?').run(this.model, id); }
    async consume(id) { if (db.prepare('UPDATE oidc SET consumed=? WHERE model=? AND id=? AND consumed IS NULL AND (expires IS NULL OR expires>?)').run(clock(), this.model, id, clock()).changes !== 1) throw Error('Authorization record already consumed or expired.'); }
    async revokeByGrantId(grantId) { db.prepare('DELETE FROM oidc WHERE grant_id=? OR (model=? AND id=?)').run(grantId, 'Grant', grantId); }
  }
  return { Adapter, close: () => db.close() };
}
export function csrfToken(config, uid, prompt) { return createHmac('sha256', config.cookieKeys[0]).update(`${uid}:${prompt}`).digest('base64url'); }
export function safeEqual(a, b) { return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
export function boundary(req, origin) {
  const counts = new Map();
  for (let i = 0; i < req.rawHeaders.length; i += 2) { const key = req.rawHeaders[i].toLowerCase(); counts.set(key, (counts.get(key) || 0) + 1); }
  return ['host', 'origin', 'cookie', 'x-forwarded-proto'].every(key => (counts.get(key) || 0) <= 1) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && req.headers.host === new URL(origin).host && req.headers['x-forwarded-proto'] === 'https';
}
export async function readForm(req) {
  if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) throw Error('Invalid form.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw Error('Form exceeds limit.'); chunks.push(chunk); }
  const fields = new URLSearchParams(Buffer.concat(chunks).toString());
  for (const name of new Set(fields.keys())) if (fields.getAll(name).length !== 1) throw Error('Ambiguous form.');
  return fields;
}
export function page(res, title, content, status = 200, referrerPolicy = 'no-referrer', formRedirect) {
  if (!['no-referrer', 'same-origin'].includes(referrerPolicy)) throw Error('Unexpected page referrer policy.');
  if (formRedirect !== undefined) {
    const url = new URL(formRedirect);
    if (url.protocol !== 'https:' || url.href !== formRedirect || url.username || url.password || url.search || url.hash || /[\s;'"<>]/.test(formRedirect)) throw Error('Unexpected form redirect.');
  }
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': referrerPolicy, 'strict-transport-security': 'max-age=31536000', 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${formRedirect ? ' ' + formRedirect : ''}; frame-ancestors 'none'; base-uri 'none'` });
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>body{font:16px system-ui;margin:8vh auto;padding:24px;max-width:440px;color:#243244;background:#f6f8fb}main{padding:28px;border:1px solid #dde3ea;border-radius:18px;background:white}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;border:1px solid #cad4df;border-radius:9px;font:inherit}button{background:#245fea;color:white;cursor:pointer}p{line-height:1.7}a{color:#245fea}</style><main><h1>${escapeHTML(title)}</h1>${content}</main></html>`);
}
