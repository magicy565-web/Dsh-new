# Workspace 3.0 — five independent development workstreams

No autonomous subagent orchestration was available in this chat. These are **code ownership boundaries and acceptance contracts**, not a claim that five independent agents have been spawned or are running in the background. Each workstream may be assigned to Codex/Work agents in separate branches later. All implementation here is local and synchronous.

| Workstream | Ownership | Output | Acceptance |
|---|---|---|---|
| A. Enterprise architecture | `server/supply-network.mjs`, `server/store.mjs`, design doc | Durable, versioned supplier/inquiry data, scope/identity and roadmap | Invalid input, stale revision, cross-scope, idempotent retry fail closed; no private leakage |
| B. Shopify source ingestion | `server/shopify.mjs`, integration routes | Verified product read, immutable observed source facts | Shop identity/scopes, bounded page, rate/error handling, no automatic source-to-supplier binding |
| C. Sourcing MCP | `server/sourcing-mcp.mjs`, read tools | Independent read-only MCP endpoint | No external writes, no Dot/Muse token reuse, no private record, invalid tool/credential rejection |
| D. Merchant mobile UX | `src/commerce/SupplyNetworkPanel.tsx`, CSS, integration | Supplier/offer, inquiry draft, Shopify and Workers | Truthful states, 320–430px fit, disabled writes on viewer, no misleading success badge |
| E. Worker integration + QA | original Dot/Muse adapters, tests and diagnosis | Reused original bridges, verified local tests | No changes to production/OAuth, original task identity/lease preserved; remote completion only after live attestation |

### Independent review and merge ordering

- A model/schema + security review first.
- B and C can be implemented independently on the frozen A contract.
- D uses stable HTTP contracts but does not import server internals.
- E validates each module separately, then integrated restart, exact receipt and native provider acceptance.
- Production is **single-writer**: never merge or deploy from a development branch until current operator verifies the original production backend revision, original Dot connection epoch, outstanding native lease and storage backup.
- Shopify writes, real buyer RFQ dispatch, billing and Grokbot are not greenfield shortcuts: they need separate reviewed permission and cost gates.

### Suggested follow-on assignments

- `agent/shopify-write-policy`: Shopify Admin scopes, approved mutation preview, store-specific SKU/supplier ownership and idempotent write receipts.
- `agent/sourcing-oauth`: OAuth 2.1 + client-scoped authorization for public MCP, documented trust boundary and tests.
- `agent/worker-live-acceptance`: restore original Dot/Muse connection, inspect immutable task state, and execute one real authorized public task.
- `agent/tenant-hardening`: extract pilot single-enterprise data into PostgreSQL with tenant RLS and explicit buyer/supplier consent.
- `agent/mobile-experience`: tested mobile UX and real browser screenshot validation without rewriting the existing V22 control.
