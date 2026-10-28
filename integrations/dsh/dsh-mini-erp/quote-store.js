import { randomUUID } from "node:crypto";
import {
  sha,
  canonical,
  fail,
  id,
  integer,
} from "@workspace-agent/dsh-commerce-contracts";
export function migrateQuotes(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS quotes(workspace TEXT,id TEXT,project TEXT,revision INTEGER NOT NULL,current_version INTEGER NOT NULL,PRIMARY KEY(workspace,id));
    CREATE TABLE IF NOT EXISTS quote_versions(workspace TEXT,quote_id TEXT,version INTEGER,body TEXT NOT NULL,status TEXT NOT NULL,approval TEXT,PRIMARY KEY(workspace,quote_id,version),FOREIGN KEY(workspace,quote_id) REFERENCES quotes(workspace,id));
    CREATE TABLE IF NOT EXISTS quote_events(seq INTEGER PRIMARY KEY,workspace TEXT,quote_id TEXT,version INTEGER,action TEXT,actor TEXT,at TEXT,body TEXT);
    CREATE TABLE IF NOT EXISTS quote_requests(workspace TEXT,actor TEXT,request TEXT,digest TEXT,quote_id TEXT,receipt TEXT,PRIMARY KEY(workspace,actor,request));
    CREATE TABLE IF NOT EXISTS quote_policies(workspace TEXT,product_id TEXT,revision INTEGER,body TEXT,PRIMARY KEY(workspace,product_id));
    CREATE TABLE IF NOT EXISTS quote_delivery_outbox(workspace TEXT,request_id TEXT,quote_id TEXT,version INTEGER,status TEXT,body TEXT,result TEXT,PRIMARY KEY(workspace,request_id),UNIQUE(workspace,quote_id,version));
    CREATE TABLE IF NOT EXISTS sample_requests(workspace TEXT,id TEXT,revision INTEGER,body TEXT,PRIMARY KEY(workspace,id));
    CREATE TABLE IF NOT EXISTS sample_events(seq INTEGER PRIMARY KEY,workspace TEXT,sample_id TEXT,actor TEXT,action TEXT,at TEXT,body TEXT);
    CREATE TABLE IF NOT EXISTS sample_commands(workspace TEXT,actor TEXT,request TEXT,digest TEXT,sample_id TEXT,PRIMARY KEY(workspace,actor,request));
    CREATE TABLE IF NOT EXISTS channel_evidence(workspace TEXT,id TEXT,project TEXT,kind TEXT,currency TEXT,amount INTEGER,body TEXT,PRIMARY KEY(workspace,id));`);
}
export class QuoteStore {
  constructor(erp) {
    this.erp = erp;
    this.db = erp.db;
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  get(w, quoteId, version) {
    id(quoteId);
    const q = this.db
      .prepare("SELECT * FROM quotes WHERE workspace=? AND id=?")
      .get(w, quoteId);
    if (!q) fail("NOT_FOUND", "Quote not found", 404);
    const v = this.db
      .prepare(
        "SELECT * FROM quote_versions WHERE workspace=? AND quote_id=? AND version=?",
      )
      .get(w, quoteId, version ?? q.current_version);
    if (!v) fail("NOT_FOUND");
    return {
      ...JSON.parse(v.body),
      status: v.status,
      approval: v.approval ? JSON.parse(v.approval) : null,
      revision: q.revision,
      currentVersion: q.current_version,
    };
  }
  list(w, project, after = "", limit = 50) {
    const rows = this.db
      .prepare(
        "SELECT id FROM quotes WHERE workspace=? AND (? IS NULL OR project=?) AND id>? ORDER BY id LIMIT ?",
      )
      .all(w, project ?? null, project ?? null, after, limit + 1);
    return {
      items: rows.slice(0, limit).map((r) => this.get(w, r.id)),
      hasMore: rows.length > limit,
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  policy(w, productId) {
    const r = this.db
      .prepare(
        "SELECT body FROM quote_policies WHERE workspace=? AND product_id=?",
      )
      .get(w, productId);
    return r ? JSON.parse(r.body) : null;
  }
  event(scope, q, action, body = {}) {
    this.db
      .prepare(
        "INSERT INTO quote_events(workspace,quote_id,version,action,actor,at,body) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        scope.workspaceId,
        q.quoteId ?? "",
        q.version ?? 0,
        action,
        scope.actor,
        new Date(this.erp.clock()).toISOString(),
        canonical({ ...body, nativeCallId: scope.callId ?? null }),
      );
  }
  prior(scope, input) {
    const r = this.db
      .prepare(
        "SELECT * FROM quote_requests WHERE workspace=? AND actor=? AND request=?",
      )
      .get(scope.workspaceId, scope.actor, input.requestId);
    if (!r) return null;
    if (r.digest !== sha(input)) fail("IDEMPOTENCY_CONFLICT");
    return {
      receipt: JSON.parse(r.receipt),
      current: r.quote_id ? this.get(scope.workspaceId, r.quote_id) : null,
      replayed: true,
    };
  }
  command(scope, input, fn) {
    id(input.requestId, "requestId");
    integer(input.expectedRevision, "expectedRevision");
    scope.check();
    return this.transaction(() => {
      const prior = this.prior(scope, input);
      if (prior) return prior;
      const value = fn();
      scope.check();
      const receipt = {
        requestId: input.requestId,
        action: input.action,
        id: value?.quoteId ?? null,
        at: new Date(this.erp.clock()).toISOString(),
      };
      this.db
        .prepare("INSERT INTO quote_requests VALUES(?,?,?,?,?,?)")
        .run(
          scope.workspaceId,
          scope.actor,
          input.requestId,
          sha(input),
          value?.quoteId ?? null,
          canonical(receipt),
        );
      return { receipt, current: value, replayed: false };
    });
  }
  cas(scope, input) {
    const q = this.get(scope.workspaceId, input.quoteId);
    if (q.revision !== input.expectedRevision || q.version !== input.version)
      fail("REVISION_CONFLICT");
    return q;
  }
  add(scope, input, body) {
    const w = scope.workspaceId,
      quoteId = input.quoteId ?? `quote_${randomUUID()}`;
    let version = 1;
    if (input.quoteId) {
      const q = this.get(w, quoteId);
      if (q.revision !== input.expectedRevision || q.status === "sending")
        fail("REVISION_CONFLICT");
      if (
        q.rfqRef !== body.rfqRef ||
        q.buyerId !== body.buyerId ||
        q.projectId !== body.projectId
      )
        fail("QUOTE_IDENTITY_IMMUTABLE");
      version = q.currentVersion + 1;
      this.db
        .prepare(
          "UPDATE quotes SET revision=revision+1,current_version=? WHERE workspace=? AND id=?",
        )
        .run(version, w, quoteId);
    } else {
      if (input.expectedRevision !== 0) fail("REVISION_CONFLICT");
      this.db
        .prepare("INSERT INTO quotes VALUES(?,?,?,1,1)")
        .run(w, quoteId, body.projectId ?? null);
    }
    const record = {
      ...body,
      quoteId,
      version,
      workspaceId: w,
      createdAt: new Date(this.erp.clock()).toISOString(),
    };
    this.db
      .prepare("INSERT INTO quote_versions VALUES(?,?,?,?,?,NULL)")
      .run(w, quoteId, version, canonical(record), "review_required");
    this.event(scope, record, "proposed", {
      snapshotSha256: record.sourceSnapshotSha256,
    });
    return this.get(w, quoteId);
  }
  status(scope, q, status, details = {}) {
    this.db
      .prepare(
        "UPDATE quote_versions SET status=?,approval=COALESCE(?,approval) WHERE workspace=? AND quote_id=? AND version=?",
      )
      .run(
        status,
        details.approval ? canonical(details.approval) : null,
        scope.workspaceId,
        q.quoteId,
        q.version,
      );
    this.db
      .prepare(
        "UPDATE quotes SET revision=revision+1 WHERE workspace=? AND id=?",
      )
      .run(scope.workspaceId, q.quoteId);
    this.event(scope, q, status, details);
    return this.get(scope.workspaceId, q.quoteId);
  }
  outbox(w, quoteId, version) {
    const r = this.db
      .prepare(
        "SELECT * FROM quote_delivery_outbox WHERE workspace=? AND quote_id=? AND version=?",
      )
      .get(w, quoteId, version);
    return r
      ? {
          ...r,
          body: JSON.parse(r.body),
          result: r.result ? JSON.parse(r.result) : null,
        }
      : null;
  }
}
