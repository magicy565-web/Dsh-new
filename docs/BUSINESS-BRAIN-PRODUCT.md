> 上游设计/交接记录；其中的旧分支、完成状态和历史验证不代表本次验收。当前结论见 [统一插件验收](OMP-ALL-PLUGINS-INTEGRATION-20261017.md)。

# Business Brain product contract

## Product loop
Business Brain is the enterprise decision layer. It does not replace the Pi/OMP runtime, Goals, Worker Desk, Library, Product Library, or the original Workspace store.

**Facts → Signals → Diagnosis → Decision → Recommendation → Goal → Run/Worker → Evidence → Outcome → Review → Brain.**

## UI contract
The mobile home answers one question: **今天，企业最值得做什么？**
It may show at most three action cards. A card must contain a business problem, why it matters now, evidence references, and one next action. Workers are execution resources and are not the primary home navigation.

## Decision contract
A signal is deterministic source observation. A diagnosis distinguishes observation from causal explanation. A decision must contain competing hypotheses and at least one wait/investigate alternative. Cost/contribution arithmetic is scenario-only. No probability, forecast, causal effect, approval, or external execution permission may be fabricated.

## Data contract
- Enterprise Library/Product Library remain authoritative for enterprise facts.
- Existing supply-network observations may be projected through the Business Brain source adapter; no second business database is created.
- Source references are revision/digest bound and revalidated before Brain reads/writes.
- Unknown and pending records remain explicit; they are never silently counted as lost sales.

## Execution contract
A Brain recommendation never directly dispatches a Worker. It opens the existing Goal/Conversation path. External actions remain behind the existing execution, approval, budget, and Worker gates.

## Outcome contract
Every recommendation that is actually acted on should eventually produce an observed outcome metric. Outcome review may be supported, contradicted, or inconclusive. It never claims causal effect unless an independently reviewed experiment system supplies that evidence.

## Current implementation
- `plugins/workspace-goal-intelligence/src/diagnostics.mjs`: source-backed signal/diagnosis projection.
- `plugins/workspace-goal-intelligence/src/decision-planner.mjs`: evidence-first non-executable decision draft.
- `plugins/workspace-goal-intelligence/src/pulse.mjs`: three-card homepage projection.
- `server/business-brain-source-adapter.mjs`: read-only projection from the existing supply-network/product store, with stable daily observation windows and namespaced extra adapters.
- `src/experience/BusinessBrainHome.tsx`: mobile-first Brain home with decision preview and direct Goal bridge.
- `src/experience/BusinessBrainDecisionSheet.tsx`: evidence/hypothesis/options/verification detail sheet.
- `server/goal-brain-http.mjs`: read-only UI projection endpoint.

## Implemented in the current product slice
- Signal → deterministic diagnosis → decision preview is now visible on the homepage.
- A recommendation without a bound Goal can create a normal existing Workspace Goal; it does not dispatch a Worker or bypass approval.
- Saved decisions expose their full decision snapshot on the homepage.
- Brain source revisions use stable completed-day windows so unchanged business data does not become stale on every refresh.
- Composite Brain sources are explicitly namespaced (for example `commerce-cohort:`) instead of sharing IDs with the primary adapter.

## Release gates still required
1. Node 24 install/build and unit tests in an executable environment.
2. Real enterprise Session + authorized Library/Product source validation.
3. Real supply-network inquiry observation validation.
4. Goal creation from a Brain card and continuation in the same conversation.
5. Worker dispatch through the existing Worker Desk only after the existing approval/budget gates.
6. Outcome metric ingestion and review on a later observation window.
7. Multi-tenant durable production storage migration before commercial rollout.