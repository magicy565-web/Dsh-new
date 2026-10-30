# Shopify Admin — one enterprise, one real Shopify store

中文配置与运行说明：[Shopify Admin 接入](../../../docs/SHOPIFY-ADMIN-SETUP.md)。

Draft native DSH plugin. Shopify Admin is the enterprise commerce ERP. No custom ERP dashboard, no duplicate inventory/order ledger, no second AI runtime.

Each native DSH enterprise workspace is pinned to a merchant-owned Shopify store. Merchant staff use the actual Shopify Admin for product/SKU, inventory, customer/B2B, pricing, orders, payments and fulfillment. Workspace owns AI conversation, buyer demand/RFQ evidence, channels, approvals and Workers.

## Implemented

- Pinned native workspace ID; a different workspace session is denied.
- Canonical myshopify.com shop validation, workspace/shop uniqueness and exact Shopify Shop GID identity check; no silent cross-tenant migration.
- Standalone/API-only merchant OAuth authorization-code grant with one-time random state, HMAC SHA256 callback, timestamp, registered HTTPS redirect and Shopify identity read-back.
- Expiring offline OAuth token (expiring=1); encrypted AES-256-GCM access/refresh token storage in Host SQLite. Revision-guarded refresh; tokens never returned to model/browser.
- Shopify GraphQL Admin API version 2026-10; native DSH tools shopify_admin_status and shopify_admin_read (shop identity or ten product summaries). Zero Shopify writes.
- Authenticated owner HTTP:
  - GET /shopify-admin-binding/status?sessionId=...
  - GET /shopify-admin-binding/read?sessionId=...&resource=shop
  - POST /shopify-admin-binding/authorize JSON with sessionId and shop
  - GET /shopify-admin-binding/oauth/callback — signed Shopify response
  - POST /shopify-admin-binding/webhooks/app-uninstalled — signed Shopify webhook
- Missing Shopify credentials -> setup_required; never fake a connected shop.

## Installation

1. Merchant owns their Shopify store and controls Shopify staff. Open https://SHOPNAME.myshopify.com/admin for all real commerce work.
2. Create an API-only/non-embedded app in Shopify Dev Dashboard (https://dev.shopify.com), authorize with the merchant OAuth code grant and request only read_products in this first phase.
3. Register exactly https://YOUR-DSH-HOST/shopify-admin-binding/oauth/callback and uninstall webhook https://YOUR-DSH-HOST/shopify-admin-binding/webhooks/app-uninstalled. A real HTTPS callback is mandatory. Configure Shopify privacy compliance separately before public distribution. For multiple unrelated merchant companies use public distribution (review required); custom distribution generally targets one shop.
4. On the PRIVATE DSH enterprise Host configure (never put secret values in chat, browser, Git or ZIP):
   - SHOPIFY_APP_CLIENT_ID = Dev Dashboard client ID
   - SHOPIFY_APP_CLIENT_SECRET = secret manager value
   - SHOPIFY_APP_REDIRECT_URI = exact HTTPS callback above
   - SHOPIFY_BINDING_AES256_KEY = 64 securely generated hex characters (32 bytes)
   - SHOPIFY_ENTERPRISE_WORKSPACE_ID = actual native workspaceRegistry enterprise ID
5. Install in the official DSH Web profile (Node 24+):

    dsh plugin --profile web add link:/absolute/path/to/integrations/dsh/dsh-shopify-admin

6. In a native DSH workspace session, open **Shopify Admin** in the right sidebar, enter the canonical shop domain and follow the Shopify authorization link. The panel calls the authenticated same-origin API with:

    {"sessionId":"current-native-DSH-session-id","shop":"SHOPNAME.myshopify.com"}

   The validated Shopify callback binds the store. Refresh the panel after authorization and open the real Shopify Admin. The native shopify_admin_status and shopify_admin_read tools expose connection state and product summaries; they do not perform Shopify writes.

## Authority and release limits

- All commerce master data and transactions remain in Shopify itself. Historical Mini ERP, Medusa and PR #148/#149 are NOT the new transaction authority. Preserve historical records while preparing a separately reviewed migration; no dual-write or deletion now.
- The native Host requestRejection confirms a valid DSH browser but does not yet prove granular employee owner/staff role. Pinning a workspace reduces cross-workspace exposure. DO NOT run this draft as a shared production multi-tenant service without actor/RBAC and security acceptance.
- No production Shopify shop, API token, orders, stock or customer records were accessed. All offline tests use synthetic response fixtures. Shopify merchant OAuth, installation, HTTPS callbacks, native installed package, webhooks, compliance, remote CI and real store read/refresh must be validated separately.
- Any future transaction write via Agent needs separately approved Shopify scope, exact owner review, versioned mutation, idempotency and Shopify read-back. No automatic model-write permissions.

## Tests

    node --test integrations/dsh/dsh-shopify-admin/test/*.test.mjs
    node --check integrations/dsh/dsh-shopify-admin/index.js

Shopify official documentation:
https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps
https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
https://shopify.dev/docs/apps/launch/distribution
https://shopify.dev/docs/api/admin-graphql/2026-10
https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
