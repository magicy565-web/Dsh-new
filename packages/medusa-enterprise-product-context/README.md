# Medusa Enterprise Product Context

Independent vertical plugin for a self-hosted Medusa v2 product catalog.

## Boundary

Medusa owns Product, Variant, Option, Image, Category, Collection, Tag, Price and Inventory primitives. This module owns business context that an AI worker needs to decide whether a product is usable for market development.

## Context data

- buyer_profile
- target_markets
- use_cases
- selling_points
- evidence
- commercial_policy
- missing_evidence
- agent_summary
- readiness_score
- review status and audit fields
- source_hash / review_version

## API

Authenticated admin routes:

- GET /admin/products/:id/context
- POST /admin/products/:id/context
- GET /admin/product-contexts

The server enforces a release gate: status approved requires readiness_score >= 80 and zero missing evidence. The reviewer identity is taken from the authenticated Medusa user, not from an arbitrary browser field.

### Review and edit contract

1. Read `GET /admin/products/:id/context`. It returns `product_context` and a fresh `review_source_hash` for the current context and native product projection. No context means expected `review_version: 0`.
2. Every POST must supply the current `review_version` (0 for first creation). The server advances it by one up to the existing PostgreSQL integer ceiling `2147483647`, then keeps the number at that ceiling. Each save at the ceiling rotates a random revision stamp within the existing source_hash field, including edits and withdrawal. It is an expected version, never a browser-assigned next version; there is no numeric wraparound or overflow.
3. To approve, explicitly send `status: "approved"` and `source_hash` equal to the GET's `review_source_hash`, plus any intended edits. The server checks the source snapshot and release gate, then computes and stores its own hash for the resulting content and new version. Arbitrary/old hashes and stale versions receive 409; failed release gates receive 422.
4. A write without explicit approval removes the approval hash/reviewer/time. At the integer ceiling source_hash retains only a fresh `rev:<random-stamp>:unreviewed` revision fence, which cannot authorize Agent reads. Every POST at that ceiling must also echo the GET review_source_hash, even for withdrawal; clients can always echo it for every write. An approved record edited without a status becomes `ready_for_review`. Explicit `incomplete`, `ready_for_review` and `blocked` records are never released to Agents. Reload and explicitly review after any conflict; there is no automatic retry or approval carryover.

Concurrent existing-record writes use the original module repository's MikroORM manager with a single conditional `nativeUpdate` on `id`, expected `review_version`, the exact previous stored `source_hash` (including null), and `deleted_at IS NULL`. Only one write against a version/hash pair can succeed; the other returns 409. First creation retains the existing unique product relation. No schema/migration, lock store or new database is needed. This direct conditional update does not use the generated service's mutation-event wrapper; event subscriber integration requires separate validation.

## Registration

Register the module in the Medusa application's medusa-config.ts, register the Product Context read-only inverse link under src/links, then run the normal Medusa migration/link synchronization for the application's pinned version.

The existing `apps/medusa-acceptance/medusa-config.ts` registers this package unconditionally. It is not a default-disabled Medusa module. This change does not alter registration, deployment or token configuration. The old `apps/medusa-product-catalog/src/App.tsx` contextPayload omits source_hash and defaults review_version to 1, so it is incompatible with first-create version 0 and explicit approval fingerprints (and ceiling writes). The user selected official Medusa Admin; the main integration owner must choose and adapt the actual authorized caller. This package does not rebuild or patch that old UI.

## Agent boundary

Do not give a worker an Admin JWT or Secret API Key. The intended worker integration is a separate read-only context tool that returns approved Product Context records only. This keeps commerce administration and agent consumption as separate authorization surfaces.

Both `/agent/product-contexts` and `/agent/product-contexts/:id` require the existing explicit read token and recheck status, score/evidence gate, reviewer, positive integer version, matching product identity and the server-computed hash. A stale single item returns 404; stale list entries are omitted. `count` is the number of released items in the bounded fetched page, not a database-wide total. Filtering does not backfill the page. Legacy approvals without the new matching fingerprint fail closed until explicitly reviewed again. No bulk approval or automatic migration is performed.

At the integer ceiling an approved source_hash is `rev:<random-stamp>:<SHA-256>`; elsewhere it remains the SHA-256 digest. The stamp participates in the fingerprint and changes on every save, preventing replay even when content and numeric version return to the same values. The GET review_source_hash remains the fresh 64-character digest for the caller to echo; callers do not construct or parse stored stamps. The SHA-256 fingerprint covers the canonical native Product `id/title/subtitle/handle/description/status/thumbnail`, Variant `id/title/sku` sorted by ID, context readiness score, buyer profile, markets, uses, selling points, evidence (including its source metadata), commercial policy, missing evidence, agent summary, and `review_version`. Object keys are sorted; context array order is meaningful. Notes, audit timestamps and reviewer identity are outside the fingerprint; API edits to notes still advance the version and remove approval. This is snapshot consistency evidence, not an authorization signature, a full Medusa document version or a Library artifact hash. Prices, inventory, options, categories and collections are outside this projection and its hash.

Approval and both Agent reads validate the complete context business fields against the same shared schema, including all string/array element types, evidence objects and strict commercial-policy values. Malformed historical JSON is rejected even if its old hash matches. Approval requires explicit correction; it never strips malformed inherited values and silently reapproves them. Nonapproval saves may retain legacy values for an administrator to correct, but cannot release them. Agent responses retain the existing field boundary. They include the matching `source_hash` and version, but exclude notes, reviewer identity, evidence source locations and arbitrary product metadata. Commercial policy is limited to `moq/trial_quantity/currency/price_min/price_max/lead_time_days/sample_policy`; evidence is limited to `id/label/type/status/sha256/reviewed_at`. Hash validation and projection share the same Product/Variant mapping. No Library synchronization or OMP receipt restoration is implied.

## Reproducible source checks

Use Node 24 and `npm ci --ignore-scripts`, then `MEDUSA_DISABLE_TELEMETRY=1 npm test`. The lock pins Medusa 2.21.2. The package emits CommonJS to `.medusa/server`; `src/admin` is intentionally empty of UI extensions. The compile/contract tests load the actual SDK but use explicit persistence stand-ins. They do not prove a running Medusa instance, migrations, credentials, or OMP disclosure authorization.

The regression suite also sends real loopback HTTP to compiled route handlers using synthetic graph/persistence data, checks both concurrent completion orders, and exercises the installed PostgreSQL ORM query compiler with transport interception and `connect:false`. This is not PostgreSQL execution or a running Medusa application. The manually invoked `test/reproduce-baseline.cjs` demonstrates the original failures against an extracted, compiled fixed baseline; see the dedicated [acceptance handoff](../../docs/MEDUSA-PRODUCT-CONTEXT-ACCEPTANCE-20261018.md) for commands and remaining validation.

The Product Context `product_id` relation has read-only graph joins in both directions. Neither join writes or synchronizes Library data. The original Workspace Library draft projection and this native Medusa catalog retain separate authorities; see `../../docs/OMP-ALL-PLUGINS-INTEGRATION-20261017.md`.
