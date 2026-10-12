# PR56 original conversation / read readiness checkpoint

This adds one compact readiness notice and read-only verification to the existing Muse conversation, preserves the spirit/assets and original business interaction, and directly renders existing handling/shipping facts in the original listing-preview component. No second UI, back-office form, replacement auth, scheduler or new credential flow.

Contract: `docs/SHOPIFY-READINESS.md`. Original authenticated GET `/api/commerce-status` returns `shopify.readiness`; original admin POST `/api/commerce-shopify/verify` checks the original server configuration. Readiness is a five-minute shop-identity-and-granted-product-scope observation, not a catalog fetch/write/publication/notification result. Concurrent clicks share one check. Lost POST response is followed by GET only. Unconfigured, not checked, permissions missing, wrong shop, authorization expired and unknown stay distinct. Page hide/account change clears display cache; reentry reads server state. Server restart loses ephemeral observation and requires rechecking. Read-only status never creates/expands a grant or bypasses exact approvals.

Passed locally, 2026-10-12:

- `npm run build:mini` using installed official `miniprogram-api-typings@5.2.3`: compilation passed. This is not runtime evidence.
- `node --test test/shopify-readiness.test.mjs test/commerce.http.test.mjs`: 15/15.
- `node --test miniprogram/test/shop-readiness-http.test.mjs miniprogram/test/shop-readiness-view.test.mjs`: 7/7.
- `node --test miniprogram/test/*.test.mjs`: 106/106. Includes the existing login-blocking, exact request restoration, approval, cancellation, SHA file, draft/publication/repair, monitoring and notification paths.
- `node miniprogram/test/shop-readiness-http-ui.mjs`: compiled original Page/Client and original WXML/WXSS -> signed local HTTP -> original Shopify adapter; local synthetic Shopify responses, 320/390 widths, real callback handling, no page errors. No automatic Shopify probe on enter; failed check clears green.
- `npm run build` then `npm test`: 661 tests, 654 passed, 7 skipped, 0 failed. First attempt before the required static build failed 9 tests on missing `dist`; no source fix or permission change was needed. This does not claim skipped native-provider/live tests ran.
- Supplier field completeness check uses original preview Component/WXML/WXSS; MOQ/wholesale/production stay internal and sale unit, retail price, handling and shipping remain explicit. See `SUPPLIER-FIELD-CHECK.md`.

The labelled `deliverables/readiness-checkpoint/readable-local-http.png`, `unknown-local-http.png`, and read-only `current-interface.html` are limited Chromium source-renderer runs, not Developer Tools, real WeChat, actual Shopify or real model/Muse execution. Detailed local logs are under `miniprogram/evidence/shop-readiness/` (untracked runtime evidence). This document and runnable tests are committed with the source.

Not passed / blockers:

- No actual WeChat AppID/account/device/Developer Tools runner, production loginBroker/baseUrl, review or subscription permission was supplied. No real account/device testing, deployment or permissions were attempted.
- User declared `vubm17-ak.myshopify.com`; no live read has verified that domain. It is never substituted for observed shop identity.
- Real Shopify/GA4/WeChat notification or continuous seven-day business outcomes were not tested. Local synthetic callbacks/responses are labelled accordingly. Original Muse and Pi cloud execution are not fabricated.
- GitHub Actions run 38284242811 was `startup_failure` with zero jobs; it is not a passing CI result.
- Library helper could not reach hosted Apps MCP `tools/list`: `library upload failed: hosted apps tools/list request failed: network`. No upload preparation, file ID or successful Library delivery exists. Private GitHub is the authorised backup.

Minimum later operator steps: configure the existing approved AppID and HTTPS service/domain; connect reviewed loginBroker to the original enterprise session/role; keep server-only original Shopify authorization bound to the user-declared shop and explicitly run the original admin read check; import the fixed package in actual WeChat Developer Tools and test a real signed account/device. Native notification also needs the existing server recipient binding, exact approved template and a physical subscription click. A text instruction/reference is not an external-send approval.
