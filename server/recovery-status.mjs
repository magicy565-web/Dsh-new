import path from 'node:path';
import { openPrivateFile, validateJson } from './store.mjs';

/** Load credential-free recovery facts without treating them as launch acceptance. */
export async function readRecoveryStatus(dataDirectory, runtimeKind) {
  let handle;
  try { handle = await openPrivateFile(path.join(dataDirectory, 'RECOVERY-REPORT.json')); }
  catch (error) { if (error.code === 'ENOENT') return { restored: false }; throw new Error('Recovery report is unreadable. Inspect the restored directory before startup.', { cause: error }); }
  let value;
  try {
    if ((await handle.stat()).size > 32_768) throw new Error('Recovery report exceeds its size limit.');
    value = JSON.parse(await handle.readFile('utf8')); validateJson(value);
  } finally { await handle.close(); }
  if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.sourceManifestSha256) || !Number.isFinite(Date.parse(value.restoredAt))
    || value.queuedWorkResumed !== false || value.outstandingApprovalsValid !== false || value.schedulesEnabled !== false
    || typeof value.nativeRuntimeIncluded !== 'boolean') throw new Error('Recovery report is incompatible. Inspect the restored directory before startup.');
  const result = { restored: true, restoredAt: value.restoredAt, nativeRuntimeIncluded: value.nativeRuntimeIncluded,
    reviewRequired: true, automaticWorkResumed: false, reportScope: 'restore-time-facts' };
  if (value.nativeRuntimeIncluded) {
    const native = value.native;
    if (!native || native.runtimeVersion !== '0.2.0-rc.2' || native.sessionFormatVersion !== 4
      || typeof native.requiredDataDirectory !== 'string' || !path.isAbsolute(native.requiredDataDirectory)
      || native.workspaceDirectory !== path.join(native.requiredDataDirectory, 'agent-workspace')
      || !Number.isSafeInteger(native.sessions) || native.sessions < 0 || native.permissionsReset !== true
      || native.inFlightReplayed !== false || native.storageDisposition !== 'quarantined') throw new Error('Native recovery report is incompatible. Do not start native execution.');
    const pathMatches = path.resolve(dataDirectory) === native.requiredDataDirectory;
    if (runtimeKind === 'deepseek-harness' && !pathMatches) {
      const error = new Error('Native restore is staged at a different path. Stop the application and activate it at the original absolute data path; preserve the previous directory for rollback. Native history cannot be silently rebased.');
      error.code = 'NATIVE_RESTORE_PATH_MISMATCH'; throw error;
    }
    Object.assign(result, { nativePathMatches: pathMatches, nativeSessionCount: native.sessions, nativePermissionsAtRestore: 'read-only-deny-approval', nativeStorageQuarantined: true });
  }
  return result;
}
