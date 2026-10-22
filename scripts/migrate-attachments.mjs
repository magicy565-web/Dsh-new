// Attachment import: copy legacy attachment files into the harness artifact
// store through the real artifacts service.
//
// The service owns quotas, sha256 integrity, state shape and idempotency, so the
// migration never writes artifact state by hand. The requestId is derived from
// the relative path, which makes a second run report duplicates instead of
// importing the same file twice.
//
// Usage:
//   node scripts/migrate-attachments.mjs --from <legacy-attachments-dir> --to .harness-data [--apply]
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArtifacts } from '../packages/harness-seams/src/artifacts.mjs';

export const MAX_FILES = 500;
export const MAX_BYTES = 5 * 1024 * 1024;
export const MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
});

export class AttachmentMigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AttachmentMigrationError';
    this.code = code;
  }
}

/** File-backed adapter over the harness storage service shape. */
export function createFileStore(statePath) {
  let state = null;
  const load = async () => {
    if (state !== null) return state;
    try { state = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      state = { artifacts: [], activity: [] };
    }
    return state;
  };
  return {
    directory: path.dirname(statePath),
    load,
    // The artifact service reads store.read().artifacts; a fresh file has no key.
    read: () => {
      const current = JSON.parse(JSON.stringify(state ?? {}));
      if (!Array.isArray(current.artifacts)) current.artifacts = [];
      if (!Array.isArray(current.activity)) current.activity = [];
      return current;
    },
    async update(callback) {
      const current = await load();
      const draft = JSON.parse(JSON.stringify(current));
      const result = callback(draft);
      state = draft;
      await mkdir(path.dirname(statePath), { recursive: true });
      const staging = `${statePath}.tmp`;
      await writeFile(staging, JSON.stringify(draft, null, 2), 'utf8');
      await rename(staging, statePath);
      return result;
    },
  };
}

/** Walk a directory (bounded) into relative file paths. */
export async function listFiles(root, depth = 0, prefix = '') {
  if (depth > 4) return [];
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, depth + 1, relative));
    else if (entry.isFile()) files.push(relative);
    if (files.length > MAX_FILES) throw new AttachmentMigrationError('ATTACHMENT_TOO_MANY', `More than ${MAX_FILES} files; split the import.`);
  }
  return files;
}

const requestIdFor = relative => {
  const raw = `legacy-attachment:${relative.split(path.sep).join('/')}`;
  return raw.length <= 128 ? raw : `legacy-attachment:${createHash('sha256').update(raw).digest('hex')}`;
};

/**
 * @param {{from: string, to: string, apply?: boolean}} options
 */
export async function migrateAttachments({ from, to, apply = false }) {
  const info = await stat(from).catch(() => null);
  if (!info || !info.isDirectory()) throw new AttachmentMigrationError('ATTACHMENT_SOURCE', '--from must be an existing directory.');
  const files = await listFiles(from);
  const skipped = [];
  const eligible = [];
  for (const relative of files) {
    const absolute = path.join(from, relative);
    const fileStat = await stat(absolute);
    if (fileStat.size > MAX_BYTES) { skipped.push({ file: relative, reason: 'TOO_LARGE' }); continue; }
    const mimeType = MIME_BY_EXTENSION[path.extname(relative).toLowerCase()] ?? 'application/octet-stream';
    eligible.push({ relative, absolute, mimeType, size: fileStat.size });
  }
  const report = { dryRun: !apply, files: files.length, eligible: eligible.length, imported: 0, duplicates: 0, skipped };

  if (!apply) {
    report.planned = eligible.slice(0, 20).map(item => ({ file: item.relative, mimeType: item.mimeType, size: item.size }));
    return report;
  }

  const statePath = path.join(path.resolve(to), 'workspace.json');
  const store = createFileStore(statePath);
  await store.load();
  const artifacts = await createArtifacts({ store, directory: path.join(path.resolve(to), 'artifacts') });
  try {
    for (const item of eligible) {
      try {
        const bytes = await readFile(item.absolute);
        const created = await artifacts.create({
          filename: path.basename(item.relative),
          base64: bytes.toString('base64'),
          mimeType: item.mimeType,
          title: item.relative.split(path.sep).join('/'),
          requestId: requestIdFor(item.relative),
        });
        if (created.duplicate) report.duplicates += 1;
        else report.imported += 1;
      } catch (error) {
        skipped.push({ file: item.relative, reason: error?.code ?? 'CREATE_FAILED', message: error?.message });
      }
    }
  } finally {
    // The service holds a writer lock on the store; release it for the next run.
    if (typeof artifacts.close === 'function') await artifacts.close().catch(() => {});
  }
  report.skipped = skipped;
  return report;
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const from = argValue(argv, '--from');
  if (!from) {
    process.stderr.write('usage: node scripts/migrate-attachments.mjs --from <dir> [--to <harness-data-dir>] [--apply]\n');
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const to = argValue(argv, '--to') ?? path.join(root, '.harness-data');
  const report = await migrateAttachments({ from: path.resolve(from), to, apply: argv.includes('--apply') });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    process.stderr.write(`migrate-attachments: ${error.code ?? 'ERROR'} ${error.message}\n`);
    process.exitCode = 1;
  });
}
