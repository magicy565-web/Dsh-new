import { createPublicKey, verify } from 'node:crypto';
import { canonical, controlDigest } from './control-store.mjs';

const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function exact(value, keys) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key)))
    throw new TypeError('Use the exact signed release schema.');
}
function text(value, maximum, pattern) {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value) || pattern && !pattern.test(value))
    throw new TypeError('Invalid release descriptor field.');
  return value;
}
const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
const imagePattern = /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[1-9]\d{0,4})?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[a-f0-9]{64}$/u;

/** Explicitly supplied PUBLIC trust anchors only. No key generation or environment scan. */
export function publisherTrust(input) {
  if (!Array.isArray(input) || input.length > 100) throw new TypeError('Use a bounded explicit publisher trust list.');
  const records = new Map();
  for (const item of input) {
    exact(item, ['keyId', 'publisher', 'publicKey']);
    text(item.keyId, 100, /^[A-Za-z0-9._-]+$/u); text(item.publisher, 128, idPattern);
    if (records.has(item.keyId) || typeof item.publicKey !== 'string' || item.publicKey.length > 4096 || !item.publicKey.startsWith('-----BEGIN PUBLIC KEY-----'))
      throw new TypeError('Use unique Ed25519 public trust anchors.');
    const key = createPublicKey(item.publicKey);
    if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('Only Ed25519 publisher signatures are accepted.');
    records.set(item.keyId, Object.freeze({ publisher: item.publisher, key }));
  }
  return records;
}

/**
 * Only a data descriptor is accepted. Arbitrary JavaScript, npm install scripts,
 * URLs to execute, host mounts and network permissions are NOT accepted here.
 * Signature verification is provenance, not independent safety approval.
 */
export function verifyReleaseEnvelope(envelope, trust) {
  exact(envelope, ['manifest', 'keyId', 'signature']);
  text(envelope.keyId, 100, /^[A-Za-z0-9._-]+$/u);
  text(envelope.signature, 88, /^[A-Za-z0-9+/]{86}==$/u);
  if (Buffer.from(envelope.signature, 'base64').toString('base64') !== envelope.signature) throw new TypeError('Use canonical signature bytes.');
  const manifest = envelope.manifest;
  exact(manifest, ['schemaVersion', 'id', 'name', 'version', 'description', 'license', 'publisher', 'execution', 'artifact', 'permissions']);
  if (manifest.schemaVersion !== 1 || manifest.execution !== 'isolated-oci') throw new TypeError('This release path accepts isolated OCI descriptors only. Native OMP packages remain reviewed repository code.');
  text(manifest.id, 128, idPattern); text(manifest.name, 100); text(manifest.version, 64, versionPattern);
  text(manifest.description, 2000); text(manifest.license, 100); text(manifest.publisher, 128, idPattern);
  if (!manifest.id.startsWith('thirdparty.' + manifest.publisher + '.')) throw new TypeError('A publisher may not claim another plugin namespace.');
  exact(manifest.artifact, ['image', 'command', 'protocol']);
  text(manifest.artifact.image, 512, imagePattern);
  if (manifest.artifact.protocol !== 'workspace-plugin-json-v1' || !Array.isArray(manifest.artifact.command) || manifest.artifact.command.length < 1 || manifest.artifact.command.length > 32)
    throw new TypeError('Use the bounded JSON executable contract.');
  for (const argument of manifest.artifact.command) text(argument, 512);
  if (!manifest.artifact.command[0].startsWith('/') || manifest.artifact.command[0].split('/').slice(1).some(part => !part || part === '.' || part === '..')) throw new TypeError('The container executable must use an absolute image-internal path.');
  exact(manifest.permissions, ['network', 'hostFilesystem', 'input', 'output']);
  if (manifest.permissions.network !== 'none' || manifest.permissions.hostFilesystem !== 'none' || manifest.permissions.input !== 'explicit-json' || manifest.permissions.output !== 'json')
    throw new TypeError('Network access and host-filesystem grants are outside this reviewed release path.');
  const key = trust.get(envelope.keyId);
  if (!key || key.publisher !== manifest.publisher) throw new TypeError('Publisher trust is missing or was revoked.');
  const encoded = Buffer.from(canonical(manifest));
  if (encoded.length > 32 * 1024 || !verify(null, encoded, key.key, Buffer.from(envelope.signature, 'base64')))
    throw new TypeError('The immutable release signature does not match its reviewed descriptor.');
  return Object.freeze({ envelope: structuredClone(envelope), fingerprint: controlDigest(envelope), publisher: key.publisher });
}

export function releaseSummary(row, trust) {
  let verification;
  try { verification = verifyReleaseEnvelope(row.envelope, trust); } catch { /* Do not expose parser errors, keys or stale trusted status. */ }
  const manifest = row.envelope?.manifest;
  return {
    id: row.id, pluginId: manifest?.id || '', name: manifest?.name || '', version: manifest?.version || '',
    publisher: manifest?.publisher || '', description: manifest?.description || '', license: manifest?.license || '',
    fingerprint: row.fingerprint, status: verification && verification.fingerprint === row.fingerprint ? row.status : 'trust-unavailable',
    importedBy: row.importedBy, reviewedBy: row.reviewedBy || null, reviewNote: row.reviewNote || '',
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    execution: 'isolated-oci', runtimeVerified: false, enterpriseDataAuthorized: false,
    artifact: manifest?.artifact || null, permissions: manifest?.permissions || null,
  };
}
