# Shopify readiness v1 (PR56)

Use the original authenticated `GET /api/commerce-status` response's `shopify.readiness`. This is a cache projection; GET never probes Shopify. Explicit `POST /api/commerce-shopify/verify` keeps the original administrator role, signed ingress/CSRF, and body `{requestId?: UUID}`. Successful POST returns `{shopify: ...}` including this same readiness object. Failed POST retains the existing safe error response; read GET to see the failure classification. No credentials are accepted from the client.

```json
{"schema":"workspace.shopify.readiness.v1","kind":"not_checked","readConfirmed":false,"shopDomain":null,"targetDomain":"example.myshopify.com","checkedAt":null,"validUntil":null,"missingPermissions":[],"code":null,"evidence":null,"readOnly":true,"writeAuthorized":false}
```

`kind`: `unconfigured`, `not_checked`, `insufficient_permissions`, `store_mismatch`, `authorization_expired`, `unknown`, `readable_ready`.

Readability means the original host-pinned Admin API returned the exact configured shop identity and the granted `read_products` or `write_products` scope. Evidence is `shop_identity_and_access_scopes`, not a product fetch, successful write, live-device test, or expanded permission. `shopDomain` is populated only from a complete validated identity. `targetDomain` is server configuration, not identity proof. Readiness expires after five minutes and becomes `unknown`; cached identity stays labelled with its observation time. Reverification clears old green evidence immediately. 401 means expired/revoked authorization; 403 or GraphQL `ACCESS_DENIED` means insufficient permissions. An accurate different domain means `store_mismatch`. Network, timeout, rate limit, API version mismatch and malformed data mean `unknown`.

Concurrent explicit verification in one server process shares one read. A lost POST response should be followed by GET status, never an automatic repeated POST. Server restart returns configured-but-not-checked. Existing approvals, services, identities and writes are unchanged. This is not an OAuth/onboarding replacement and does not create grants or credentials.

User-declared target: `vubm17-ak.myshopify.com`. It was supplied by the user; no live request has verified it and it is not inserted as a client-side proof or server credential/configuration.

Local validation: `node --test test/shopify-readiness.test.mjs test/commerce.http.test.mjs` — 15/15 passed. Synthetic responses only; no Shopify/production network requests.
