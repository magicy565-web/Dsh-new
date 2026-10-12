# Product traffic connector v2 — parent integration contract

Implemented independently from backend source `08a760c045474ed92244bf2ac01e883d91a0a17d` (PR45). PR46 remains the selected unified client. This branch adds only the traffic modules, their ordinary business test and this contract/evidence. The Shopify writer in PR48 can be integrated independently. There are no changes to `server/index.mjs`, supplier service/monitoring, original scheduling/Store, Shopify writer/reader, root dependencies or clients.

The shipped adapter performs real GA4 Data API `checkCompatibility` and `runReport` HTTP requests when the original host supplies an existing reviewed authorization. The default is unconfigured, with null metrics. Local test responses are fixtures only; this work has not established a real shop, GA4 property, credential, collection pipeline or seven-day performance result.

## Source decision and official limits

Official references checked 2026-10-12:

| Source | Product attribution and limits | Implementation decision |
| --- | --- | --- |
| [ShopifyQL sessions schema](https://shopify.dev/docs/api/shopifyql/latest/schemas/sessions_and_behavior/sessions) | Session grain; no `product_id` dimension in the examined 2026-10 schema. `landing_page_path` describes the first page. `products_viewed` counts distinct products across visits, rather than visits to a selected product. | Unsupported as exact-product detail traffic. No whole-store sessions query or invented field. Landing sessions could be a separate metric with separately verified path mappings; this adapter does not relabel them as all visits to a product. |
| [ShopifyQL Admin query](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/shopifyqlQuery), [requirements and latency](https://shopify.dev/docs/apps/build/shopifyql/graphql-admin-api) | Existing `read_reports`, protected customer data Level 2 and eligible API capability are required; data is not real time. An order/product read grant does not grant reports. | `shopifyProductTrafficCapability` consumes the original client's capability observation without a live call. Even reports + Level 2 cannot supply the missing product dimension. No permission expansion. |
| [Shopify Web Pixels product_viewed](https://shopify.dev/docs/api/web-pixels-api/standard-events/product_viewed), [pixel privacy](https://shopify.dev/docs/api/web-pixels-api/pixel-privacy) | Documented event ID, timestamp, client ID and `data.productVariant.product.id`. Event subscriptions are a feasible product source if an authorized event store already exists; consent affects availability. This is not a historical Admin event-reading endpoint or a Shopify session ID. | An existing authorized event store can be a future adapter. No pixel creation, tracking installation, collection endpoint, customer identifier upload or script is included. |
| [GA4 dimensions/metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema), [runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport) | `itemId` plus `itemViewEvents` counts recorded detail-view events. `itemsViewed` is units and `sessions` is a different measure. Requires an existing property grant and verified tagging/mapping. | Real read adapter for one reviewed item ID per Shopify product. No SKU/name/variant-number inference. No sessions or product conversion rate is derived. |
| [checkCompatibility](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/checkCompatibility), [response metadata](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData) | Property-specific dimension/metric combinations may fail. Core reports expose timezone, sampling, thresholding, other-row loss, truncation and restrictions; they do not provide a completed-ingestion timestamp. | Exact combination checked before every new sample. Unsupported combinations return null; no broader fallback. Pagination and quality metadata are validated. UTC property only in v2. |

The capability inspector reports `configured`, original store verification and granted scopes separately. A token, `read_orders`, `read_products`, or a configured pixel alone is never treated as proof of existing product traffic data. It neither calls `verify()` itself nor configures authorization.

## Fixed Workspace and reviewed source binding

`createGa4ProductTrafficAdapter({binding, getAuthorization, fetchImpl?, clock?, pageSize?, maxPages?, maxCachedSamples?})` is exported from `server/product-traffic-ga4.mjs`. It has no external package dependency and uses Node 24 fetch. Construction/status are network-free. `binding:null` or no authorization provider produces `unconfigured`.

The host supplies a trusted server-side binding after the user confirms the store/domain and an existing source has been reviewed:

```js
{
  workspaceId,             // original fixed Workspace identity
  shopId,                  // exact verified gid://shopify/Shop/...
  shopDomain,              // exact verified canonical ...myshopify.com domain
  propertyId,              // existing numeric GA4 property ID, string
  hostNames,               // reviewed storefront hostnames for this shop only
  mappingRevision,         // immutable review/configuration version
  authorizationReviewed: true,
  products: [{
    productId,             // exact gid://shopify/Product/...
    itemId,                // one GA4 item_id representing this whole product
    collectionStartedAt,   // UTC instant from an actual reviewed collection record
    evidenceRef            // internal mapping review reference; never a credential
  }]
}
```

No sample binding or credential is installed. Input is copied and pinned; mapping or host changes create a new adapter ID/fingerprint and require the original monitor scope to be reconfigured/approved. Item IDs and product IDs must each be unique. Multiple variant item IDs cannot be summed as one product's event count: one event can contain several items. Properties emitting only per-variant item IDs require a separate reviewed source/method, not an inferred sum.

`getAuthorization({workspaceId,shopId,shopDomain,propertyId,signal})` returns a **fresh original capability check** on every read/replay:

```js
{
  authorized: true,
  workspaceId, shopId, shopDomain, propertyId,
  scopes,       // already granted analytics.readonly or analytics OAuth scope
  expiresAt,    // UTC expiry of the supplied existing access token
  accessToken   // server memory only, omitted from all DTOs/Store outputs
}
```

The callback is the existing host authorization facility, not a token creator, grant installer or automatic scope request. All identities, scope and expiration must match. Expiration is checked again before each page. Revoked/missing authorization returns `unconfigured` and null even for a cached sample. Original host ownership/approval/fence checks remain required before invoking the adapter and before persisting the result. The adapter never opens a shop domain: all of its HTTP calls use the fixed Google Data API hostname, with redirects rejected and bounded responses/timeouts. No live call was made during development.

## Read and metric DTO

```js
const scope = {
  workspaceId, shopId, shopDomain, productId,
  from, to,     // original elapsed UTC [from,to), maximum seven days
  sampleKey,    // original monitor check/request identity; not a new scheduler ID
  signal        // original cancellation signal, optional
};
const traffic = await adapter.readProductTraffic(scope);
// Before original durable check persistence:
validateProductTrafficObservation(traffic, {...scope, adapterId: adapter.id});
```

The validator is exported from `server/product-traffic-contract.mjs`. It enforces the exact original identity/window/key, source version, metric semantics, nullable count and coverage; it never rewrites a result into sessions. Invalid caller ranges/IDs throw `PRODUCT_TRAFFIC_SCOPE_INVALID`; a reused original key for a different scope throws `PRODUCT_TRAFFIC_IDEMPOTENCY_CONFLICT`. Source/configuration/authorization failures return a typed nullable observation.

| Field | Meaning |
| --- | --- |
| `contractVersion:2` | Explicit opt-in to the new metric DTO; incompatible with v1 integer sessions validation. |
| `source` | Adapter ID, `ga4_data_api_v1beta`, property ID, mapping revision. No raw customer data or token. |
| `workspaceId/shopId/shopDomain/productId`, `attribution` | Original exact product identity, `exact_product_id` backed by the pinned reviewed item mapping. |
| `sampleKey/requestFingerprint` | Original check identity and digest of adapter plus immutable request scope. |
| `metrics.productDetailViews` | `{value:number|null,status}`; recorded product detail event count from `itemViewEvents`. Repeated detail-view events count again. This is not unique visitors, sessions, units or sales. |
| `metrics.sessions` | Always `{value:null,status:'unsupported'}`. |
| `metricDefinitions` | Inspectable names, units, definition, source metric and official reference. |
| `requestedWindow` | Original `[from,to)`; never moved to a convenient calendar-day window. |
| `coverage`, `granularity:'minute'` | Only complete minute buckets inside the original request and after reviewed collection start. Subminute edges are omitted and flagged; no outside data is counted. |
| `sampledAt` | Time this read completed; an exact replay retains the original observation time. |
| `freshness:'unknown'`, `dataLagSeconds:null`, `complete:false` | GA4 exposes no measured ingestion completion/watermark. Fetch time or assumed 24/48-hour delay does not establish completeness. Late data may revise counts on a new check. |
| `completePagination` | Whether the bounded report rows were fully read and verified; independent of source ingestion completeness. |
| `sampling` | Source-provided counts as decimal int64 strings and rate = samplesReadCount / samplingSpaceSize. Unsampled reports explicitly report false. Counts are used as returned; no local expansion/scaling. |
| `quality` | Provisional flag, thresholding, other-row loss, truncation and limitation codes. Consent/tagging coverage is unknown, even for unsampled reports. |
| `diagnostics` | Number of report pages and rows, not performance metrics. |
| `error` | Safe stable code only; no remote error message, credential or raw response. |

Statuses:

- `unconfigured`: source/provider/auth review is absent, token expired/rejected, or property inaccessible. Value null.
- `unsupported`: product mapping absent, fixed store mismatch, query incompatibility, or non-UTC property. Value null; no query broadening.
- `no_data`: no collected complete-minute window or no recorded rows. Value null; an empty successful report cannot distinguish no visits from missing instrumentation/consent.
- `unavailable`: network/rate limit/malformed response, duplicate or changed report bucket, pagination cap, cancellation. Value null; incomplete rows never become a final count.
- `partial`: a fully paginated acknowledged source observation, including sampled/thresholded/truncated observations. Numeric values retain these limitations. A restricted metric remains null. An explicit source row with zero may return provisional zero; absence never generates zero.

UTC is deliberately bounded: `metadata.timeZone` must be `UTC`/`Etc/UTC`. Dates and minute filters are then exact. Non-UTC/DST properties return unsupported instead of pretending UTC dates are equivalent. The adapter neither changes the property's timezone nor guesses an offset. The official metric/dimension combination is checked at runtime; if the particular property rejects `itemId + hostName + dateHourMinute + itemViewEvents`, the result is unsupported, rather than a fallback to store totals.

## Deduplication, ordinary sampling and correction

Same original `sampleKey`/scope coalesces concurrent API reads and replays a bounded in-memory receipt. Fresh authorization is checked before every replay. New original check keys re-read the whole cohort and replace its observation, permitting later corrections without adding the new count to the old count. Errors/cancellation are not cached as successful results. Responses are copied so a caller cannot mutate a receipt.

GA4 Core results are aggregate buckets, not raw event IDs. Each `(itemId,hostName,dateHourMinute)` must occur once. Duplicate/conflicting buckets, changing row counts/quality or incomplete pagination produce null; they are never double-counted. The connector cannot deduplicate duplicate events already sent by a merchant's existing tags and does not claim otherwise. A future existing-pixel event adapter must deduplicate actual documented event IDs within the fixed shop, rather than inventing sessions from client IDs.

The in-memory optimization is bounded (default 128 receipts/active samples, 1000 rows/page, 12 pages/read) and is not a durable execution engine. After restart or eviction the original Store monitor-check receipt must provide exact replay and scope-conflict protection. The host's current original run/cancellation fences govern persistence. A source read alone never approves/starts a schedule, creates a Goal, sends a notification or calls Pi.

## Shared integration required from the parent backend

The `08a760c` `supplier-monitoring.mjs` accepts only `traffic.sessions` as a nonnegative integer and copies only sessions/coverage/time. Passing this adapter directly to that validator would yield `SUPPLIER_TRAFFIC_ATTRIBUTION_INVALID`; coercing null or views to sessions is forbidden. This branch deliberately does not change it.

Parent integration must:

1. Accept `contractVersion:2` explicitly and validate the complete typed result with the original Workspace, verified shop/domain, product, cohort and original request key/adapter ID.
2. Inject the configured adapter/provider using existing reviewed facilities. Until store/GA4 source/mapping authorization is confirmed, preserve `unconfigured`/`unsupported` and null.
3. Pass the original cancellation signal and `sampleKey`, persist the DTO in the same existing durable check, and keep original lease/revision/owner fences and exact request replay. Pin the changed adapter ID in the original scope hash. No new engine/dependency is needed.
4. Preserve the new statuses, definitions, source, independent coverage/time and quality metadata in sample/summary output; show **product detail view events**, with provisional/partial labels. The source has no final-completeness proof. Sessions remain null. Product traffic includes the product as tagged, not a selected subset of sales variants; do not invent a product/variant conversion rate.
5. Correct the same original seven-day summary/message on later samples using semantic observation content (count/coverage/quality), keeping original `messageId/notificationCount=1`. A different sample time alone must not create another final notification.

The parent may cherry-pick the implementation commit onto PR48 or the selected combined branch. Do not rebuild from main or copy historical PR44/client/backend combinations. No root dependency, `.env`, production endpoint, shared route, writer, scheduler, Store migration or frontend change is requested from this branch.

## Ordinary validation and remaining gaps

Command: `node --test test/product-traffic-ga4.test.mjs test/supplier-profile.test.mjs`.

Current result: 20/20 passed, 0 fail/skip (16 new flow tests and 4 unchanged supplier profile regressions). Includes real local HTTP fetch serialization, exact product/host/window, null handling, source zero, authorization/revocation/expiry, compatible schema, pagination, sampling/threshold/truncation, request replay/concurrency, late correction, cancellation/recovery and schema rejection. `node --check` passed for both modules and the test; `git diff --check` passed. [Saved ordinary test output](validation/product-traffic/ordinary-tests.txt).

Initial test development exposed a test request exceeding seven days by 42 seconds (corrected test scope) and a cancellation/cache bug (fixed in code; same-key recovery regression now passes). These earlier failures are not passing results. Baseline supplier monitoring could not start because this isolated worktree lacks `@earendil-works/pi-agent-core`; no full backend/combined client regression, dependency installation or production acceptance is claimed.

Remaining gaps: confirmed fixed shop/storefront domains and mode; a real existing authorized GA4 source and UTC property; independently reviewed item mapping/tagging/collection start; parent v2 integration/ordinary combined tests; actual seven-day source observations. Shopify pixel event-store availability is unknown. ShopifyQL exact-product sessions remain unsupported. No credential/grant creation, permission expansion, merchant tracking installation, production probe/deployment, paid call or customer data upload occurred. The blocked independent security review was not retried, renamed or replaced by these ordinary business tests.
