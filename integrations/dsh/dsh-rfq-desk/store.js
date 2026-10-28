import { DatabaseSync } from "node:sqlite";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  chmodSync,
  existsSync,
  statSync,
} from "node:fs";
import { canonical, sha, fail } from "@workspace-agent/dsh-commerce-contracts";
export class RfqStore {
  constructor(file, { keyFile = `${file}.key` } = {}) {
    try {
      this.key = readFileSync(keyFile);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (existsSync(file) && statSync(file).size > 0)
        fail(
          "ENCRYPTION_KEY_MISSING",
          "Restore the matching RFQ key backup; no replacement key was generated",
        );
      this.key = randomBytes(32);
      writeFileSync(keyFile, this.key, { flag: "wx", mode: 0o600 });
    }
    if (this.key.length !== 32) fail("ENCRYPTION_KEY_INVALID");
    chmodSync(keyFile, 0o600);
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    if (this.db.prepare("PRAGMA user_version").get().user_version > 1) {
      this.db.close();
      fail("VERSION", "RFQ database was created by a newer version");
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS rfqs(workspace TEXT NOT NULL,id TEXT NOT NULL,project TEXT,channel TEXT NOT NULL,account TEXT NOT NULL,message TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(workspace,id),UNIQUE(workspace,channel,account,message));
      CREATE TABLE IF NOT EXISTS rfq_requests(workspace TEXT,actor TEXT,request TEXT,digest TEXT,rfq_id TEXT,receipt TEXT,PRIMARY KEY(workspace,actor,request));
      CREATE TABLE IF NOT EXISTS rfq_events(seq INTEGER PRIMARY KEY,workspace TEXT,rfq_id TEXT,revision INTEGER,actor TEXT,action TEXT,at TEXT,body TEXT);
      PRAGMA user_version=1;`);
  }
  seal(value) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, iv);
    const bytes = Buffer.concat([
      c.update(JSON.stringify(value), "utf8"),
      c.final(),
    ]);
    return Buffer.concat([iv, c.getAuthTag(), bytes]).toString("base64");
  }
  open(value) {
    const b = Buffer.from(value, "base64"),
      d = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"),
    );
  }
  get(w, id) {
    const r = this.db
      .prepare("SELECT body FROM rfqs WHERE workspace=? AND id=?")
      .get(w, id);
    if (!r) fail("NOT_FOUND", "RFQ not found", 404);
    return this.open(r.body);
  }
  list(w, project, after = "", limit = 50) {
    const rows = this.db
      .prepare(
        "SELECT id,body FROM rfqs WHERE workspace=? AND (? IS NULL OR project=?) AND id>? ORDER BY id LIMIT ?",
      )
      .all(w, project ?? null, project ?? null, after, limit + 1);
    return {
      items: rows.slice(0, limit).map((r) => this.open(r.body)),
      hasMore: rows.length > limit,
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  prior(scope, input) {
    const r = this.db
      .prepare(
        "SELECT * FROM rfq_requests WHERE workspace=? AND actor=? AND request=?",
      )
      .get(scope.workspaceId, scope.actor, input.requestId);
    if (!r) return null;
    if (r.digest !== sha(input)) fail("IDEMPOTENCY_CONFLICT");
    return {
      ...JSON.parse(r.receipt),
      current: this.get(scope.workspaceId, r.rfq_id),
      replayed: true,
    };
  }
  write(scope, input, operation, now) {
    scope.check();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.prior(scope, input);
      if (prior) {
        this.db.exec("COMMIT");
        return prior;
      }
      const record = operation();
      scope.check();
      this.db
        .prepare(
          "INSERT INTO rfqs VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET project=excluded.project,revision=excluded.revision,body=excluded.body",
        )
        .run(
          scope.workspaceId,
          record.id,
          record.projectId ?? null,
          record.source.channel,
          record.source.accountRef,
          record.source.externalMessageId,
          record.revision,
          this.seal(record),
        );
      const receipt = {
        id: record.id,
        revision: record.revision,
        requestId: input.requestId,
        at: new Date(now).toISOString(),
        action: input.action,
      };
      this.db
        .prepare("INSERT INTO rfq_requests VALUES(?,?,?,?,?,?)")
        .run(
          scope.workspaceId,
          scope.actor,
          input.requestId,
          sha(input),
          record.id,
          canonical(receipt),
        );
      this.db
        .prepare(
          "INSERT INTO rfq_events(workspace,rfq_id,revision,actor,action,at,body) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          scope.workspaceId,
          record.id,
          record.revision,
          scope.actor,
          input.action,
          receipt.at,
          this.seal({
            digest: sha(record),
            sourceSha256: record.source.rawEvidenceSha256,
            review: record.review ?? null,
            contactPermission: record.contactPermission,
            requirements: record.requirements,
            nativeCallId: scope.callId ?? null,
          }),
        );
      this.db.exec("COMMIT");
      return { receipt, current: record, replayed: false };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  sourceMatch(w, s) {
    const r = this.db
      .prepare(
        "SELECT body FROM rfqs WHERE workspace=? AND channel=? AND account=? AND message=?",
      )
      .get(w, s.channel, s.accountRef, s.externalMessageId);
    return r ? this.open(r.body) : null;
  }
  purgeExpired(now, workspace) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let count = 0;
      const rows = workspace
        ? this.db
            .prepare("SELECT workspace,id,body FROM rfqs WHERE workspace=?")
            .all(workspace)
        : this.db.prepare("SELECT workspace,id,body FROM rfqs").all();
      for (const row of rows) {
        const r = this.open(row.body);
        if (r.rawText === null || Date.parse(r.retainUntil) > now) continue;
        r.rawText = null;
        r.status = "closed";
        r.revision++;
        r.candidates = r.candidates.map((c) => ({
          ...c,
          fieldEvidence: Object.fromEntries(
            Object.entries(c.fieldEvidence).map(([k, v]) => [
              k,
              { start: v.start, end: v.end },
            ]),
          ),
        }));
        r.drafts = r.drafts.map(({ content, ...d }) => d);
        this.db
          .prepare(
            "UPDATE rfqs SET revision=?,body=? WHERE workspace=? AND id=?",
          )
          .run(r.revision, this.seal(r), row.workspace, row.id);
        this.db
          .prepare(
            "INSERT INTO rfq_events(workspace,rfq_id,revision,actor,action,at,body) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            row.workspace,
            row.id,
            r.revision,
            "retention-policy",
            "source_purged",
            new Date(now).toISOString(),
            this.seal({ sourceSha256: r.source.rawEvidenceSha256 }),
          );
        count++;
      }
      this.db.exec("COMMIT");
      return count;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
    this.key.fill(0);
  }
}
