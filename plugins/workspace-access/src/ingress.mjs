// Enterprise signed ingress: a reviewed reverse proxy signs (subject, time,
// nonce, method, path) with an Ed25519 private key. The harness only holds the
// public key, so it can verify but never forge an identity.
import { createPublicKey, verify } from 'node:crypto';

export const INGRESS_WINDOW_MS = 5 * 60_000;
export const INGRESS_HEADERS = Object.freeze({
  subject: 'x-ingress-subject',
  timestamp: 'x-ingress-timestamp',
  nonce: 'x-ingress-nonce',
  signature: 'x-ingress-signature',
});

/**
 * @param {{publicKeyPem?: string, windowMs?: number, clock?: () => number}} options
 */
export function createIngressVerifier({ publicKeyPem = null, windowMs = INGRESS_WINDOW_MS, clock = Date.now } = {}) {
  let key = null;
  if (publicKeyPem) {
    try { key = createPublicKey(publicKeyPem); } catch { key = null; }
  }
  const nonces = new Map();

  function prune(now) {
    for (const [nonce, at] of nonces) if (now - at > windowMs) nonces.delete(nonce);
  }

  return Object.freeze({
    enabled: key !== null,

    /** Verify one signed request; returns `{ subject }` or null. Never throws. */
    verify({ subject, timestamp, nonce, method, path, signature } = {}) {
      if (key === null) return null;
      if (typeof subject !== 'string' || !subject.trim() || subject.length > 200) return null;
      const ts = Number(timestamp);
      if (!Number.isSafeInteger(ts) || ts <= 0) return null;
      const now = clock();
      if (Math.abs(now - ts) > windowMs) return null;
      if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/u.test(nonce)) return null;
      if (typeof method !== 'string' || !method) return null;
      if (typeof path !== 'string' || !path.startsWith('/')) return null;
      if (typeof signature !== 'string' || !signature) return null;
      const payload = Buffer.from([subject, String(ts), nonce, method, path].join('\n'), 'utf8');
      let valid = false;
      try { valid = verify(null, payload, key, Buffer.from(signature, 'base64')); } catch { valid = false; }
      if (!valid) return null;
      prune(now);
      if (nonces.has(nonce)) return null;
      nonces.set(nonce, now);
      return { subject: subject.trim() };
    },
  });
}
