# Original monitor tools and evidence assessment

These additive interfaces ship in `@workspace-agent/pi-market-validation` 0.2.1. Pi 1.1.0 and OMP 18.10.4 remain pinned; no new dependency, scheduler, state ledger, approval system or model loop is introduced. The explicit `market-validation` Host profile admits the tools; ordinary package loading has no ambient member, Library, launch or effect authority.

| Tool | Closed input | Original operation |
| --- | --- | --- |
| `workspace_market_monitor_request` | `requestId`, `planId`, `planRevision`, `launchReceiptId` | Reauthorize exact original owned plan sources and actual acquisition receipt; deduplicate original draft Goal and disabled Schedule; request original `schedule.enable` approval. |
| `workspace_market_monitor_status` | `goalId` | Read original task, latest retained measurement, assessment and exact current schedule approval. Missing evidence is null. |
| `workspace_market_monitor_control_request` | `goalId`, `action: pause/cancel/resume` | Persist/reuse an original Host-bound `monitor.control` approval for the exact task state/schedule revision. Initially `applied:false`; no model approval or execution. Human approves and executes through original endpoints. |

Models cannot provide `confirmed`, `approved`, launch times, budget authority, a Session, credentials, a benchmark value or arbitrary RPC methods. Official OMP may remove unknown keys before calling extensions; a removed flag conveys no authority. The extension and Host both validate the DTO. Tool returns use text `content` plus identical structured `details`, bounded reason codes, and `isError` for blocked/unconfigured. AbortSignal propagates through the private worker RPC to source reads and proposal commit fences. An interrupted already committed draft can remain disabled and be retried by exact references.

The human uses original Session/CSRF endpoints to decide `/api/approvals/:id/decision`, enable `/api/schedules/:id/enable`, and control `/api/goals/:id/market-validation-monitor/control`. Tools never call these mutation endpoints. The original management approvals view supports the control request: approve records permission, then its separate execute button calls the original monitor control endpoint with the original approvalId and human confirmation. A pending or approved-but-unconsumed approval does not collect anything. Pause/cancel retires original schedule consent; resume retains the actual acquisition start and 168-hour end, disables the Schedule and requires new approval. Cancelled tasks cannot resume. Fresh model context rebuilds monitor receipts from live original records, while preserving the original persisted journal. Source/member/receiver authorization is checked before disclosure and effect; cached task, approval and metric fields confer no authority.

Saving a plan or publishing a product is not acquisition. A trusted original acquisition reader must prove its approved actual execution receipt and exact immutable plan. Default reader is null. The seven-day clock derives only from that receipt, never proposal or approval time. No tool launches acquisition. Monitoring is model-free.

## Optional result assessment

The package change is additive; existing tool names and the market-validation engine scope stay unchanged. A 0.1 Host cannot reopen journals containing new monitor tool calls; retain its allowlist fence and start a fresh conversation when rolling back. Do not rewrite or adopt those private journals. Older strict plan readers may reject a plan that uses the new optional field; no silent downgrade removes it.

Existing version-1 plan artifacts without `paths[].resultAssessment` remain valid and return `ASSESSMENT_METRIC_NOT_SELECTED`, not success. New optional selection:

```json
{
  "metric": "sales_units",
  "category": "explicit category",
  "region": "explicit region",
  "channelId": "exact acquisition channel",
  "unit": "net_paid_units_per_168h",
  "benchmarkSourceId": "reviewed original source identifier",
  "benchmarkWindow": { "from": "2026-10-01T00:00:00.000Z", "to": "2026-10-08T00:00:00.000Z" },
  "validVisitDefinition": "explicit bot-filtering, attribution and visit counting definition",
  "minimumValidVisits": 100
}
```

The sample minimum here is illustrative, not a default or statistical guarantee. Alternative metric `conversion_rate` requires unit `net_paid_orders_per_valid_visit`. No implicit metric choice, market average or currency conversion exists. The original plan reader supplies the selection, overriding any conflicting launch callback fields.

The reviewed original acquisition reader may additionally return `marketBenchmark` with **only** `sourceId,evidenceRef,metric,category,region,channelId,unit,windowHours,value,observedAt,evidenceKind,reviewed,validVisitDefinition,coverage`. The comparable window is 168 hours; evidence must be real/reviewed, finite positive, from no later than launch, with exact selected dimensions, source ID and dated coverage.from/to matching benchmarkWindow. Coverage must span exactly 168 hours ending no later than launch; observedAt must acknowledge that complete source window. Conversion benchmarks are fractions, not percentages, and must be <=1. Invalid proof fails closed; missing or incomparable proof reports `COMPARABLE_TRUSTED_BENCHMARK_REQUIRED`. No benchmark is fetched, invented or hardcoded by the adapter.

The existing Host-reviewed outcome adapter can add `resultEvidence` with only `evidenceKind:'real',evidenceRef,paymentStatus:'net_paid_verified',coverageRatio,validVisitDefinition,validVisits,qualifiedInquiries`. Counts are nonnegative measured integers or null. Its already validated exact product/shop/channel/variants, from/to, source ID and freshness cover this evidence too. Complete assessment also requires every original required measurement, with its gaps copied into the assessment; missing required measurement data prevents passed and makes the assessment provisional. Net paid orders and units must agree about zero and units must be at least orders. For conversion_rate, the source must provide at most one attributed net-paid order conversion per valid visit: the selected ratio and benchmark are proportions in [0,1]; multi-order-per-visit raw counts are unsupported for this proportion. Complete assessment requires available, zero-lag full-window outcomes, coverageRatio=1, valid traffic matching the selected definition/minimum, and exact netPaidOrders/netPaidUnits. Shopify retained quantities, all-channel counts, traffic detail views and B2B order counts never substitute for net-payment evidence. Existing adapters without the new evidence remain compatible and insufficient for a pass.

Pure assessment is stored in the existing final monitor summary. `passed` requires at least one verified net paid order and observed selected metric / comparable benchmark >=0.7. It reports source references, compared value, ratio, threshold difference, gaps and recommendations. Below threshold reports `below_benchmark`. No traffic with measured zero orders reports `traffic_anomaly` and recommends checking acquisition/collection. Enough valid traffic plus zero orders and zero inquiries reports `low_demand_pending_review`; inquiries without orders report `strategy_optimization_needed` with possible price/offer/follow-up/checkout review, never a proven causal claim. Missing metrics are null; incomplete windows, coverage, samples and missing comparable benchmark preserve uncertainty. Every assessment retains `goalVerified:false`; original Goal remains `review_required` for human judgment.

## Actual connection gaps

This implementation does not connect a real acquisition execution receipt reader, net-payment/channel-attributed outcome and qualified-inquiry evidence, valid-traffic definition/coverage, or a reviewed comparable market benchmark. The default acquisition reader is null. Existing Shopify retained quantities explicitly have unsupported paid status. Synthetic fixtures tagged to exercise trusted-source contracts are not real payment or acquisition evidence. No paid model, real shop/ads, external messages, new credentials, configuration or real seven-day business acceptance is part of this delivery.

## Confirmed original approval/execution path

`applied:false` is the tool-time receipt: a model proposal has not applied a control. It does not mean that the original human execution path is disconnected. Schedule requests already persist original draft Goal, disabled Schedule and pending `schedule.enable` approval. A human uses the existing approval decision and schedule enable endpoints; only then may the original tick/dispatch claim and complete an observation. Approval alone never enables collection.

Pause/cancel/resume proposals now persist `monitor.control` actions in the same original approval ledger. They bind scopeHash, original task/Goal states, schedule revision and Goal definition hash. No second approval system or ledger exists. The existing human Session/CSRF decision endpoint approves them; the existing monitor control endpoint then consumes that exact approval and atomically retires schedule consent, changes task/Goal state and stores executionReceipt on the same original approval. Exact consumed approval replay returns the same receipt without another mutation. Existing explicit manual human controls without approvalId remain compatible. Both durable proposal tools require the original Run execution intent; read-only Runs cannot persist control requests. Generic HTTP approval creation cannot manufacture a Host-bound monitor.control request. Foreign-member approval records reuse the original recursive ownership guard, including nested payload references. The model receives no Session/CSRF transport and cannot call that endpoint or provide confirmation through its closed tool input. A later Agent status call reads the actual original control/observation state, bounded controlRequests/receipts and latestDispatch from the original ScheduleRun. A recurring tick advances scheduledAt; a live consumed schedule approval is resolved through the original consent reference/revision/hashes rather than lost by comparing its old start time to the next occurrence. Resume still requires a fresh original schedule approval/enable before any new dispatch.

The strengthened original Host/official OMP test exercises proposal, an expired pending approval with a due-but-unclaimed occurrence, refreshed original approval, human approval without enable, human enable, actual original completed ScheduleRun/observation, and Agent query of missing measurements as null. The same Host then executes human pause/resume/cancel after tool proposals, rejects missing human confirmation, proves paused/cancelled schedules do not dispatch, and re-approves/re-enables resume before a second actual observation. The test uses an explicitly synthetic acquisition receipt and original virtual clock; it is engineering verification, not real seven-day execution.

Future FastMoss/Amazon or other paid MCP sources will be user-provided external data services. They are not researched or connected here, and no dedicated business plugin is introduced for them. Missing comparable benchmarks continue to report the explicit connection gap; the 70% metric remains a required explicit selection for assessment.
