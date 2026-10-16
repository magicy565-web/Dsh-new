# Main application and replaceable service boundaries

The product direction is **OMP as the unified main application**. A separate Workspace business server is not a prerequisite for the independent local-materials plugin. The user's own server remains available as a bridge for remote services. This directory migration does not remove the existing reviewed remote adapters or pretend their clients have already been replaced.

The seven migrated packages retain compatible tools and original client/receipt contracts. Six default entries remain unconfigured for private/service operations without a reviewed client and authorization; public factory field drafts remain local. This is the current adapter implementation, not a requirement that every future service run inside the legacy Workspace application.

For the seven-day verification direction, Shopify operations are intended to be separate **MCP services on the user's cloud computer**, reached through the user's server bridge and chosen by the Agent according to intent. Project query interfaces and long-running task state remain explicit product capabilities; operating steps are not hardcoded into a Skill, queue or Agent Loop. None of that MCP connection or deployment is completed by this migration.

Muse and Grokbot are a different boundary: **real Personal Agents tied by the user's server to already authorized accounts, consuming those accounts' quotas**. They must not be reduced to ordinary MCP tools, a provider model alias, a mocked response or a model substitute. Their authorization, delegated work and actual account usage need real receipts; a DeepSeek API token budget does not attest to their account quota. This uninstall repair invokes neither Personal Agent and changes no account authorization.

The seven-day verification module is a **project launcher that establishes budgets, Worker delegation and Goals**, not a hardcoded operating sequence. Its future work should reuse existing task/Goal/receipt and query state; it must not create a second queue or Agent Loop. MCP services, Personal Agents, the user's bridge and the main OMP application have distinct responsibilities. This paragraph records the interface direction only; no new business engineering is implemented in this repair.

## Required adapter changes, not implemented here

1. Define and discover the actual authorized MCP tool schemas/endpoints on that cloud computer; identify bridge routing, existing identity and cancellation semantics. Do not guess URLs, credentials or scopes.
2. Implement a replaceable client adapter from the current plugin client methods to those bridge/MCP tools. Keep tool names/inputs stable where their meaning matches; expose any changed authority or asynchronous semantics explicitly.
3. Normalize actual MCP receipts into the existing source/version/hash, model-receiver authorization, partial/error and query/status contracts. Cached-context reauthorization/refresh must still check the current authority and source; an MCP connection alone is not permission to disclose material or publish.
4. Route long-running work and queries through existing task identity, state transitions, idempotency, cancellation and receipt persistence. Do not create another queue, status database, approval engine or model loop. Service orchestration remains intent-driven rather than a mandatory seven-day operating script.
5. Preserve original human approval and actual publication/monitoring evidence distinctions. A prepared draft, MCP tool invocation, bridge connection or simulated test does not establish a live Shopify publication, acquisition start, order, revenue or a completed seven-day experiment.
6. Add focused adapter/authorization/recovery tests before a separately authorized integration test against real services. No deployment, credentials, authorization creation, paid model call or real Shopify action is included here.

Current independent local capability and package loading can be used without those remote service adapters. See each package's README/AGENTS/Skill for its present contract, and the existing server query/task implementations for compatibility references.


## Independent owner references

Local materials now has an opt-in private enterprise/project file directory: original versions, readable parsed text/tables, canonical reference records with Markdown projections, INDEX and separate proposed business notes. It stays independent of Workspace HTTP and uses original OMP composable tools/Session. There is no vector database, RAG pipeline, fixed intake sequence or additional Agent Loop.

This is owner mode only. Existing server signed identity, revocation, recipient/revision/field authorization and Library review/version machinery were audited as reuse candidates, but no real customer binding is connected to local files. Customer sharing and exports remain blocked until trusted identity and unavoidable disclosure checks cover originals, INDEX, parsed data, references, summaries, memory, history, caches and resumed Sessions. Deny-only fixtures are not two-customer authorization. Muse/Grokbot, seven-day launchers and remote adapters above are unchanged.
