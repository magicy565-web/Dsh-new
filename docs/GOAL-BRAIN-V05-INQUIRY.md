> 上游设计/交接记录；其中的旧分支、完成状态和历史验证不代表本次验收。当前结论见 [统一插件验收](OMP-ALL-PLUGINS-INTEGRATION-20261017.md)。

# Business Brain V0.5 — historical RFQ / inquiry evidence

## Goal

Extend the existing Enterprise Business Brain with a real inquiry progression signal without creating another CRM, inquiry database, Agent runtime, DAG, scheduler, or approval system.

The source is the existing `state.supplyNetwork` inquiry store. Brain only receives a privacy-safe aggregate projection.

## Source contract

The default original Host source is a composite:

- existing `commerce-cohort:*` → Supplier Monitoring / Shopify cohort evidence
- new `inquiry-pipeline:*` → existing Supply Network inquiry evidence

Both are exposed through the single Brain `sourceAdapter` contract (`list/read/current`). A caller-supplied `goalBrainOptions.sourceAdapter` remains an explicit override.

### Inquiry inclusion

An inquiry is eligible for the Brain projection only when:

1. `row.workspaceId === identity.workspaceId`, and
2. `row.createdBy === identity.subject`, **or** a current/historical `share.merchantSubject === identity.subject`.

Draft-only records are excluded.

The adapter may use `createdBy` internally to count unique customers. It never returns buyer IDs.

### Status interpretation

- active shared + no reply → `pending`
- one or more existing replies → `progressed`
- revoked with no reply → `unknown`
- other received-but-unresolved state → `unknown`

`progressed` means only that an inquiry moved forward through an observed reply. It is **not conversion**.

There is no verified inquiry→order linkage in the current Supply Network schema, so diagnostics return:

`conversionStatus: unavailable-no-order-link`

No zero conversion value is manufactured.

### Time windows

The source uses two explicit non-overlapping windows:

- current: last 30 days ending at the adapter clock
- baseline: the preceding 30 days

A baseline is returned only when that prior window contains at least one eligible inquiry.

### Segmentation

The segment is:

- `productId`: exact `listing.productRef.productId` when present; otherwise `unknown`
- `market`: always `unknown` in this source because the existing inquiry's destination is free text and is not a reviewed market field
- `channel`: `supply-network`

No market is inferred from destination text.

### Privacy

Returned Brain metric values contain only:

`metricType, windowStart, windowEnd, eligible, progressed, pending, unknown, segment, baseline, uniqueCustomers`

They do not contain buyer subjects, notes, destinations, reply text, merchant subjects, credentials, or message content.

## Diagnosis rules

`analyzeInquiryPipeline()` treats progression as follow-up observation:

- progression rate is computed only when current and baseline cohorts are both fully observed (`pending=0` and `unknown=0`)
- otherwise comparison is `incomplete-or-unmeasurable-cohorts`
- no trend conclusion is produced from incomplete cohorts
- a negative descriptive progression change can surface a homepage investigation card, but the card explicitly says it does not represent a sales decline
- no causal conclusion, forecast, lost-sale claim, or external action is generated

## Business loop

The resulting path is:

**existing RFQ/inquiry records → privacy-safe Brain evidence → progression diagnosis → mobile pulse → existing Goal/Conversation → existing Pi/OMP Run → existing WorkerDesk/approval path → observed outcome**

Brain does not send a message, approve a quote, create a Worker order, or mutate Shopify.

## Current limitation

This V0.5 source is not yet the complete historical RFQ importer promised by the product concept. It makes the existing structured Supply Network history usable by Brain.

The next historical-import slice can reuse the existing `factory-inquiries` Library/artifact path for explicitly authorized Alibaba/Made-in-China/Excel/Email source documents. That work must normalize into evidence without exposing raw private documents to Brain by default. It must not create a second CRM or replace the Library authority.

## Validation boundary

The implementation includes source, composite, diagnostic and pulse regression tests plus offline smoke checks. Full Node 24, production Host, real enterprise Session, real historical dataset, and real Pi/OMP continuous conversation remain release gates.
## Overdue follow-up evidence

The same inquiry source also emits `inquiry-aging:*` references when the current 30-day cohort contains stale pending inquiries. `stale` means an active shared inquiry with no recorded reply older than 7 days. This is a follow-up urgency observation only.

The aging metric contains `eligible`, `progressed`, `pending`, `unknown`, `stale`, `staleThresholdDays`, and the same explicit product/market/channel segment. It uses the same enterprise/share authorization and privacy boundary as the pipeline metric.

The realtime pulse surfaces `跟进逾期询盘` at high priority with the exact count and threshold. Its action stays in the existing Goal/Conversation and tells Pi/OMP to inspect the original authorized inquiry records through existing Supply/Library tools. Brain itself never receives individual buyer notes or identities.
## Product readiness evidence

The same default composite also exposes one enterprise aggregate `product-completeness:all` from the existing Business Library. It is deliberately a data-readiness signal, not a sales KPI. The projection uses the existing product schema (`name`, `description`, `category`, `skus`, `images`, `supply`, `documents`) and counts missing images, SKUs, documents and enterprise supply fields. Archived products are not active; draft products remain active for readiness checks. Public-reference products are not penalized for missing enterprise supply fields.

The pulse may surface `补齐产品资料` or `建立产品资料`. The action stays in the existing Goal/Conversation and cannot publish or mutate products.