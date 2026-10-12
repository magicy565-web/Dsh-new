import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.join(process.env.WORKSPACE_PI_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '.data'), 'requests');
const key = scope => createHash('sha256').update(JSON.stringify([scope.workspaceId, scope.subject, scope.conversationId])).digest('hex');

// Client write-ahead recovery only: no queue, credentials, consent or scheduler.
export function createRequestJournal(root = directory) {
  return {
    async save(pending) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const target = path.join(root, key(pending.scope) + '.json');
      const temporary = target + '.' + randomUUID() + '.tmp';
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(pending)); await file.sync(); }
      finally { await file.close(); }
      try { await rename(temporary, target); }
      catch (error) { await unlink(temporary).catch(() => {}); throw error; }
      if (process.platform !== 'win32') {
        const dir = await open(root, 'r');
        try { await dir.sync(); } finally { await dir.close(); }
      }
    },
    async read(scope) {
      try { return JSON.parse(await readFile(path.join(root, key(scope) + '.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
  };
}
