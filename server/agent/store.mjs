import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { privateDirectory, syncDirectory, openPrivateFile, acquireWriterLock } from '../store.mjs';

export const AGENT_EVENT_KINDS = Object.freeze(['accepted', 'stage', 'thinking', 'progress', 'artifact', 'done', 'error']);
export const TERMINAL_STATUSES = new Set(['done', 'failed', 'interrupted']);
export const artifactNameValid = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) && !name.includes('..');
const taskIdValid = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** A rebuildable read projection, not an execution store. Workspace Store owns all mutations. */
export async function openAgentStore(dataDirectory) {
  const root = await privateDirectory(dataDirectory), lock = await acquireWriterLock(root.directory, 'agent.lock');
  let db;
  try {
    const filename = path.join(root.directory, 'agent.sqlite');
    for (const suffix of ['', '-wal', '-shm']) {
      try { const handle = await openPrivateFile(filename + suffix); await handle.close(); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    try { const file = await fs.open(filename, 'wx', 0o600); await file.sync(); await file.close(); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    db = new DatabaseSync(filename);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if (db.prepare('PRAGMA user_version').get().user_version > 2) throw new Error('This Agent projection requires a newer service version.');
    // Old PR44 tables remain intact for explicit member-bound migration and audit.
    db.exec([
      'CREATE TABLE IF NOT EXISTS agent_task_projection (task_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, subject TEXT NOT NULL, task_json TEXT NOT NULL, authority_sequence INTEGER NOT NULL, event_count INTEGER NOT NULL);',
      'CREATE TABLE IF NOT EXISTS agent_event_projection (task_id TEXT NOT NULL REFERENCES agent_task_projection(task_id), seq INTEGER NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, ts TEXT NOT NULL, PRIMARY KEY(task_id,seq));',
      'CREATE TABLE IF NOT EXISTS agent_artifact_projection (task_id TEXT NOT NULL REFERENCES agent_task_projection(task_id), name TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, url TEXT NOT NULL, PRIMARY KEY(task_id,name));',
      'PRAGMA user_version=2;'
    ].join('\n'));
    const artifactRoot = await privateDirectory(path.join(root.directory, 'artifacts'));
    await syncDirectory(root.directory);
    return new AgentProjection(db, root, artifactRoot, lock);
  } catch (error) { try { db?.close(); } finally { await lock.release(); } throw error; }
}

class AgentProjection {
  constructor(db, root, artifactRoot, lock) {
    Object.assign(this, { db, root, artifactRoot, lock, directory: root.directory });
    this.listeners = new Map(); this.closed = false; this.pending = Promise.resolve(); this.last = new Map();
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  subscribe(taskId, fn) {
    const listeners = this.listeners.get(taskId) || new Set(); listeners.add(fn); this.listeners.set(taskId, listeners);
    return () => { listeners.delete(fn); if (!listeners.size) this.listeners.delete(taskId); };
  }
  notify(taskId) { for (const fn of this.listeners.get(taskId) || []) { try { fn(); } catch { /* read clients cannot break projection */ } } }
  sync(task, authoritySequence = 0) {
    const operation = this.pending.then(() => this._sync(task, authoritySequence));
    this.pending = operation.catch(() => {});
    return operation;
  }
  async _sync(task, authoritySequence) {
    if (this.closed || !taskIdValid(task.id)) throw new Error('Invalid projection task.');
    const artifacts = task.deliverables.map(({ name, bytes, url }) => ({ name, bytes, url }));
    const view = { taskId: task.id, type: task.type, title: task.title, input: task.input, status: task.status,
      summary: task.summary || null, created_at: task.createdAt, finished_at: task.finishedAt || null, artifacts,
      result: task.result, request_key: task.requestKey || null,
      workspace: { conversationId: task.conversationId || null, runIds: task.steps.map(step => step.runId).filter(Boolean), authority: 'workspace-store' } };
    // The cache must cover the entire public view, published event contents
    // and immutable owner; equal event counts alone do not prove an outbox
    // entry was unchanged. Hash, rather than retain, private task/input data.
    const signature = digest(Buffer.from(JSON.stringify({
      owner: [task.workspaceId, task.subject], view,
      events: task.events.map(({ seq, kind, payload, ts }) => [seq, kind, payload, ts]),
      artifacts: task.deliverables.map(({ name, sha256 }) => [name, sha256]),
    }), 'utf8'));
    if (this.last.get(task.id) === signature) return;
    // Materialize every file before making its already durable outbox event readable.
    for (const artifact of task.deliverables) await this.materialize(task.id, artifact);
    this.transaction(() => {
      const owner = this.db.prepare('SELECT workspace_id,subject FROM agent_task_projection WHERE task_id=?').get(task.id);
      if (owner && (owner.workspace_id !== task.workspaceId || owner.subject !== task.subject))
        throw new Error('Original Agent task owner changed; restore consistent authority, never reassign a projection.');
      this.db.prepare('INSERT INTO agent_task_projection VALUES(?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET task_json=excluded.task_json,authority_sequence=excluded.authority_sequence,event_count=excluded.event_count')
        .run(task.id, task.workspaceId, task.subject, JSON.stringify(view), authoritySequence, task.events.length);
      const old = this.db.prepare('SELECT count(*) AS n FROM agent_event_projection WHERE task_id=?').get(task.id).n;
      if (old > task.events.length) throw new Error('Projection is ahead of business authority; restore a consistent backup.');
      for (let index = 0; index < task.events.length; index++) {
        const { seq, kind, payload, ts } = task.events[index];
        if (seq !== index + 1 || !AGENT_EVENT_KINDS.includes(kind)) throw new Error('Invalid authoritative event outbox.');
        if (index < old) {
          const stored = this.db.prepare('SELECT kind,payload_json,ts FROM agent_event_projection WHERE task_id=? AND seq=?').get(task.id, seq);
          if (stored.kind !== kind || stored.payload_json !== JSON.stringify(payload) || stored.ts !== ts) throw new Error('A previously delivered event cannot change.');
        } else this.db.prepare('INSERT INTO agent_event_projection VALUES(?,?,?,?,?)').run(task.id, seq, kind, JSON.stringify(payload), ts);
      }
      for (const file of task.deliverables) {
        const previous = this.db.prepare('SELECT sha256 FROM agent_artifact_projection WHERE task_id=? AND name=?').get(task.id, file.name);
        if (previous && previous.sha256 !== file.sha256) throw new Error('An artifact version cannot be overwritten.');
        this.db.prepare('INSERT OR IGNORE INTO agent_artifact_projection VALUES(?,?,?,?,?)').run(task.id, file.name, file.bytes, file.sha256, file.url);
      }
    });
    this.last.set(task.id, signature); this.notify(task.id);
  }
  getInternalTask(id) {
    const row = this.db.prepare('SELECT task_json FROM agent_task_projection WHERE task_id=?').get(id);
    return row ? JSON.parse(row.task_json) : null;
  }
  getTask(id, actor) {
    const row = this.db.prepare('SELECT task_json FROM agent_task_projection WHERE task_id=? AND workspace_id=? AND subject=?').get(id, actor.workspaceId, actor.subject);
    return row ? JSON.parse(row.task_json) : null;
  }
  events(taskId, from = 0, limit = null) {
    const sql = 'SELECT seq,kind,payload_json,ts FROM agent_event_projection WHERE task_id=? AND seq>? ORDER BY seq' + (limit === null ? '' : ' LIMIT ?');
    return this.db.prepare(sql).all(...(limit === null ? [taskId, from] : [taskId, from, limit]))
      .map(row => ({ seq: row.seq, kind: row.kind, payload: JSON.parse(row.payload_json), ts: row.ts }));
  }
  listArtifacts(taskId) {
    return this.db.prepare('SELECT name,bytes,url FROM agent_artifact_projection WHERE task_id=? ORDER BY rowid').all(taskId).map(row => ({ ...row }));
  }
  async materialize(taskId, artifact) {
    if (!artifactNameValid(artifact.name) || typeof artifact.content !== 'string') throw new Error('Invalid authoritative artifact.');
    const data = Buffer.from(artifact.content, 'utf8');
    if (data.length > 2_000_000 || data.length !== artifact.bytes || digest(data) !== artifact.sha256) throw new Error('Authoritative artifact integrity mismatch.');
    await this.root.verify(); await this.lock.verify(); await this.artifactRoot.verify();
    const folder = await privateDirectory(path.join(this.artifactRoot.directory, taskId));
    await syncDirectory(this.artifactRoot.directory);
    const filename = path.join(folder.directory, artifact.name);
    try {
      const existing = await openPrivateFile(filename);
      try { if ((await existing.stat()).size !== data.length || digest(await existing.readFile()) !== artifact.sha256) throw new Error('Existing artifact conflicts with its authority.'); }
      finally { await existing.close(); }
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = path.join(folder.directory, '.writing-' + randomUUID());
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    try { await folder.verify(); await fs.link(temporary, filename); await syncDirectory(folder.directory); }
    finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async readArtifact(taskId, name, legacy = false) {
    if (!taskIdValid(taskId) || !artifactNameValid(name)) return null;
    const table = legacy ? 'artifacts' : 'agent_artifact_projection';
    const row = this.db.prepare('SELECT name,bytes,sha256,url FROM ' + table + ' WHERE task_id=? AND name=?').get(taskId, name);
    if (!row) return null;
    await this.root.verify(); await this.artifactRoot.verify();
    const directory = path.join(this.artifactRoot.directory, taskId), info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(directory) !== directory) throw new Error('Unsafe artifact directory.');
    const handle = await openPrivateFile(path.join(directory, name));
    let data;
    try { if ((await handle.stat()).size !== row.bytes) throw new Error('Artifact size mismatch.'); data = await handle.readFile(); } finally { await handle.close(); }
    if (digest(data) !== row.sha256) throw new Error('Artifact integrity mismatch.');
    return { ...row, data };
  }
  async legacyTasks() {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").get()) return [];
    const result = [];
    for (const row of this.db.prepare('SELECT * FROM tasks').all()) {
      const files = [];
      for (const item of this.db.prepare('SELECT name FROM artifacts WHERE task_id=?').all(row.task_id)) {
        const file = await this.readArtifact(row.task_id, item.name, true);
        files.push({ name: file.name, bytes: file.bytes, sha256: file.sha256, url: file.url, content: file.data.toString('utf8') });
      }
      result.push({ ...row, files, events: this.db.prepare('SELECT seq,kind,payload_json,ts FROM events WHERE task_id=? ORDER BY seq').all(row.task_id)
        .map(event => ({ seq: event.seq, kind: event.kind, payload: JSON.parse(event.payload_json), ts: event.ts })) });
    }
    return result;
  }
  async close() {
    await this.pending;
    if (this.closed) return;
    this.closed = true; this.listeners.clear();
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.db.close(); await syncDirectory(this.directory); }
    finally { await this.lock.release(); }
  }
}
