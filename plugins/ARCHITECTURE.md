# Main application and replaceable service boundaries

The product direction is **OMP as the unified main application**. A separate Workspace business server is not a prerequisite for the independent local-materials plugin. The user's own server remains available as a bridge for remote services. This directory migration does not remove the existing reviewed remote adapters or pretend their clients have already been replaced.

The seven migrated packages retain compatible tools and original client/receipt contracts. Six default entries remain unconfigured for private/service operations without a reviewed client and authorization; public factory field drafts remain local. This is the current adapter implementation, not a requirement that every future service run inside the legacy Workspace application.

For the seven-day verification direction, Shopify operations are intended to be separate **MCP services on the user's cloud computer**, reached through the user's server bridge and chosen by the Agent according to intent. Project query interfaces and long-running task state remain explicit product capabilities; operating steps are not hardcoded into a Skill, queue or Agent Loop. None of that MCP connection or deployment is completed by this migration.

## Required adapter changes, not implemented here

1. Define and discover the actual authorized MCP tool schemas/endpoints on that cloud computer; identify bridge routing, existing identity and cancellation semantics. Do not guess URLs, credentials or scopes.
2. Implement a replaceable client adapter from the current plugin client methods to those bridge/MCP tools. Keep tool names/inputs stable where their meaning matches; expose any changed authority or asynchronous semantics explicitly.
3. Normalize actual MCP receipts into the existing source/version/hash, model-receiver authorization, partial/error and query/status contracts. Cached-context reauthorization/refresh must still check the current authority and source; an MCP connection alone is not permission to disclose material or publish.
4. Route long-running work and queries through existing task identity, state transitions, idempotency, cancellation and receipt persistence. Do not create another queue, status database, approval engine or model loop. Service orchestration remains intent-driven rather than a mandatory seven-day operating script.
5. Preserve original human approval and actual publication/monitoring evidence distinctions. A prepared draft, MCP tool invocation, bridge connection or simulated test does not establish a live Shopify publication, acquisition start, order, revenue or a completed seven-day experiment.
6. Add focused adapter/authorization/recovery tests before a separately authorized integration test against real services. No deployment, credentials, authorization creation, paid model call or real Shopify action is included here.

Current independent local capability and package loading can be used without those remote service adapters. See each package's README/AGENTS/Skill for its present contract, and the existing server query/task implementations for compatibility references.
