# Independent Personal Agent delegation contract (v0.1.0)

This is an **optional host-independent policy library** for Agentive Commerce Network, not a new agent runtime. It complements the Channel Atlas Canvas Kit v0.5.0.

* `createAgentRegistrationProposal`: untrusted HTTPS Agent Card registration candidate, never auto-verifies an Agent.
* `makeWorkOrderProposal`: explicit task actions, typed resource grants, hard budget/TTL, forbidden subdelegation, requires human approval.
* `applyWorkOrderEvent`: authorize / dispatch (DSH taskRef) / claim / start / deliver / accept / reject / cancel / stopped / fail. Rejects missing proof, mismatched actor, replay ID collision; cancellation remains pending until real stop receipt.
* No sending, spending, payment, A2A network calls, execution loop, database, tenant middleware, or web forms.

Security gate: the server **must** authenticate each principal and external Agent signature; `role` and `actorPartyId` cannot be trusted from the caller. Persist with atomic revision compare-and-swap and an outbox; the pure state reducer alone is not a durable multi-party backend.

**Tests:** `node --test packages/domain-commerce-network/test/*.test.mjs` (Node 22+).
**Integration:** Only DSH executes first-party tasks; external Personal Agents remain third-party services routed through a verified Gateway. This module does not replace DeepSeek Harness or merge old single-enterprise account storage into multi-tenant SaaS.
