# Commerce Network — native DSH product candidate

The native AI Work sidebar and the Grok Bot / Muse Agent integration contracts
are documented in [AI-WORK-CONNECTIONS.md](./AI-WORK-CONNECTIONS.md). External
provider configuration, actual compatibility and execution remain to be verified.

`dsh-commerce-network@1.1.0-rc.2` extends the recovered Channel Atlas React Flow
canvas with independently owned factory, overseas distributor and Personal
Worker service nodes, a durable delegation ledger, and a scoped external worker
gateway. DeepSeek Harness is the only internal execution host.

## Trade extension

The native canvas now reads RFQ, immutable ERP quotes, buyers, linked ERP orders and samples from their authoritative services. It stores references and layout only. RFQ import/review, policy review, exact quote approval, separate send/reconciliation and evidenced sample transitions stay inside DSH. Optional versioned mandate terms support explicit customer attribution and dispute resolution; approval never grants additional Worker actions. Missing services and truncated projections are shown explicitly. See `docs/COMMERCE-BUSINESS-IMPLEMENTATION.md` (also included in the release archive).

## Product flow

1. In a native DSH workspace conversation, describe a real product and sales
   objective. `commerce_network_read` reads the current revision;
   `commerce_network_plan` writes a connected project and proposed service tasks.
2. The native right sidebar displays the actual persisted network. Panning,
   zooming, node selection and layout changes do not alter permissions.
3. An independent provider is registered as a party and a Personal Worker as its
   service. The owner issues a 30-day project/agent-scoped credential. Its secret
   is displayed once; only its SHA-256 is stored. Deliver the credential to the
   intended provider through your own secure handoff.
4. The external agent calls `connect` with that credential. This verifies
   possession of its scoped credential, not business identity or skill quality.
5. Before authorization the owner sees the exact task, permitted actions,
   resources, deadline and maximum cost. Approval binds a preview digest and
   current revision. The transaction stores the grant and reserves project budget.
6. `commerce_network_dispatch` runs in the real native DSH conversation and
   queues that already authorized task. Its actual native session/tool-call IDs
   are recorded. The external agent claims it, renews a short lease, reads only
   granted context, and submits real content.
7. The service computes SHA-256 from the stored delivery bytes. The owner
   accepts or rejects the delivery. Acceptance records the reported service cost
   against the authorized ceiling. **It does not make a payment.**

There is no seed business data, generated customer count, pretend channel
connection or automatic provider. Tests use explicitly synthetic records in
temporary databases. A registered agent is not shown as having completed work.

### Business relationships and task chains

`mandates` in a native plan propose a factory → distributor relationship with
explicit market, product context IDs and business scope. An owner may activate
or revoke the exact mandate from its canvas edge. The stored decision has an
approval receipt and `approvedAt`; it never invents a legal signature or claims
the distributor has connected an external sales account.

Work orders may declare `dependsOn` IDs. Every dependency must be in the same
project and the graph must be acyclic. The server refuses downstream dispatch
until every predecessor has an accepted actual delivery. It does not run tasks
automatically when a line is drawn or a previous task completes.

Passing an output to the next worker requires an explicit
`accepted_deliverable:<predecessorWorkOrderId>` resource reference. The owner
must review the real predecessor title/text/sources in the downstream approval
preview. The grant pins the artifact and content hash; each resource read checks
that it is still an accepted intact delivery in the same project. A dependency
edge alone is never authority to disclose its output.

## Installation

Runtime: Node 24+, official DSH 0.2.1-rc.3 native Web profile. React is host-owned.
The client uses the official `sidebarRightTabs`, `sidebar.right.pane.tab`, native
SessionFace and conversation header extension points; it does not replace the
main conversation or run a second chat application.

From the repository root, install locked workspace dependencies and build the
native client. Install this folder through native DSH plugin management:

```sh
npm ci --ignore-scripts
npm run build:commerce-client
dsh plugin --profile web add link:/absolute/path/to/integrations/dsh/dsh-commerce-network
```

The linked development package depends on the workspace domain package. A
self-contained distributable is produced by the repository packaging script,
which includes the same domain source in the package staging directory.

Install the actual self-contained archive with native DSH:

```sh
dsh plugin --profile web add /absolute/path/dsh-commerce-network-1.0.0-rc.1.tgz
```

When replacing a same-name `link:` development install, stop that profile,
remove `dsh-commerce-network` through `dsh plugin --profile web remove`, then
add the archive and restart. The native pnpm profile can otherwise retain the
old link resolution. Confirm the loaded path belongs to the profile's installed
package. Removing the bundle does not delete its business database.

Confirm the native Plugins page reports a loaded bundle. Restart when the
manager reports `restart-required`, then refresh the Web client. Selecting a
bundle does not prove it loaded successfully. The archive is not a claim of npm
registry publication. Actual verification and remaining capabilities are recorded in
[the acceptance document](../../../docs/COMMERCE-NETWORK-V1-ACCEPTANCE.md).

`cordis.patch.yml` loads the optional native plugin. It does not install a model,
create a production profile, connect a buyer channel or register a schedule.
The server uses `$DSH_HOME/commerce-network/commerce.sqlite`; an explicit
`config.dataDir` overrides it. Database files and credentials stay outside Git.

## Actual data and execution boundaries

### Native owner and external workers

The current DSH Web connection represents one authenticated local owner. Native
workspace/session membership is checked for all owner and model operations.
This provides workspace partitioning **within that host**. It is not a
multi-tenant SaaS identity provider, login portal, legal identity verification or
cross-company membership system. Factory/distributor/provider records describe
business parties; a party record by itself does not grant a login.

External workers have a distinct credential bound to one workspace, one project
and one agent service. They cannot choose another workspace or enumerate the
owner's graph. Their API has no access to owner commands, tokens, pricing tables,
customer contact directories, arbitrary local files or model credentials.
Credentials and actor roles never come from worker JSON payloads.

### Product context and native resources

Product cards are project context nodes, not another product catalogue or
inventory database. They can hold explicitly supplied, unverified conversation
context or point to an exact native library product revision:

```json
{
  "id": "product_context_1",
  "name": "Actual supplied product name",
  "sourceRef": {
    "kind": "product",
    "id": "prd_00000000-0000-4000-8000-000000000000",
    "revision": 1
  }
}
```

The UUID above is a schema example, not a stored real product. Use the actual
native product ID and revision. `resources.js` reads the existing
`workspaceLibrary.productContext` service. It shares a strict allowlist of
name/description/category and SKU technical fields; it strips price tiers,
private supply terms, company information and attachments. The current native
library is profile-scoped. An explicit project mapping and the owner's exact
disclosure review are required; no cross-organization library boundary is
invented. Approval, claim and every new resource read recheck the native source
revision, content hash, archive status and plugin availability. Native-source
reads happen outside SQLite transactions; authenticated scope, state revision
and grant digest are rechecked before committing or returning any payload.

The document adapter additionally requires an explicit document disclosure
authorization and verified exact bytes/version. This release does not expose a
document disclosure editor; document sharing therefore remains blocked. An
`approved_document:` string alone grants no access.

### Actions, budget and deliverables

Supported delegated actions are public web research, reading granted product
context, drafting outreach, classifying already opted-in reply context and
summarizing an RFQ. There are no sending, price-quoting, payment, channel-publish
or subdelegation operations. A provider's declared skill is not a tested skill.

Project budget starts at zero. Free tasks can be authorized after the worker
connects. The owner can explicitly raise the ceiling; a model tool cannot.
Reservations, accepted cost accounting and state changes are in the same SQLite
transaction. Reported cost must be an integer in minor currency units and no
greater than the approved maximum. Currency changes are blocked when funds are
already reserved or costs accrued. This is an internal authorization ledger,
not a wallet, charge, invoice or supplier payment service.

Deliverables are bounded plain text with source URLs, original bytes and SHA-256.
Worker content and its sources are unverified until reviewed. The renderer must
treat them as data. Source URLs are stored as evidence references and are never
fetched automatically. There is no script/HTML execution surface.

### Leases, cancellation and retries

One Personal Worker has at most one active lease. Claims are atomic. Lease
duration is at most 120 seconds and never exceeds the task deadline. Heartbeat
starts a claimed task and renews its lease. Restart retains all records and
credentials. Expired claims fail with no automatic requeue because a lost
connection does not prove the external action stopped.

Cancellation before claim is immediate. Once claimed/running, cancellation
becomes `stop_requested`; the reservation stays held until an authenticated
worker stop acknowledgement. A deadline/lease failure with unconfirmed external
stop retains an at-risk reservation; an authenticated stop acknowledgement and
an explicit owner resolution are required to release it. Credential revocation
blocks new data/delivery immediately. A revoked credential can only inspect its
own existing lease status or acknowledge stopping it until the credential itself
expires. A failed/expired lease is marked `stopUnconfirmed` when appropriate;
the service does not claim to terminate an independent external process.

Authenticated worker requests are limited to 60 per credential per minute in
the plugin process. Empty queue polling and read-only status/resource requests
do not increment the graph revision. Credential verification and current grant
checks still precede every return. Rate windows reset on plugin restart; they
are an operational rate guard, not a public SaaS abuse-protection service.

Every mutation uses a stable request ID scoped to its authenticated actor.
Identical retries return the current state plus the original receipt; a changed
body under the same ID is rejected. Raw credential secrets are never stored in
idempotency records. Lost credential responses require explicit rotation. Client
SDK transport failures return an unknown-outcome error and do not auto-retry.

## Native tools

| Tool | Effect |
| --- | --- |
| `commerce_network_read` | Read current workspace state and actual revision |
| `commerce_network_delivery_read` | Read one complete delivery by `projectId` and `deliveryId` in the current native workspace |
| `commerce_network_plan` | Atomically apply a reviewed-in-conversation project plan; proposals only |
| `commerce_network_propose_order` | Add a bounded service task proposal |
| `commerce_network_dispatch` | Queue a specific already owner-authorized task with native call provenance |

The model has no approval, budget escalation, credential, acceptance or
revocation tool. Direct owner actions live in the authenticated native sidebar.
The DSH permissions system still governs model tool access. The plugin records
a native tool-call reference; it does not claim to create a DSH Scheduler task.
Persistent autonomous schedules have not been configured in this release.

## HTTP contract

All owner responses use `{ "ok": true, "data": ... }`. Errors include a bounded
code/message. Owner routes use DSH Connection authentication; writes additionally
require exact same-origin headers and JSON. Body size is capped at 256 KiB.

| Method and route | Request or response |
| --- | --- |
| `GET /commerce-network-api/workspace?sessionId=...&projectId=...` | Actual native-session-scoped graph projection |
| `GET /commerce-network-api/delivery?sessionId=...&projectId=...&deliveryId=...` | One complete stored delivery, scoped to the authenticated native workspace and project |
| `GET /commerce-network-api/review?sessionId=...&projectId=...&orderId=...` | Exact disclosure preview and `reviewDigest` |
| `POST /commerce-network-api/command` | `{sessionId,projectId,expectedRevision,requestId,command,payload}` |
| `POST /commerce-network-api/layout` | `{sessionId,projectId,expectedLayoutRevision,requestId,nodes,viewport}` |

Owner commands: create project, record parties/worker proposals/context/routes,
propose task, issue credential, set budget, approve task, accept/reject delivery,
cancel task, revoke agent or grant. Native `apply_plan` and `dispatch_order` are
explicitly unavailable through HTTP. Layout writes use a separate revision and
validate every node against the current project.

Canvas projections (including owner-command and layout responses) contain only
delivery metadata: IDs, title, hash, timestamp, provenance, UTF-8 content byte
count and source count. They omit full `content` and `sourceUrls`. Opening a
delivery in the inspector fetches that one record; downloads remain unavailable
until its complete body has loaded. Read failures can be retried, and closing
or changing the conversation/project cancels stale reads. Native Assistants use
`commerce_network_delivery_read` when they need the actual text and sources.
Neither read path accepts a delivery or grants it to a downstream Worker.
Existing stored content, hashes and exact-content disclosure approvals are
unchanged. Other large collections still follow the existing canvas size limit;
this change does not add project-wide pagination.

Worker requests use `Authorization: Bearer ...`, no browser cookie, no token URL
and no CORS. External HTTPS ingress must be configured explicitly; the default
accepts local test/service connections only. `allowRemoteWorkerHttp` is for an
operator-controlled TLS-terminating ingress, never an automatic workaround.

| `POST /commerce-worker-api/…` | Effect |
| --- | --- |
| `connect` | Verify scoped credential possession |
| `claim` | Atomically claim a queued task; return its exact allowed input |
| `heartbeat` | Start/renew the current lease; expose stop request |
| `resources` | Revalidate and return only the current lease's approved input |
| `status` | Read only that worker's leased task status |
| `deliver` | Save actual content, compute hash, await owner acceptance |
| `stopped` | Record an authenticated acknowledgement of a requested stop |

Every worker action includes `requestId`. Lease operations also require
`orderId` and `leaseId`. A delivery includes `title`, `content`, optional
`sourceUrls` and `actualMinor`. Unknown fields, arbitrary role claims and scoped
identity overrides are rejected.

## Verification and honest remaining boundaries

The tests cover durable SQLite restart, transaction rollback, native scope,
owner/model separation, one-time credential hashing, agent-specific claim,
idempotency, budget reservations, content SHA, cancellation, lease expiry,
real HTTP authentication/origin handling, native library pins and SDK behavior.
Run `node --test integrations/dsh/dsh-commerce-network/test/*.test.mjs` in an
environment that permits temporary localhost test servers.

Repository tests do not establish production deployment, a real independently
operated remote provider, sales results, email/WhatsApp delivery, verified buyer
identity, payments, schedule execution or multi-tenant SSO. Native runtime and
browser acceptance are recorded separately in the delivery report, using the
actual installed DSH version and no invented model calls.
