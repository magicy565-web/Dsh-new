import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createIngressVerifier, INGRESS_HEADERS } from '../src/ingress.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

function signedRequest(overrides = {}) {
  const now = Date.parse('2026-10-23T00:00:00.000Z');
  const base = {
    subject: 'local-operator', timestamp: now, nonce: 'abcdef123456',
    method: 'GET', path: '/api/chat/status', ...overrides,
  };
  const payload = Buffer.from([base.subject, String(base.timestamp), base.nonce, base.method, base.path].join('\n'), 'utf8');
  return { ...base, signature: sign(null, payload, privateKey).toString('base64'), now };
}

test('a correctly signed request verifies and a tampered one does not', () => {
  const request = signedRequest();
  const verifier = createIngressVerifier({ publicKeyPem, clock: () => request.now });
  assert.equal(verifier.enabled, true);
  assert.deepEqual(verifier.verify(request), { subject: 'local-operator' });

  const tampered = signedRequest({ nonce: 'othernonce12', path: '/api/chat/conversations' });
  tampered.path = '/api/admin';
  const fresh = createIngressVerifier({ publicKeyPem, clock: () => request.now });
  assert.equal(fresh.verify(tampered), null);
});

test('the signature is bound to method, path, subject and time', () => {
  const request = signedRequest();
  const verifier = createIngressVerifier({ publicKeyPem, clock: () => request.now });
  for (const change of [{ method: 'POST' }, { path: '/api/goals' }, { subject: 'someone-else' }]) {
    const candidate = { ...request, ...change };
    assert.equal(verifier.verify(candidate), null, JSON.stringify(change));
  }
});

test('an old or future timestamp is refused', () => {
  const request = signedRequest();
  const later = request.now + 6 * 60_000;
  const verifier = createIngressVerifier({ publicKeyPem, clock: () => later });
  assert.equal(verifier.verify(request), null);
});

test('a replayed nonce is refused within the window', () => {
  const request = signedRequest();
  const verifier = createIngressVerifier({ publicKeyPem, clock: () => request.now });
  assert.ok(verifier.verify(request));
  assert.equal(verifier.verify(request), null);
});

test('without a public key nothing verifies', () => {
  const request = signedRequest();
  const verifier = createIngressVerifier({ clock: () => request.now });
  assert.equal(verifier.enabled, false);
  assert.equal(verifier.verify(request), null);
});

test('malformed headers are refused without throwing', () => {
  const request = signedRequest();
  const verifier = createIngressVerifier({ publicKeyPem, clock: () => request.now });
  assert.equal(verifier.verify({ ...request, signature: 'not base64!!' }), null);
  assert.equal(verifier.verify({ ...request, nonce: 'short' }), null);
  assert.equal(verifier.verify({}), null);
  assert.equal(verifier.verify(undefined), null);
});

test('the header names are stable', () => {
  assert.deepEqual(INGRESS_HEADERS, {
    subject: 'x-ingress-subject', timestamp: 'x-ingress-timestamp',
    nonce: 'x-ingress-nonce', signature: 'x-ingress-signature',
  });
});
