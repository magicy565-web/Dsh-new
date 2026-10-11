# Workspace Agentic Supply Network — engineering design / iteration 1

**Baseline**: the archived V22 `78f155367524b48381d79b2edebe0e5e2925e85d` source, NOT the production deployment. This iteration is a private, **single-enterprise pilot** that does not replace the original Muse/Dot host or state. It is not a production multi-tenant marketplace.

## 1. Product contract

- **Supplier** keeps its own products and approves what is publicly disclosed. A product's indicative price, MOQ, Incoterm and lead-time are not an accepted contract or verified stock.
- **Buyer personal Agent** uses published data without requiring a separate Workspace website. During the private pilot, the MCP facade is **read-only**.
- **Workspace** owns business state, facts, authorization, task budgets, idempotent commands and audit history. An AI model is not trusted to decide permissions or to manufacture facts.
- **Dot** can help with planning/coordination after its original OAuth + connection gates are accepted, **Muse** can carry out reviewed work through its original bridge, and Grokbot remains a separate future reviewed queue adapter. Neither Worker automatically executes because of a catalogue read.
- **Shopify** is one *authorized upstream system*, currently verified and read-only. Product vendor labels are NOT supplier identities, retail prices are NOT FOB quotes, Shopify test orders are NOT commercial sales, and Shopify fulfillment flags alone are NOT independent proof of buyer receipt.

## 2. Current code layout

| Layer | Source | Contract |
| --- | --- | --- |
| Persistent domain | `server/supply-network.mjs` | Supplier, listing, inquiry draft, versioned publications, provenance, idempotency, private Shopify observation. Uses existing serialized Workspace state commits. |
| Shopify adapter | `server/shopify.mjs` | Verified Admin GraphQL API, bounded product page, explicit read_products scope, fixed host/domain/version, no untrusted URLs or writes. |
| Pilot MCP | `server/sourcing-mcp.mjs` | Stateless POST `/mcp/sourcing`, narrow read-only search, supplier detail and change metadata. Separate bearer credential. |
| HTTP route | `server/index.mjs` | Browser routes under `/api/supply/*` require original enterprise session/CSRF/role. Existing `/mcp` (Dot) and `/api/muse-worker/v1` untouched. |
| Merchant experience | `src/commerce/SupplyNetworkPanel.tsx` | Mobile-first supplier/listing CRUD draft, publication confirmation, Shopify observation, private inquiry drafts and honest worker status. |
| Validation | `test/supply-network.http.test.mjs` | Real HTTP with persistent local store, synthetic upstream Shopify response, negative MCP auth and privacy checks. |

## 3. Model, authorization, publication

- `Supplier`: UUID, displayName, country, HTTPS website, createdBy, version, published; **merchant declaration**, no implied verification.
- `Listing`: supplierId, SKU, title, unitPrice decimal string, currency, MOQ, leadDays, Incoterm, description, featured (merchant-selected primary offer), published, revision, updatedAt; explicitly approved disclosures only.
- `Inquiry`: exact listing/revision, quantity/destination, status=draft, sentAt=null, creator; **NOT transmitted to a factory**, no payable order.
- `Event`: immutable publisher/actor/time/IDs; public MCP events expose only public event kind and IDs (not buyer intent, private price updates, or private credentials).
- `Shopify Observation`: private last observed page with source store ID, synced timestamp and all returned variants. No vendor-text-to-supplier matching. No automatic republishing.

Enterprise roles: administrator must create/publish supplier and publish product, operator may create private products and internal inquiry drafts, viewer can inspect according to original single-enterprise viewer policy. A public MCP caller sees **only** published supplier/listing fields; it cannot write, view private orders, or operate Workers.

Every new write carries `requestId`; replaying the same command returns the original receipt. Replaying the same ID with a different body/action is rejected. Publish/update commands compare an explicit expected revision. The internal storage limits are temporary development caps, **not** production throughput design.

## 4. Endpoint contract

Authenticated browser:

- `GET /api/supply/status|suppliers|listings|inquiries|events|shopify/observation|public`
- `POST /api/supply/suppliers` `{requestId,displayName,country,website?}` (admin)
- `POST /api/supply/suppliers/:id/publish|unpublish` `{requestId,expectedRevision,confirmed:true}` (admin)
- `POST /api/supply/listings` `{requestId,supplierId,title,sku,unitPrice,currency,moq,leadDays,incoterm,details?,featured?}` (operator/admin)
- `PATCH /api/supply/listings/:id` `{requestId,expectedRevision,unitPrice?,moq?,leadDays?,details?,featured?}`
- `POST /api/supply/listings/:id/publish|unpublish` `{requestId,expectedRevision,confirmed:true}` (admin)
- `POST /api/supply/inquiries` `{requestId,listingId,quantity,destination,notes?}` (internal draft only)
- `POST /api/supply/shopify/observe` `{requestId,after?}` (admin, verified Store, scope read_products; stores private observation)

Pilot remote MCP `POST /mcp/sourcing` has *only*: `workspace_supply_search`, `workspace_supplier_profile`, `workspace_supply_changes`. It requires a **separate** host-pinned bearer digest; fail-closed and disabled by default. It supports legacy `2025-11-25` initialization and basic tools/list/tools/call. It is NOT complete public ChatGPT/Muse OAuth 2.1 registration, event subscriptions, SSE, A2A or long-running MCP Tasks. Do not expose it as a public installable plugin yet.

## 5. Shopify operating design (future stages)

1. **Source**: native supplier catalog + authorized Shopify Admin GraphQL; observe product/variant changes and store exact source timestamps. Add webhooks with HMAC, durable inbox, dedupe and reconciliation later.
2. **Ownership**: store-specific Product/Variant → legal supplier/fulfiller mappings in Workspace, with one or more authorized sourcing alternatives; Shopify vendor strings are display metadata, not principals.
3. **Planning**: AI Worker can propose product title, pricing test, promotions and listing changes. Workspace validates enterprise policy, exact Shopify write scope, economic guardrails and merchant approval; then an idempotent reviewed adapter performs writes and reads back the result.
4. **Order attribution**: accept only real payment/fulfillment/returns evidence from configured systems; detect test orders and refunds. Audit supplier assignment, cancellation, failed fulfillment and disputes. DO NOT claim every order was delivered merely because a Shopify status says fulfilled.
5. **Commerce ownership**: one Workspace-managed retailer store and supplier-managed stores need different contracts/payment responsibilities; merchant-of-record, settlement, tax, returns and legal ownership must be resolved before using one platform-owned production store for many independent merchants.

These stages are **not yet implemented** by this pilot. No Shopify product mutation, ad spending, order submission, refund, or supplier payout is enabled.

## 6. Speed principle

Synchronous key/filtered lookup reads the Workspace state without an LLM. The optional fast language model should classify a buyer's request and produce validated structured search parameters; it must not become the source of price, inventory or completion status. Long research and multi-source analyses create durable WorkerDesk work after user consent and exact budget/approval. Future scale: PostgreSQL/RLS tenant boundaries, separately indexed search/materialized facts, queue, Redis cache; no reimplementation of existing Harness/WorkerDesk.

## 7. Production gates (not satisfied)

1. Full isolated multi-tenant identity, seller/buyer principal separation and security review; current single-enterprise store CANNOT host independent firms.
2. Shopify own-account legal arrangement, OAuth app install, real store scopes, webhooks HMAC and source-data reconciliation, approved write operation contract and audit.
3. OAuth 2.1 resource/authorization metadata, PKCE and scopes for general-purpose public MCP clients, per-client rate limits, abuse prevention and data minimization.
4. Original Dot OAuth refresh and Events binding must be health-checked against the production **original** hostname; no second identities or silent re-consent. Existing external connector returned internal/OAuth errors during the current work.
5. Original Muse `/api/muse-worker/v1` identity, inbox, claim/heartbeat/upload/submit plus original Harness session provenance and separate human acceptance; test fixtures are NOT proof of live execution.
6. Reviewed/approved Grokbot execution adapter with principal isolation and provider-side hard budget cap, not a cosmetic status badge.
7. Browser build on Node 24, real mobile screenshot/visual tests, security checks, performance benchmark and disaster recovery.

## 8. Local verification

```sh
node --test test/supply-network.http.test.mjs test/commerce.http.test.mjs
node --test test/dot-mcp.test.mjs test/muse-worker.contract.test.mjs
npm ci  # Requires network and Node 24+
npm run build
```

The test fixture's Shopify store, token, suppliers, products and orders are synthetic and cannot be counted as external success. Native underlying Worker adapters and the original service are preserved rather than duplicated.
