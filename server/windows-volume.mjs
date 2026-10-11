import childProcess from 'node:child_process';
import path from 'node:path';
import { windowsVolumeQuery } from './windows-volume-query.mjs';

const checked = new Map();
const unsupported = cause => Object.assign(new Error('Local NTFS directory durability could not be verified.', { cause }), { code: 'WORKSPACE_DURABILITY_UNSUPPORTED' });

/** Read-only Windows volume query; no policy, ACL, elevation or storage changes. */
export async function assertWindowsDirectoryVolume(directory, identity) {
  const key = JSON.stringify([directory, identity.dev, identity.ino]);
  if (checked.has(key)) return;
  try {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const stdout = await new Promise((resolve, reject) => {
      childProcess.execFile(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsVolumeQuery, 'utf16le').toString('base64')],
        { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 4096, env: { ...process.env, WORKSPACE_VOLUME_QUERY_DIRECTORY: directory } },
        (error, output) => error ? reject(error) : resolve(output));
    });
    const volume = JSON.parse(stdout.replace(/^\uFEFF/u, '').trim());
    // MS-FSA 2.1.5.7 / product behavior <80>: other Windows filesystems can
    // report successful flush without persisting directory structure.
    if (volume.fileSystem !== 'NTFS' || volume.driveType !== 3 || !Number.isInteger(volume.flags) || !(volume.flags & 8) || (volume.flags & 0x80000)) throw new Error('A writable local NTFS volume with persistent ACLs is required.');
    if (checked.size >= 64) checked.clear();
    checked.set(key, true);
  } catch (cause) { throw unsupported(cause); }
}
