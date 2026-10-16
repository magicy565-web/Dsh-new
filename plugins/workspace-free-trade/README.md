# Free foreign-trade solutions for the existing Pi Host

Private additive package `@workspace-agent/pi-free-trade` 0.1.1. It implements two vertical building blocks: discovering public procurement opportunities and consulting existing ERPNext commercial records. No new Agent, ERP, CRM, database, queue, scheduler or UI. It does not replace `workspace-procurement` or the existing inquiry/Library/Shopify plugins.

## Tools and actual scope

| Tool | Implemented | Not implemented |
| --- | --- | --- |
| `workspace_free_trade_status` | Report configuration state without making requests | Live connection or completed business verification |
| `workspace_tender_search` | One bounded page from official TED or SAM.gov; notice ID, buyer, classification, raw deadlines, canonical source links | Full market coverage, private buyer database, eligibility certification, bidding, contact or automatic monitoring |
| `workspace_erpnext_read` | One exact Quotation, Sales Order, Sales Partner or Item Price; authorized scalar fields only | Arbitrary record search, full ERP deployment, order/price/commission writes |
| `workspace_erpnext_prepare_quotation` | Map explicitly supplied commercial terms to an unreviewed Quotation payload | ERP persistence, master-data validation, price/tax calculation, human approval, sending or order creation |

TED uses its anonymous official search API. SAM requires a legitimate API key and applicable account quota; absent key returns `unconfigured` before network. No commercial data subscription is required by this package. Hosting, model usage and operating an ERPNext instance are not made costless by this adapter. No ERPNext instance or account is installed/created here.

## Installation

Use the project's existing Node 24+ Pi/OMP environment. The package follows the existing `pi.extensions` / `pi.skills` manifest convention; do not install another Agent runtime.

The canonical package is now `plugins/workspace-free-trade`; do not keep a second copy under `packages/`. Default project startup leaves it disabled. Explicit public use through the existing CLI:

```sh
npm run factory:local -- --public-only --plugin-config config.free-trade.json --output-dir /ABS/private/out --session /ABS/private/chat/trade.jsonl --check "只预检公开采购工具"
npm run factory:local -- --public-only --plugin-config config.free-trade.json --output-dir /ABS/private/out --session /ABS/private/chat/trade.jsonl "使用公开产品词查询一页 TED，保留来源和不确定事项"
```

The output and Session parent directories must already exist. `--check` makes zero model requests and creates no Session. Actual inference still requires the original reviewed safe model configuration, prices and budget; the command does not set credentials. No local `--input`, archive, enterprise or project scope may accompany `--public-only`. The original Session binding prevents switching an existing private local Session into this mode. The original request/context/output/tool/budget bounds remain in force.

An ordinary external Pi installation can use `pi install /absolute/path/plugins/workspace-free-trade` and remove it with `pi remove` using the same path. This branch actually tested OMP **18.10.4**, Bun **1.3.14**, Node **24.19.0**, native loading from an outside-repository package copy, disable/restart/uninstall/coexistence and original Session recovery. It did not test another Pi runtime's CLI. Optional wildcard peers avoid installing another SDK and do not claim compatibility with every version.

## Public-only default versus enterprise-controlled mode

Ordinary installation registers four tools. It can query TED and prepare user-supplied quotation data. SAM and private ERPNext remain unconfigured. It reads no environment variables, credentials, private files or Library data. A syntactically configured adapter reports `configured_unverified`, never `connected`.

**Do not use the ordinary entry with private enterprise context.** The original trusted Host must instantiate `freeTradeExtension({enterprise:true, authorize, tenders, erp})`. All non-status tools then require exact model receiver plus an affirmative authorization callback before and after execution. Reading private ERP data always requires this tool-level authorization, even outside enterprise mode.

Exports:

```js
import { freeTradeExtension } from './src/extension.js';
import { createTenderClient, createErpNextClient } from './src/free-trade.mjs';
```

Trusted Host injection contract (no new server route or policy system is defined):

- `createTenderClient({samApiKey?, fetchImpl?, timeoutMs?})`: provide a key only through the existing safe credential channel. Never place it in model arguments, commands, prompts or logs. SAM's official protocol places the key in the request query, so Host proxy/HTTP instrumentation must redact it too.
- `createErpNextClient({baseUrl, apiKey, apiSecret, authorizeRecord})`: fixed reviewed HTTPS origin, existing least-privilege ERP account, no model-selected URL. `authorizeRecord({doctype,name,fields,origin}, signal, receiver)` must return exactly `true`; evaluated before and after each read. The Host must allow the named record's identity as well as requested fields.
- `freeTradeExtension({enterprise:true,tenders,erp,authorize})`: `authorize({tool,input},signal,receiver)` must return exactly `true`. Use the original Session/member/workspace/model receiver and disclosure policy. Public outbound queries require separate disclosure approval; permission to read a private product does not permit sending its details to TED/SAM.
- Missing callbacks, denied scope, revoked rights or cancellation fail closed. Never use `async()=>true` in production. Only a trusted test explicitly enables `allowLoopbackHttpForTests` or substitutes `fetchImpl`.
- The integrated native entry uses the original Host disclosure guards at provider dispatch, model completion and final delivery. It persists bounded provenance in the original private native Session journal, including across compaction; the model cannot select or clear that scope. Source changes, grant narrowing, receiver/session changes or missing trusted proofs refuse reuse. No replacement cache service is created.

## Original Node Host and Bun worker binding

The full original Node Host uses `node:sqlite`, unavailable in the pinned Bun runtime. The integration therefore extends the **existing** Node24-to-Bun private fd3 worker protocol. Original Host identity, current signed Session/member, ERP credentials and record grant checks stay on Node. No ERP key enters the worker, model context, argv or logs.

A trusted in-process resolver selects `createWorkspaceOmpEngineAdapter({paths, configuration, freeTrade:true})` and returns its original readonly Session client/model plus:

```js
freeTradeHost: await app.freeTradeSessionBinding(actor, {
  policy: existingReviewedScope,
  connection: existingSafeErpConnection,
  authorizeRecord: recheckExistingExactRecordGrant,
  authorizeTool: recheckExistingOutboundOrDraftIntent,
})
```

These names represent existing trusted Host inputs, not configuration supplied by the model. Policy requires `enabled:true`, `reviewed:true`, matching `workspaceId` and `subject`, exact `recipient:{kind,provider,model,destination}`, `expiresAt`, fixed `origin` and one to eight `{doctype,name,fields}` selections. Both this selection and the current record callback must allow the exact read. The actual app instance injects its own access, identity and Session client; an OS owner UID is insufficient. The connection is not configured automatically from environment or chat. This branch adds no production ERP instance, account, grant UI or new HTTP endpoint.

Actual successful ERP receipts receive request/body/projection/scope/native-Session hashes. At most eight distinct private projections and sixteen ERP reads (including freshness checks) are admitted per worker turn. Cached receipts are checked before another model request; freshness is checked at dispatch, completion, worker delivery and original Node final delivery. A changed source requires a new reviewed context rather than silently preserving stale text. Private Session files remain trusted Host-owned data; these hashes do not make arbitrary user-edited journals authoritative.

Standalone public Sessions have no private ERP binding. A selected local/private context without this original Host binding blocks non-status outbound operations. Public tender searches from a private Host require separate affirmative current outbound authorization. Missing safe ERP connection returns `unconfigured` with zero ERP network requests.

## Official request mapping

TED input example (explicit query, not an automatically guessed product code):

```json
{"provider":"ted","query":"publication-date>=20261001","page":1,"limit":5}
```

The request uses `POST /v3/notices/search`, selected official fields and `paginationMode=PAGE_NUMBER`. Each call is one page (maximum 10 records); dates, countries, notice types and product codes must be selected for the user's actual goal. A broad example is not a recommended business filter. No guarantee that the returned notice is open or that the factory can bid.

SAM input example:

```json
{"provider":"sam","postedFrom":"2026-10-01","postedTo":"2026-10-16","title":"textile","pageIndex":0,"limit":5}
```

ISO dates become the official `MM/dd/yyyy` parameters. The adapter caps the window at 365 days. `pageIndex` is the official zero-based `offset` page index, not a record skip count; echoed offset and limit must match. Optional `naicsCode` maps to `ncode`, `noticeType` to `ptype`. Award notices, sources-sought and solicitations remain distinct. `active=Yes` never establishes open bidding. No key means no request.

ERPNext reads use Frappe's existing list API with one exact `name` filter and server-side `fields` projection. `name` is included for identity verification; only requested allowed fields are returned. Zero or multiple rows, unexpected identity, nested data or oversized fields are rejected. No complete customer/quotation document is fetched just to discard sensitive fields later.

## Results, persistence and safety

Tender receipts retain notice languages/arrays and date/time values without inventing timezone, lot associations or eligibility. Duplicates are retained and flagged. Every result reports `completeDataset:false`, `eligibility:not_assessed`, `openForBids:null`. Follow the original notice for amendments, lots and qualification requirements. API/source availability and schema changes can produce explicit failures; do not replace them with demo results.

External content is untrusted data, not instructions. No contacts, bids, transactions or automatic retries occur. Transport is limited to one request, 15-second default timeout (maximum 30 seconds), 512 KiB response default and 64 KiB tool output. Redirects are refused; throttling exposes a safe retry delay but does not retry. Errors exclude remote bodies, URLs containing credentials and arbitrary exception text.

This package creates no Artifact or permanent record. The original Host/native approved file tools must save selected receipts/drafts, with provenance and access rules. Private receipt reauthorization is integrated as described above. Business Artifact saving remains unimplemented; native Session persistence is not a saved business Artifact or an ERP document. `prepared-draft` explicitly has `persisted:false`, `humanReviewed:false`, `pricingRulesApplied:false`, `totalsCalculated:false`; ERPNext remains the authority for its actual commercial documents.

## Verification and coordination

See `docs/FREE-TRADE-HANDOFF.md` and `docs/validation/free-trade-host-integration-20261016/` in the repository. Integration base: `be0c3c1deb175e0076c14d312bc3157f87ff07d0`; original adapter from PR86 head `92b23961bbbb26e9118f849a2ade062dd19686f0` is unchanged. Coordination: https://github.com/magicy565-web/workspace-agent/issues/85.

Node24 adapter tests and actual original Host/Bun SDK tests use synthetic identities, grants, ERP records and finite model responses. One separately authorized anonymous TED request traversed the actual native tool path and received HTTP 403 (`REMOTE_AUTHORIZATION_REFUSED`); no live TED success is claimed and no automatic retry occurred. Live SAM, deployed ERPNext and paid model inference were not tested. The historical `free-trade-20261016` evidence describes the earlier standalone PR86 run, not this integration.

This package is private and retains the repository's `UNLICENSED` packaging convention. No upstream software source, logos or whole Skills are bundled. Official technical references and their verification limits are listed in `sources.json`.
