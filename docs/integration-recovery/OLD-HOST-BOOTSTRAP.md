# Old Host / Pi bootstrap compatibility — offline checkpoint

Date: 2026-10-13 UTC. Based on source `24c37b06284720b4b9d8d7b79dc19d56ef5d51b1` and acceptance head `18cc80aca0f88a68fb96d2f1d960897f8a48dac2`.

## What changed

The existing Pi client requires an authenticated administrator session and an original Muse binding in `/api/bootstrap`. The old native overlay returned its business snapshot without that binding. This checkpoint adds a read-only `readBinding(actor)` to both copies of the native binding, forwards it through the existing `service.muse`, and projects it from the old frontend bootstrap.

A positive projection requires the exact configured subject/nativeAgentId pair, the still-current parent lifecycle epoch, and exactly one existing conversation whose ID, subject and nativeAgentId match the original actor. Missing, malformed, duplicate or foreign records fail closed. Other administrators and viewers receive no Muse conversation identifier. Unauthenticated/unsigned requests retain existing access denial. Missing mixed-version forwarding fails closed. Parent revocation or closure rejects the request. Paused lifecycle permits this read-only identity discovery, not execution.

The discovery does not create a conversation, mutate business state, start a model or Worker, create a credential, sign into an external service, or establish new authority. `onlineVerified` remains false. Existing Pi checks are unchanged.

## Offline verification

- Focused native binding and old-overlay bootstrap: 15 passed, 0 failed.
- Full backend: 704 passed, 8 skipped, 0 failed. The prior fallback baseline was 698/8; six tests were added. The extra historical Git-object skip versus the earlier cloud 699/7 baseline remains unchanged.
- Existing Pi TUI protocol suite: 9 passed, 0 failed.
- Negative control: loading the original old frontend bytes makes the positive Pi connect test fail with `MW_ORIGINAL_BINDING_REQUIRED`. Restoring this patch byte-for-byte passes it.
- Business store write counters remain zero during discovery and denial checks. The temporary access-control fixture still writes its normal disposable session/audit data locally; it is removed after each test and is not included in publication.

The new bootstrap tests execute the actual overlay frontend/native module source and actual signed access-control/session code with the unchanged Pi client. They extract and execute the actual service forwarding method. The repository lacks the complete original Harness service and several modules: tests explicitly substitute its error/field helper, unused legacy Worker/file-gate helpers, and business snapshot; response/body helpers come unchanged from `server/index.mjs`. Static/file routes are prohibited by the fixture. This is not a complete original Harness boot, foreground terminal or real Muse acceptance.

Evidence: `docs/validation/offline-native-bootstrap-20261013/`.

## Remaining prerequisites and scope

1. An existing original conversation must already be in the original business store. If only a Harness Session exists, this checkpoint intentionally reports no binding. A reviewed read-only original Host session resolver would be a separate adaptation; do not create a conversation to make discovery pass.
2. The actual custom-plugin Host login/foreground-TTY integration is absent from this snapshot. It must use its existing authorized owner session and original ingress. The ordinary app's `app.access/app.piMuse` launcher cannot simply be attached to the old `{ctx, service, frontend}` return shape.
3. URL-encoded native identifiers in subsequent delegation routes require a separate compatibility check. Bootstrap discovery alone is not complete task submission/claim/result acceptance.
4. Huawei/server connectivity, live Muse claim/result, real owner terminal, supplier/Shopify/GA4/notification services and device acceptance were not contacted or verified. Server startup and any live-session/credential work remain separate user-controlled steps.
5. This source checkpoint does not regenerate or upload ZIPs. Prior 24c37b portable artifacts remain historical local candidates; their pending upload is unconfirmed. Historical screenshots are not new evidence. No deploy or merge occurred.
