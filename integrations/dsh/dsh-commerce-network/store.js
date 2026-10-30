import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

// One optional business ledger, not another execution host. BEGIN IMMEDIATE
// protects state, leases, idempotency receipts and budget changes together.
export class CommerceStore {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS commerce_state (
        workspace_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commerce_receipt (
        workspace_id TEXT NOT NULL, actor TEXT NOT NULL, request_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id, actor, request_id)
      );
      CREATE TABLE IF NOT EXISTS commerce_credential (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL, secret_hash TEXT NOT NULL, created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS commerce_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE, entity_id TEXT, actor TEXT NOT NULL,
        event_type TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS grok_handoff (
        workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, order_id TEXT NOT NULL,
        session_id TEXT NOT NULL, lease_id TEXT, state TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id, project_id, order_id)
      );
      CREATE TABLE IF NOT EXISTS grok_callback_receipt (
        workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, order_id TEXT NOT NULL,
        event_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
        PRIMARY KEY(workspace_id, project_id, order_id, event_key)
      );`);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.closed = false;
  }
  transaction(fn) {
    if (this.closed) throw new Error('COMMERCE_CLOSED');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      if (value && typeof value.then === 'function') throw new Error('SYNCHRONOUS_TRANSACTION_REQUIRED');
      this.db.exec('COMMIT');
      return value;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  load(workspaceId) {
    const row = this.db.prepare('SELECT body FROM commerce_state WHERE workspace_id=?').get(workspaceId);
    const value = row ? JSON.parse(row.body) : { revision: 0, projects: [], products: [], routes: [], parties: [], agents: [], grants: [], workOrders: [], deliverables: [], layouts: [] };
    value.mandates ??= [];
    return value;
  }
  save(workspaceId, state) {
    this.db.prepare('INSERT INTO commerce_state VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET revision=excluded.revision, body=excluded.body')
      .run(workspaceId, state.revision, JSON.stringify(state));
  }
  receipt(workspaceId, actor, requestId) {
    return this.db.prepare('SELECT fingerprint,result FROM commerce_receipt WHERE workspace_id=? AND actor=? AND request_id=?').get(workspaceId, actor, requestId);
  }
  saveReceipt(workspaceId, actor, requestId, fingerprint, result, at) {
    this.db.prepare('INSERT INTO commerce_receipt VALUES(?,?,?,?,?,?)').run(workspaceId, actor, requestId, fingerprint, JSON.stringify(result), at);
  }
  credential(id) { return this.db.prepare('SELECT * FROM commerce_credential WHERE id=?').get(id); }
  addCredential(c) {
    this.db.prepare('INSERT INTO commerce_credential VALUES(?,?,?,?,?,?,?,NULL)').run(c.id, c.workspaceId, c.projectId, c.agentId, c.secretHash, c.createdAt, c.expiresAt);
  }
  revokeCredentials(workspaceId, agentId, at) {
    this.db.prepare('UPDATE commerce_credential SET revoked_at=? WHERE workspace_id=? AND agent_id=? AND revoked_at IS NULL').run(at, workspaceId, agentId);
  }
  audit(workspaceId, event) {
    this.db.prepare('INSERT INTO commerce_audit(workspace_id,event_id,entity_id,actor,event_type,occurred_at,summary) VALUES(?,?,?,?,?,?,?)')
      .run(workspaceId, event.id, event.entityId ?? null, event.actor, event.type, event.at, event.summary);
  }
  events(workspaceId, limit = 100) {
    return this.db.prepare('SELECT event_id AS id,entity_id AS entityId,event_type AS type,occurred_at AS at,summary FROM commerce_audit WHERE workspace_id=? ORDER BY sequence DESC LIMIT ?').all(workspaceId, limit);
  }
  close() { if (!this.closed) { this.closed = true; this.db.close(); } }
}
