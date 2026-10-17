import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261017031756 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product_context" drop constraint if exists "product_context_product_id_unique";`);
    this.addSql(`create table if not exists "product_context" ("id" text not null, "product_id" text not null, "status" text check ("status" in ('incomplete', 'ready_for_review', 'approved', 'blocked')) not null default 'incomplete', "readiness_score" integer not null default 0, "buyer_profile" text null, "target_markets" text[] not null default '{}', "use_cases" text[] not null default '{}', "selling_points" text[] not null default '{}', "evidence" jsonb null, "commercial_policy" jsonb null, "missing_evidence" text[] not null default '{}', "agent_summary" text null, "source_hash" text null, "review_version" integer not null default 1, "reviewed_at" timestamptz null, "reviewed_by" text null, "notes" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_context_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_product_context_product_id_unique" ON "product_context" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_context_deleted_at" ON "product_context" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_context" cascade;`);
  }

}
