# Cnsubscribe supplier service — configuration and capability boundary

This is the existing single-process Workspace service extended with a supplier plugin. Pi Agent SDK 1.1.0 owns Agent/LLM/tool execution; pi-durable 1.1.0 owns execution checkpoints/recovery. The original Workspace business Store owns identity, exact approvals, task/schedule plans, budgets, product/library/file receipts and monitoring results. No replacement Loop, DAG, model transport, execution persistence, commercial database, token map or scheduler is introduced. Original Muse/Dot remains a compatibility boundary; the default install/start does not require DSH source or Host. Pi-durable production behavior still needs the actual production environment acceptance; local fixtures do not establish that evidence.

## Install and start

Use Node 24+, `npm ci`, `npm run build`, `npm run build:mini`, then `npm start`. Keep the original private data directory and its exclusive single-writer lock; restore the same durable data rather than creating replacement tasks. The original server stays on loopback; use the existing reviewed authenticated TLS ingress for enterprise operation. This development did not deploy or wake the intentionally stopped Huawei host.

The existing reviewed model configuration enables Pi intake. Without it the admitted original run is blocked and saved; explicit structured `facts` still work without a model call. No demo response or invented product/performance is returned. Never place a real key in conversation, client source or Git.

## Shopify

Reuse existing host-only `WORKSPACE_SHOPIFY_SHOP_DOMAIN` and `WORKSPACE_SHOPIFY_ADMIN_TOKEN` configuration. This work creates neither a credential nor a scope. Shopify Admin GraphQL version remains pinned to `2026-10`; identity, API version and granted scopes are verified by the original client before reads. Product observation needs existing `read_products` (or existing write_products); quantity monitoring needs existing order read access. Older than 60 days requires already granted read_all_orders; otherwise it is blocked. No automatic permission expansion occurs.

Current implemented Shopify operations are **reads**: exact existing product/publication/variant observation and complete bounded seven-day order cohorts. Observation has `writeReceipt:null` and identifies a user-selected existing product; it cannot prove this generated preview was created or published. The first successful shop identity stays bound across recovery, and a changed product/variant/shop binding is blocked.

`shopify-draft` is an implemented blocked boundary: without configuration SHOPIFY_SETUP_REQUIRED; with configuration SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED. There is no registered product-create, variant-write, media-upload or publication writer in this milestone. Supplying an admin token alone cannot enable them. Preview, externally observed DRAFT, unpublished and published remain different states. Future remote draft/media transfer/publication needs a separately implemented and reviewed original approval adapter; no mutation was executed here.

## Seven-day tasks

Create a monitor through the contract with a verified actual online-store publication timestamp or an explicitly selected timestamp. Configuration persists one monitor, one original Goal and one original disabled Schedule, with stable request receipts and exact scope hash. Duplicate creation/restart does not create another task. Configuration is not monitoring activation.

Use the **existing** schedule flow after the actual owner authorizes it: `POST /api/schedules/:scheduleId/approval`; review the returned exact scope; decide that original approval with confirmed approval; `POST /api/schedules/:scheduleId/enable` with its approvalId. This development enabled only synthetic local fixture schedules. The original scheduler dispatches the registered supplier handler with original schedule revision/claim/definition checks; no model turn occurs. The current cadence is daily, anchored to the saved plan. One delayed occurrence checks the actual current covered interval rather than fabricating missed daily observations.

Each acknowledged sample records an independent sampledAt, creation-cohort interval, pagination completeness, nullable metrics, source and error codes. Exact check replay avoids another read. An interrupted read reuses its frozen interval; recovering an early partial interval after day seven cannot be mislabeled a complete final cohort. Older/out-of-order partial responses cannot replace the newer full-window projection. End-of-window summary edits the same original conversation message on correction, with one final notification projection; its schedule ends. Explicit later checks can correct late refunds/cancellations within the original authorized history window.

Quantity is Shopify sales-unit quantity, e.g. one pack remains one sale unit; consumer pack size is not silently multiplied into sales. Tests, cancellation/refund overlap, removed units and retained currentQuantity are defined in the contract. Product revenue is null in this bounded quantity adapter; whole-order/store revenue is never substituted.

## Traffic and notifications

ShopifyQL read_reports/Level 2 protected customer data is **not** assumed or requested. The examined sessions schema does not give reliable product attribution. Default product traffic is unsupported/unavailable, not zero. The optional `createApp({supplierTrafficAdapter})` injection accepts only an existing explicitly reviewed exact-product reader; validate product/shop identity, independent sampling, interval, delay and completeness. Adapter configuration is separate from actual data availability, and changed adapter identity blocks the original scope. No traffic source or real watch was established here.

Notification implementation is the original conversation message/SSE projection. End summary has one stable message ID and correction revision. External push, email, WeChat subscription delivery and permission acquisition are **not implemented/configured**; status remains `externalNotifications:'not_configured'`. No delivery receipt or live user notification is claimed.

## Existing owner/Worker connectors

The optional `WORKSPACE_SUPPLIER_MCP_ENABLED=false` flag defaults off. When a future authorized host enables it, it reuses original Dot/Muse credentials and approval/task/lease boundaries, never a new token/principal. Worker tools read only an exactly shared preview or explicitly shared current aggregate monitor. Muse's facet cannot claim/mutate a task; original REST handles that. Private image IDs/bytes and supplier costs never enter the Worker preview.

The owner custom Connector factory uses the original authenticated owner/resource grant callback and same service API. That actual unavailable Host/Muse must still be connected and verified by its owner; the factory is not an installed grant or execution evidence. No normal model is substituted for Muse.

Formal independent security review remains blocked by the earlier platform decision and was not retried, renamed or replaced. Ordinary business tests, historical byte preservation and browser fixtures do not replace that review or production/account acceptance.
