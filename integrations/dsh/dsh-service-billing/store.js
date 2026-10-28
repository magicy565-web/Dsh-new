import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
export function migrateServiceBilling(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS service_bills(
 workspace TEXT NOT NULL,id TEXT NOT NULL,project TEXT NOT NULL,mandate TEXT NOT NULL,kind TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(workspace,id));
 CREATE UNIQUE INDEX IF NOT EXISTS service_bill_period ON service_bills(workspace,mandate,kind,period_start) WHERE status!='void';
 CREATE INDEX IF NOT EXISTS service_bill_project ON service_bills(workspace,project,mandate,id);
 CREATE TABLE IF NOT EXISTS service_bill_requests(workspace TEXT NOT NULL,actor TEXT NOT NULL,request TEXT NOT NULL,digest TEXT NOT NULL,bill_id TEXT NOT NULL,PRIMARY KEY(workspace,actor,request));
 CREATE TABLE IF NOT EXISTS service_bill_events(seq INTEGER PRIMARY KEY,workspace TEXT NOT NULL,bill_id TEXT NOT NULL,kind TEXT NOT NULL,provider TEXT,external_id TEXT,body TEXT NOT NULL,UNIQUE(workspace,provider,external_id));`);
}

export class ServiceBillingStore {
  constructor(filename) {
    if (filename !== ":memory:")
      mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;",
      );
      const version = this.db.prepare("PRAGMA user_version").get().user_version;
      if (version > 1) throw new Error("BILLING_DATABASE_NEWER");
      migrateServiceBilling(this.db);
      this.db.exec("PRAGMA user_version=1; COMMIT;");
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      this.db.close();
      throw e;
    }
    if (filename !== ":memory:") chmodSync(filename, 0o600);
  }
  close() {
    this.db.close();
  }
}
