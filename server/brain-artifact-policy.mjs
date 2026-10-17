/** Original Artifact Host: reserve the private Business Brain metadata namespace.
 * The untrusted JSON request body cannot set `admission`, which is supplied
 * exclusively as an in-process second argument by the reviewed original Host.
 */
const hex64 = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const recordKey = value => typeof value === 'string' && /^(?:context|(?:decision|review|feedback):[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127})$/u.test(value);
export const isBrainArtifact = artifact => artifact?.metadata?.businessBrain !== undefined;
export function mayWriteBrainArtifact(existing, nextMetadata, admission = {}) {
  const previous = existing?.metadata?.businessBrain;
  const incoming = nextMetadata?.businessBrain;
  if (previous === undefined && incoming === undefined) return true;
  if (admission?.brainProtectedWrite !== true || typeof admission.check !== 'function'
    || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)
    || incoming.schema !== 1 || !hex64(incoming.scopeKey) || !hex64(incoming.bodyHash)
    || !recordKey(incoming.key) || Object.keys(incoming).length !== 4
    || nextMetadata?.businessLibrary?.visibility !== 'internal') return false;
  if (previous && (previous.scopeKey !== incoming.scopeKey || previous.key !== incoming.key || previous.schema !== 1)) return false;
  return true;
}
