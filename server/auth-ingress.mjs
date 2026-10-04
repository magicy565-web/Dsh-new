import { createPrivateKey, sign, randomBytes, createHash } from 'node:crypto';

/** Reference adapter building block, NOT an SSO login service or trusted proxy.
 * A reviewed gateway must first authenticate a stable subject with its IdP, remove
 * client-supplied identity/assertion headers, and forward these exact bytes and URL.
 * The caller owns key provisioning/rotation and must never expose the private key
 * or signed assertions to the browser. Use a new assertion for EVERY upstream try.
 */
export function signWorkspaceRequest({ privateKey, publicOrigin, workspaceId, issuer, keyId, subject, method, target, body = Buffer.alloc(0), now = Date.now() }) {
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9._@:+|/-]{1,128}$/.test(value);
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || origin.protocol !== 'https:' || ![workspaceId, issuer, keyId, subject].every(identifier)) throw new Error('Invalid explicit ingress identity configuration.');
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method) || typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || /[\\\u0000-\u001f]/.test(target) || target.length > 2048) throw new Error('Invalid signed request target.');
  if (!Buffer.isBuffer(body) && typeof body !== 'string') throw new Error('body must contain the exact forwarded bytes, not a parsed object.');
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  if (['GET', 'HEAD', 'DELETE'].includes(method) && bytes.length) throw new Error('This HTTP method must have an empty body.');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid assertion clock.');
  const key = typeof privateKey === 'object' && privateKey?.type === 'private' ? privateKey : createPrivateKey(privateKey);
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') throw new Error('An explicitly provided Ed25519 private key is required.');
  const iat = Math.floor(now / 1000);
  const header = { alg: 'EdDSA', typ: 'workspace-ingress+jwt', kid: keyId };
  const claims = { iss: issuer, aud: publicOrigin, workspace: workspaceId, sub: subject, iat, exp: iat + 30, jti: randomBytes(24).toString('base64url'), method, target, bodySha256: createHash('sha256').update(bytes).digest('hex') };
  const unsigned = [header, claims].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${unsigned}.${sign(null, Buffer.from(unsigned), key).toString('base64url')}`;
}
