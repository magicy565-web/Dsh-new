# Cnsubscribe supplier service — configuration and capability boundary

This is the existing single-process Workspace service extended with a supplier plugin. Pi Agent SDK 1.1.0 owns Agent/LLM/tool execution; pi-durable 1.1.0 owns execution checkpoints/recovery. The original Workspace business Store owns identity, exact approvals, task/schedule plans, budgets, product/library/file receipts and monitoring results. No replacement Loop, DAG, model transport, execution persistence, commercial database, token map or scheduler is introduced. Original Muse/Dot remains a compatibility boundary; the default install/start does not require DSH source or Host. Pi-durable production behavior still needs the actual production environment acceptance; local fixtures do not establish that evidence.

## Install and start

Use Node 24+, `npm ci`, `npm run build`, `npm run build:mini`, then `npm start`. Keep the original private data directory and its exclusive single-writer lock; restore the same durable data rather than creating replacement tasks. The original server stays on loopback; use the existing reviewed authenticated TLS ingress for enterprise operation. This development did not deploy or wake the intentionally stopped Huawei host.

The existing reviewed model configuration enables Pi intake. Without it the admitted original run is blocked and saved; explicit structured `facts` still work without a model call. No demo response or invented product/performance is returned. Never place a real key in conversation, client source or Git.

## Shopify

Reuse existing host-only `WORKSPACE_SHOPIFY_SHOP_DOMAIN` and `WORKSPACE_SHOPIFY_ADMIN_TOKEN` configuration. This work creates neither a credential nor a scope. Shopify Admin GraphQL version remains pinned to `2026-10`; identity, API version and granted scopes are verified by the original client before reads. Product observation needs existing `read_products` (or existing write_products); quantity monitoring needs existing order read access. Older than 60 days requires already granted read_all_orders; otherwise it is blocked. No automatic permission expansion occurs.

Implemented Shopify reads include exact existing product/publication/variant observation and complete bounded seven-day order cohorts. Observation has `writeReceipt:null` and identifies a user-selected existing product; it cannot prove this generated preview was created by this service. The first successful shop identity stays bound across recovery, and a changed product/variant/shop binding is blocked.

The original `shopify-draft` compatibility route remains blocked: without configuration `SHOPIFY_SETUP_REQUIRED`; with configuration `SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED`. The separate existing publication service implements draft creation, original image transfer, retail variant write, exact-channel publication and separately reviewed missing-step repair. It requires the original host write flag `WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED=1`, the original explicitly enabled supplier connector, already granted Shopify scopes and the exact original owner approval. An admin token alone enables none of these actions. Use the original `shopify-review`, manual `shopify-decision`, `shopify-execute` and `shopify-reconcile` routes; MCP only wraps review/execute/reconcile, never approval decisions. Unknown/partial writes require read-only reconciliation of their original operation; no automatic retry occurs.

Preview, observed DRAFT, unpublished, partial, uncertain and published remain distinct. A publication operation's receipt intentionally has `publishedAt:null`; its observed online-store metadata is not automatically the monitoring origin. Read `shopify-observation` first, then explicitly configure `startFromPublication:true`. Only that original observation's verified actual publication time can establish this start. No real Shopify mutation was executed in this development.

## Seven-day tasks

Create a monitor through the contract with a verified actual online-store publication timestamp or an explicitly selected timestamp. Configuration persists one monitor, one original Goal and one original disabled Schedule, with stable request receipts and exact scope hash. Duplicate creation/restart does not create another task. Configuration is not monitoring activation.

Use the **existing** schedule flow after the actual owner authorizes it: `POST /api/schedules/:scheduleId/approval`; review the returned exact scope; decide that original approval with confirmed approval; `POST /api/schedules/:scheduleId/enable` with its approvalId. This development enabled only synthetic local fixture schedules. The original scheduler dispatches the registered supplier handler with original schedule revision/claim/definition checks; no model turn occurs. The current cadence is daily, anchored to the saved plan. One delayed occurrence checks the actual current covered interval rather than fabricating missed daily observations.

Each acknowledged sample records an independent sampledAt, creation-cohort interval, pagination completeness, nullable metrics, source and error codes. Exact check replay avoids another read. An interrupted read reuses its frozen interval; recovering an early partial interval after day seven cannot be mislabeled a complete final cohort. Older/out-of-order partial responses cannot replace the newer full-window projection. End-of-window summary edits the same original conversation message on correction, with one final notification projection; its schedule ends. Explicit later checks can correct late refunds/cancellations within the original authorized history window.

Quantity is Shopify sales-unit quantity, e.g. one pack remains one sale unit; consumer pack size is not silently multiplied into sales. Tests, cancellation/refund overlap, removed units and retained currentQuantity are defined in the contract. Product revenue is null in this bounded quantity adapter; whole-order/store revenue is never substituted.

## Traffic and notifications

ShopifyQL read_reports/Level 2 protected customer data is **not** assumed or requested. GA4 exact product/item/host `productDetailViews` is implemented by `server/product-traffic-ga4.mjs`; it reports `itemViewEvents`, not product sessions. Sessions remain null/unsupported. The optional `createApp({supplierTrafficAdapter})` and `supplierTrafficOptions` injections remain available. Adapter configuration is separate from observation availability; a changed adapter identity blocks the original monitor scope.

Ordinary `npm start` now loads `WORKSPACE_SUPPLIER_TRAFFIC_CONFIG_FILE` through `createApp` only when neither explicit adapter nor options were supplied. The file is existing metadata, not an inline credential or executable module:

```json
{
  "version": 1,
  "binding": {
    "workspaceId": "existing-workspace-id",
    "shopId": "gid://shopify/Shop/123",
    "shopDomain": "existing-shop.myshopify.com",
    "propertyId": "123456",
    "hostNames": ["existing-store.example.com"],
    "mappingRevision": "existing-reviewed-mapping-revision",
    "authorizationReviewed": true,
    "products": [{"productId":"gid://shopify/Product/456","itemId":"existing-actual-whole-product-item-id","collectionStartedAt":"2026-10-01T00:00:00.000Z","evidenceRef":"existing-mapping-evidence"}]
  },
  "authorizationFile": "/absolute/private/existing-authorization-snapshot.json"
}
```

These are illustrative metadata placeholders, not verified identities. The bound workspace must equal the current original access configuration. Property/item/host identity and collection history are never inferred. The optional `authorizationFile` names an already maintained private snapshot produced by the original host; the application neither creates nor refreshes it. Its strict schema has `version:1`, `authorized`, exact `workspaceId/shopId/shopDomain/propertyId`, existing granted `scopes`, `expiresAt`, and its existing `accessToken`. Credentials and extra fields are forbidden in the metadata configuration. Neither file enters the Store, artifacts, catalog or Git.

Both paths must be absolute regular single-link files, without symlinks and without group/world permissions on POSIX (for example the original owner-only 0600/0400 mode). Metadata is bounded to 1 MB, each snapshot to 16 KiB. Startup validates metadata without opening the authorization snapshot or calling GA4. Wrong-workspace, malformed or unsafe metadata fails startup with `PRODUCT_TRAFFIC_CONFIG_INVALID`; no alternate configuration is substituted. On each authorized sample the existing snapshot is read and exact identity/expiry/scopes are rechecked. File rotation is observed; missing, unreadable, revoked, expired or mismatched authorization yields unconfigured/null data and no GA4 request.

Catalog reports implemented support separately: absent configuration/provider is `unconfigured`; configured metadata plus provider is only `configured_unverified`, even if its referenced snapshot is missing. Actual source availability, partial coverage, delay and metric values live in sample receipts. With no injected source, historical monitor samples retain unsupported/null traffic. Metadata configuration changes require restart and the original scope review. No live GA4 source or seven-day watch was established here.

The original conversation message/SSE summary has one stable message ID and correction revision. The baseline also contains an optional existing notification host and manual per-scope review/decision/execute flow; that implemented adapter must not be described as automatically configured or delivered. Default external notification status stays `not_configured`. Seven-day future notification consent and durable recipient permission remain pending user approval; this branch neither develops nor exposes those operations through MCP. No real notification or delivery receipt is claimed.

## Existing owner/Worker connectors

The optional `WORKSPACE_SUPPLIER_MCP_ENABLED=false` flag defaults off. When a future authorized host enables it, it reuses original Dot/Muse credentials and approval/task/lease boundaries, never a new token/principal. Worker tools read only an exactly shared preview or explicitly shared current aggregate monitor. Muse's facet cannot claim/mutate a task; original REST handles that. Private image IDs/bytes and supplier costs never enter the Worker preview.

The owner facets are separate from the worker flag and credential. `/api/conversations/:cid/supplier-session-mcp` represents the same original owner HTTP request through the existing enterprise signed ingress, live session, Origin/CSRF, exact method/path/body, recursive privacy and owner/service checks. It reuses the business routes' existing permissions and approvals; no grant, session, credential, identity, listener or environment flag is created. It is unavailable in local no-login mode. Catalog `ownerSessionMcp` distinguishes this session-required route from external plugin configuration.

The external connector route `/api/conversations/:cid/supplier-mcp` still requires the original host's `supplierOwnerMcpBinding.readReviewedScope` for per-call exact grants. The baseline does not supply this resolver; this route reports `SUPPLIER_OWNER_BINDING_REQUIRED` with no session-only fallback. It is not an installed plugin, active grant or verified Host/Muse connection. The closed 15-tool contract and original session/external-grant boundaries are documented in [SUPPLIER-OWNER-MCP.md](SUPPLIER-OWNER-MCP.md). No normal model substitutes for Muse, and no worker token is promoted to owner. These source changes do not enable or deploy a real entrypoint.

Formal independent security review remains blocked by the earlier platform decision and was not retried, renamed or replaced. Ordinary business tests, historical byte preservation and browser fixtures do not replace that review or production/account acceptance.
