import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDirectory, openPrivateFile, acquireWriterLock, syncDirectory } from '../server/store.mjs';

/** Offline maintenance. Default is a count-only preview; never interrupts active tasks. */
export async function pruneAgentHistory({ dataDir, days, apply = false, clock = Date.now } = {}) {
  if (!dataDir || !Number.isSafeInteger(days) || days < 1 || days > 36500) throw new Error('Supply a data directory and retention days from 1 to 36500.');
  const root = await privateDirectory(dataDir);
  const lock = await acquireWriterLock(root.directory, 'agent.lock');
  let db;
  try {
    const filename = path.join(root.directory, 'agent.sqlite');
    const handle = await openPrivateFile(filename); await handle.close();
    db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
    const cutoff = new Date(clock() - days * 86400000).toISOString();
    if (db.prepare('PRAGMA user_version').get().user_version >= 2) {
      const rows = db.prepare('SELECT task_json FROM agent_task_projection').all().map(row => JSON.parse(row.task_json));
      const eligible = rows.filter(row => ['done', 'failed', 'interrupted'].includes(row.status) && row.finished_at && row.finished_at < cutoff).length;
      if (apply) throw new Error('Pi tasks belong to Workspace Store. Projection-only deletion is prohibited; preserve business records, checkpoints and failures under the original backup/retention policy.');
      return { applied: false, days, cutoff, eligible, removed: 0, authority: 'workspace-store', policy: 'retain-until-reviewed-business-archive' };
    }
    const tasks = db.prepare("SELECT task_id FROM tasks WHERE status IN ('done','failed','interrupted') AND finished_at < ? ORDER BY task_id").all(cutoff);
    if (tasks.some(row => !/^agt_[0-9a-f-]{36}$/.test(row.task_id))) throw new Error('Unexpected task archive identifier.');
    if (!apply) return { applied: false, days, cutoff, eligible: tasks.length, removed: 0 };
    await root.verify(); await lock.verify();
    db.exec('BEGIN IMMEDIATE');
    try {
      const remove = db.prepare("DELETE FROM tasks WHERE task_id=? AND status IN ('done','failed','interrupted') AND finished_at < ?");
      for (const row of tasks) remove.run(row.task_id, cutoff);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const artifacts = path.join(root.directory, 'artifacts');
    const stat = await fs.lstat(artifacts);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(artifacts) !== artifacts) throw new Error('Unsafe artifact root.');
    for (const row of tasks) await fs.rm(path.join(artifacts, row.task_id), { recursive: true, force: true });
    await syncDirectory(artifacts); db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { applied: true, days, cutoff, eligible: tasks.length, removed: tasks.length };
  } finally { try { db?.close(); } finally { await lock.release(); } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), index = args.indexOf('--days');
  try {
    if (index < 0 || args.some((arg, i) => arg !== '--days' && arg !== '--apply' && i !== index + 1)) throw new Error('Invalid arguments.');
    console.log(JSON.stringify(await pruneAgentHistory({ dataDir: process.env.WS_AGENT_DATA, days: Number(args[index + 1]), apply: args.includes('--apply') })));
  } catch { console.error('Agent retention failed. Stop the service, then check WS_AGENT_DATA and --days. No credentials are printed.'); process.exitCode = 1; }
}
