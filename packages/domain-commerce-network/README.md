# Independent Personal Agent delegation contract (v0.2.0)

This is an **optional host-independent policy library** for Agentive Commerce Network, not a new agent runtime. It complements the Channel Atlas Canvas Kit v0.5.0.

* `createAgentRegistrationProposal`: untrusted HTTPS Agent Card registration candidate; outbound-only pull workers can omit the URL. Neither protocol auto-verifies an Agent.
* `makeWorkOrderProposal`: explicit task actions, typed resource grants, hard budget/TTL, forbidden subdelegation, requires human approval.
* `applyWorkOrderEvent`: authorize / dispatch (DSH taskRef) / claim / start / deliver / accept / reject / cancel / stopped / fail. Rejects missing receipt fields, mismatched actor/service/lease, expired execution authority and replay ID collision. Active cancellation remains pending until a real stop receipt.
* `WORK_ORDER_ACTIONS`: the immutable action allowlist used by the service and SDK. It excludes sending messages, quoting, purchasing, payment and subdelegation.
* No sending, spending, payment, A2A network calls, execution loop, database, tenant middleware, or web forms.

Security gate: the server **must** authenticate each principal and external Agent credential; none of `role`, `actorPartyId`, `agentServiceId`, `leaseId` or `now` can be trusted from request JSON. Persist with atomic revision compare-and-swap; the pure state reducer alone is not a durable multi-party backend. Receipt strings are syntax checks, not proof of a signature, human consent, budget reservation or native task execution.

## Trusted reducer contract

The service pins `requesterPartyId`, `providerPartyId` and `agentServiceId` on every work order. The authentication argument must be constructed after credential verification:

```js
// Browser approval, after native DSH authentication and workspace lookup:
{role:'requester', actorPartyId:order.requesterPartyId, now:Date.now()}

// Native dispatch or a server-verified stop/failure receipt:
{role:'host', actorPartyId:'dsh-host', now:Date.now()}

// Pull worker, after scoped token verification and current lease lookup:
{role:'provider', actorPartyId:credential.providerPartyId,
 agentServiceId:credential.agentServiceId, leaseId:verifiedLease.id, now:Date.now()}
```

`claim` requires `leaseExpiresAt` in canonical UTC ISO form, for example `2026-10-28T01:00:00.000Z`, in addition to `claimReceiptId` and `leaseId`. The lease must be future-dated and cannot outlive the order's `expiresAt`. `start` and `deliver` require the current lease in the authenticated context; old or expired leases cannot mutate state or replay a known event. A renewal is a service transaction against the same verified lease; it must not extend past the order TTL.

Authorization is checked **before** idempotency lookup. Duplicate events from the same authorized principal return the current immutable snapshot without incrementing the revision. Changed payloads under the same event ID are rejected. Unknown event fields and inherited property names are rejected. Event receipts and deadlines must be generated or verified by the service, not accepted as evidence merely because the reducer accepts their format.

Order expiry blocks authorize, dispatch, claim, start and delivery. It does not prevent the requester from cancelling, accepting or rejecting an already delivered result. A running worker cannot deliver after `stop_requested`; only verified host stop/failure handling closes that state. Delivery is not acceptance, settlement or a confirmed sale.

Typed resource references restrict the *kind* of allowed data. The service must also resolve each reference inside the correct workspace, check its current disclosure approval and expose only the specifically granted fields. A reference named `approved_document` is not itself evidence of approval.

`accepted_deliverable:<workOrderId>` explicitly selects a predecessor's accepted output. The service must resolve the exact same-project accepted work order, verify its stored artifact/hash, and include the complete disclosed content in the owner's next approval preview. A `dependsOn` relationship grants no output access by itself. Raw or wildcard artifact references are unsupported.

HTTPS URL validation is only a registration syntax check. This package never fetches an Agent Card; any future A2A adapter must verify DNS, public address ranges, ownership and capability before enabling outbound requests. The pull gateway avoids that outbound-request surface.

**Tests:** `node --test packages/domain-commerce-network/test/*.test.mjs` (Node 24+).
**Integration:** Only DSH executes first-party tasks; external Personal Agents remain third-party services routed through a verified Gateway. This module does not replace DeepSeek Harness or merge old single-enterprise account storage into multi-tenant SaaS.
