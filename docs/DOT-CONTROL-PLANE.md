# TT041 read-only control plane

Exclusive changes are the two server/dot-control-plane*.mjs modules, their three
tests, scripts/dot-control-wiring.mjs, this document and docs/patches/ artifacts.
No common frontend, server entrypoint or task-2 dispatch file was edited.

## Verified baseline and reuse

The independent local worktree is based on the exact PR22 commit
78f155367524b48381d79b2edebe0e5e2925e85d, tree
974090bdc566fd34748e172fa9e1e4c608ce7306. Task 1's 273-file read-only snapshot
was reused without another clone/download. Every blob, tree and original commit
object was verified before the existing portable Git created the worktree.
The original parent is an explicit shallow boundary. No synthetic history was used.
PR22 and PR15 remain separate Draft PRs; neither was merged.

The adapter contract is additionally pinned to task 2 PR26 commit
9e92fe31dad89677d36932ef7f623a784aec278b, whose base is PR15
2ac171e4da46e44e0095fe9907c2f8b1339a56cb. GitHub Connector supplied the exact
12 original source/fixture dependency blobs; the supplemental test verifies
each Git blob SHA before importing them. The manifest is in
docs/patches/dot-control-host-wiring-source.json. This is a read-only source
snapshot, separate from the PR22 worktree, not an integrated release checkout.
PR26's latest routing change retains the reviewed Muse Session Host entry while
REST is attached later. All 12 adapter-test dependency blobs match that commit.

Source evidence:

| Existing source | Verified behavior | Integration boundary |
| --- | --- | --- |
| PR22 server/store.mjs | read(), subscribe(), serialized durable updates and persistent meta.sequence | A read does not dispatch a Worker. Subscriber notifications occur after persistence. |
| PR22 server/index.mjs, streamChanges | /api/events SSE carries sequence, updatedAt and bootstrap invalidation | Last-Event-ID is validated, but only the current state and subsequent changes are sent. No historical replay is implemented there. Heartbeat comments prove transport only. |
| PR22 server/dot-worker-bridge.mjs | exact task/Worker lookup, original attempt/fence, bounded lease/deadline, cancellation, submitted results and event acknowledgments | Reuse the existing state machine. Do not claim/renew/submit from this module. |
| PR22 src/experience/museControl.ts | draft/order approval, claim, uncertain lease, submission, original Session return and order acceptance are separate | Tests import this original helper for parity. A claim is not completed work. |
| PR22 src/experience/cloudActivity.ts | active work requires attempt/fence/lease/deadline; a closed native failure stays failed history | The new projection additionally requires matching returnedHash/receiptHash/closedHash before reporting closure. |
| PR15 2ac171e4, deploy/muse-native-overlay/server/workspace-plugin-service.mjs | existing scoped bindDotTasks(actor).view(), original native result bindings, plugin lifecycle/ownership fences, original callback candidates | Read through the reviewed plugin service. Do not substitute an ordinary text provider for PersonalDot or Harness. |
| PR15 workspace-native-plugin.mjs and workspace-dot-host.mjs | existing Agents/Goals/Sessions, original owner binding, native Session flush and exact receipt close/accept controls | The full original Harness dependency was not materialized or run by this task. |

No WebSocket capability or hard real-time guarantee was established. The deployed
Host, live Dot/Muse, original identity 39 versus old automation 21, and production
callback behavior were not touched or accepted by this work.

## API exported by the module

These are importable functions, not new deployed HTTP/MCP endpoints:

| Function | Behavior |
| --- | --- |
| controlScopeKey(principal) | Pins enterprise, authenticated user, permission version and exact source/kind grants. |
| projectControlSnapshot({principal,sources,now,maxAgeMs}) | Pure allowlisted aggregate of goal/order/task/attempt facts. No store update, network request, model call, order or timer. |
| createControlJournal(principal,epoch) | Creates a notification state value for one permission scope. The existing host persists it. |
| advanceControlJournal(journal,snapshot,{retain}) | Pure reduction of ordered fresh snapshots into material state-change events. |
| replayControlEvents(journal,{principal,snapshot,epoch,after,limit}) | Bounded replay, current permission filtering and honest reset when history is unavailable. |
| acknowledgeControlCursor(journal,{principal,consumerId,epoch,cursor}) | Monotonic application-consumption cursor, separate from HTTP receipt or business acceptance. |
| recommendGoalSteps(snapshot,{facts,now}) | Evidence-referenced suggestions with executable:false, executed:false and requiresApproval:true. |
| adaptWorkspaceControlSource({state,principal,binding,sourceId,observedAt,...}) | Maps existing WorkerDesk, original Dot/Muse tasks, Runtime Goals/runs and original Session receipts; never adopts orphan tasks. |
| createWorkspaceControlReader({readContext,readState,readMuseSession,sourceId,now,maxAgeMs}) | Returns read/replay/suggestions through original read methods and rechecks original owner/lifecycle context on every call. |

No DOM, localStorage, sessionStorage, proprietary runtime copy, DAG, scheduling
engine or second writer is involved. Web, future mini-program and unified
Workspace MCP tools can consume the same serialized snapshot/events/advice.
Actual tool registration belongs to the coordinated integration task.

## Trusted host adapter contract

principal must be supplied by the original authenticated Host. It has:

- workspaceId and userId from verified membership/owner identity;
- policyVersion from the current permission policy, not a client parameter;
- grants: [{sourceId,scope:"self"|"workspace",kinds:["goal","order","task","attempt"]}].

Each source envelope has id, workspaceId, visibility ("private" or "workspace"),
userId for private sources, epoch, persistent sequence, observedAt, updatedAt,
complete and records. Each record has kind, domain and its original ID/status.
Preserve original taskRef, orderId, goalId, attemptId, fence, runId, revision,
deadline/lease timestamps and receipt/return/accept/close hashes where supported.
Different entity kinds and source IDs retain distinct keys; counts.byKind avoids
presenting a Goal and its attempt as two business tasks.

For the existing single-enterprise app:

1. Read one store.read() value and use its real meta.sequence/meta.createdAt.
2. Map goals to kind:"goal", runs to kind:"attempt", domain:"runtime";
   workerOrders to kind:"order"; authorized Dot/Muse records to kind:"task".
3. Source visibility:"workspace" requires an explicit workspace grant. Existing
   shared workspace data does not become private merely because createdBy exists.
4. Personal/native views require the original authenticated owner/Session binding,
   source visibility:"private" and source.userId equal to that authenticated owner.
   Worker ownerId is not a substitute for the requesting user's identity.
5. Record-level enterprise/private overrides are checked again. Missing or unknown
   visibility does not grant access. A private source cannot expose another user.
6. Set executionVerified only after the original live runtime confirms ownership
   of the exact runtime attempt. A configured provider, stored "running" flag,
   identity handshake or transport heartbeat is insufficient.

observedAt records an actual successful source read; updatedAt records the
source's actual last state change. Neither is a progress percentage or heartbeat.
A stale/unknown source cannot activate a task animation. Expired, inconsistent
or missing lease/fence/deadline evidence yields unknown execution. A Goal needs
its original matching live attempt; an order's reported state alone is not proof
of active execution. Claimed and running remain different statuses. In the Muse
projection, claimed.active means a valid held lease. It does not establish a
model turn, wakeup or execution start. PR26 still reports wake.supported:false,
wake.observed:false and executionStartedAt:null; the UI must preserve that fact.

The aggregate intentionally excludes text, prices, budget values, supplier
floors, customer profiles, prompts, raw blocker messages, complete receipts,
file payloads and credentials. Detail readers must separately reuse the
original authorized APIs; no aggregate read grants a file download or sharing
permission. Blocker codes and original references can identify what needs review.

If the native source has no verified persistent ordering field, snapshots show
ordering:"unknown" and journal advancement fails CONTROL_ORDER_UNKNOWN.
Do not synthesize sequence from wall time, read count, animation or login.
An adapter exposing the original persistent event/version order must be verified
with the real versioned Harness dependency before native replay is accepted.

## Original Host mapping and reviewable wiring

The adapter maps original workerOrders to orders and their exact associated
dotTasks/museTasks to task records. Original orderId, requestId, Worker ID,
native conversationId, taskRef, attemptId/fence and source timestamps are retained.
Native owner/Session IDs preserve the original @ and / syntax; public task IDs
retain their narrower syntax. It uses raw order status, not PR26's product phase:
draft plus original conversation mapping is awaiting_approval; approved is
awaiting_dispatch; claimed remains a lease; submitted is return_pending;
exact original receipt/message acknowledgement is returned; original explicit
acceptedAt is accepted. Pending past its deadline retains reported queued status
and deadlineAt; the authorized PR26 detail reader exposes deadline_expired.
The UI must retain this distinction without inventing a new terminal state.

Conversation linkage checks the original owner, user-message content hash,
request/review/order identity and Worker. Task linkage checks the original task
ID, order, Worker, service, budget and deadline internally. Dispatch confirmation
loss may leave remoteJobId:null while the original task exists; the adapter
retains that exact task and dispatching/uncertain state without reconciliation.
The supplied original Session view validates receipt, attempt, upload and file
bindings. The adapter additionally checks the saved receipt and exact original
business message before reporting returned. Missing/mismatched linkage becomes
unknown; it cannot certify accepted/completed business dependencies. Cancellation
remains dominant. Orphan/foreign tasks and receipts are not adopted.

Runtime runs lack updatedAt in actual created records. The adapter reports the
latest recorded updatedAt/finishedAt/startedAt/createdAt/event.createdAt and labels
updatedAtOrigin:run-timestamps. A stored running run stays unknown unless the
original Host supplies verifiedRunIds from the real runtime. Existing shared
legacy Goals need an explicit workspace grant; native private bindings never
infer ownership of an ownerless Goal. The native Dot bindDotTasks view is still
an integration gap; this adapter's Dot task path consumes existing dotTasks.

The reader rechecks original readContext, reads state, reads the original
Session.view(), reads state again, then rechecks the context. Different state
digests mark unavailable/CONTROL_HOST_SNAPSHOT_CHANGED. The digest is only a
torn-read check, never an event cursor. Without an original persistent sequence,
this is a best-effort current snapshot; it cannot establish intermediate event
history. Private exception messages/paths are discarded. Original owner/epoch
failures propagate; other read failures produce unavailable, complete:false
and no records. Replay leaves the consumer cursor unchanged on unavailable,
stale, incomplete or absent previously observed sources, so reconnect cannot
silently skip unconsumed changes.

docs/patches/dot-control-host-wiring.patch contains three exact source edits:

1. Original primary native binding: bindControl(originalActor, hostScope).
2. Original native overlay binding: the same scoped method.
3. Original plugin service: service.muse.bindControl(originalActor), forwarding
   config.scopeId and the existing plugin epoch/fingerprint as policyVersion.

bindControl returns only read/replay/suggestions. It obtains identity from the
already reviewed original native binding and reuses scoped(), store.read() and
session.view(). No timer, write, dispatch, grant, HTTP endpoint or subscription
is added. Suggestions facts must come from trusted existing Host records, never
MCP arguments or a model's unsupported claims. An integration call is:

```js
const control = service.muse.bindControl(originalAuthenticatedActor);
const snapshot = await control.read();
// The existing authoritative writer persists journal/acks separately.
const page = await control.replay(existingAuthorizedJournal, {epoch, after});
```

The patch was generated against verified PR26 blobs and passed Git apply --check
against task 2's unchanged relevant source files. It was not applied there.
The executable supplemental test applies the primary binding edit in memory,
imports the actual original WorkerDesk/Muse/Session implementation and exercises
its real record shapes using PR26's explicitly synthetic fixture.
The overlay import ../../../server/dot-control-plane-host.mjs resolves inside
this source repository. Production packaging must place/version these two new
modules as a reviewed service-plugin dependency and resolve its import; the
standalone overlay/full Harness is not boot-verified. Do not ship this patch as
an already assembled deployment. PR22/PR26 source reconciliation, original
authenticated BFF/MCP registration and event persistence remain coordinated work.

## Persistence and event integration

The existing authoritative writer must persist the returned journal and consumer
ack values in its existing transaction before publishing events. An integration
may attach this reduction to the original commit/subscription path; this task
does not open a second data directory or add a background timer.

Store-level subscriptions are post-commit invalidations. Updating the store in
every subscription callback would recursively generate store changes. The
integration must avoid that recursion, preserve its transaction boundary, and
recover gaps before claiming complete notification history. If a projection is
not committed atomically with the original transition, intermediate states can
be lost; final snapshots must remain the truth and that limitation must be stated.
The current entrypoint has not been wired or changed.

- First observation establishes a baseline and avoids notifying every old task.
- Duplicate/older source sequences are ignored. Same-sequence conflicting data
  cannot rewrite a previously recorded fact.
- Lease renewal and timestamps alone do not notify. State/attempt/fence,
  blocker code, definition revision, original return/acceptance or closure changes do.
- Late callbacks do not reopen cancelled, completed, accepted or closed original
  records in the notification projection. The original task state machine still
  owns execution fencing; this module never modifies it.
- Missing/partial/stale source responses do not imply task disappearance.
  Only a newer complete authorized source can record removal; removal is never
  completion and replay does not disclose records absent from current permission.
- Source epoch changes require explicit resync. Journal history has an independent
  persistent epoch/cursor; retention gaps, unknown/future cursors and old epochs
  return resetRequired:true with no fabricated history.
- Pages advance to the last scanned cursor even if current permissions filter
  events. Each event has a stable epoch:cursor ID. Consumers must deduplicate that
  ID and durably acknowledge consumption. Transport delivery is at least once;
  this module does not claim exactly-once push delivery.
- A changed policy version or actor cannot replay the previous scope's journal.
  Create a new baseline rather than broadening an old journal.

These records are product-code monitoring state, not a new chat automation,
real Dot subscription, external message or production task.

## Goal and procurement evidence

facts are resolved by the trusted Host from original dependency, material,
approval, budget and sharing records. They are not model/user assertions.
Each fact pins goalKey, exact sourceEpoch/sourceSequence and current Goal revision.
dependencies reference visible projection keys. Only an accepted dependency or
a reviewed completed Goal satisfies the business dependency check; a completed
model/provider attempt does not.

missingMaterials identifies bounded material keys. approvedRevision must equal
the current Goal revision. budgetAuthorized describes an existing authorization;
it conveys no budget amount or permission to spend.

For a procurement profile, shareRequested:true also requires exact recipientId,
scopeConfirmed:true and approvedProfileVersion equal to current profileVersion.
Changed requirements, price/lead-time/terms or sharing scope must invalidate the
old approval at the original writer; this module rejects mismatched versions and
only suggests review_profile_delivery. It never sends the profile.

evidenceRefs must contain bounded references for dependencies, materials,
authorization and budget, plus sharing when requested. Each reference has
category, recordId, version, sourceId, sourceEpoch and sourceSequence. It must
resolve to a currently authorized fresh source. Authorization reference version
must match the Goal revision. The host must authorize and resolve the referenced
original record before supplying the fact; this pure module is not an IdP,
budget verifier or evidence fetcher. Output includes only allowlisted provenance,
so private values embedded in a fact/reference cannot enter the advice.

Missing facts are explicitly listed. Advice separates review/supply/verify/
observe actions from executedActions (always empty). It does not automatically
externalize inquiries, hire Workers, reconnect credentials, widen grants, spend
money or requeue expired work.

The first buyer-to-named-merchant inquiry/reply is a separate vertical integration
acceptance. This task has not sent any real inquiry, and its fixtures cannot prove
that a merchant received or replied.

## Local validation

Bundled existing Node 24.21.0, Windows, no dependency installation:

    node --test --test-isolation=none test/dot-control-plane.test.mjs test/dot-control-host.test.mjs

31 ordinary tests pass, zero failures/skips. They cover buyer/enterprise isolation,
allowlisting, state/freshness, original V22 helper parity, lease/fence/deadline,
closed failures, duplicate/older input, heartbeat suppression, cancellation and
late results, partial reads, JSON restart/replay/ack, retention gaps, permission
changes, evidence/approval invalidation and exact procurement sharing scope.
The original WorkerDesk/Dot bridge/Runtime functions create the adapter's
records under an explicit memory fixture, including cancellation and run times.

For the supplemental fixed PR26 source test, set TT041_PR26_SOURCE to its
read-only source snapshot, whose 12 Git blob hashes must match the manifest:

    node --test --test-isolation=none test/dot-control-host.peer-contract.mjs

7 supplemental tests pass, zero failures/skips; total 38. They execute the exact
patched original native binding through PR26's original conversation fixture:
draft/approval/queue, same attempt/fence, result return versus acceptance,
cancellation/late result, closed binding/JSON remount, corrupt business receipt,
uncertain original dispatch and strict source wiring. The fixture uses memory
copy-on-write storage, memory artifact bytes, a synthetic Session and an explicit
relay error-helper stub. No test starts a model turn. The supplemental file is
explicitly selected; the ordinary suite neither needs external source nor skips
these tests as if verified. Local evidence is docs/validation/dot-control-tests.txt.

The default subprocess-isolated test runner hit spawn EPERM in this sandbox;
Node's built-in test-isolation=none ran the same tests without a child process.
The JSON round trip is an explicitly temporary offline fixture, not validation
of the original production writer's durability or subscription delivery.

No full frontend build, original native Host, genuine Dot/Muse execution,
production OAuth refresh/callback, deployment, provider billing or real
buyer/merchant vertical flow was run. The existing PR22/PR15 source evidence and
these passing fixtures must not be promoted into those acceptance claims.
Task 2 PR26's fixed delivery reports 35 offline contracts passed, but 17 of 18
original disk regressions failed at original syncDirectory/fsync EPERM and
standalone overlay startup lacks its original muse-worker-host dependency.
Those are supporting blocker reports, not tests this task reran or repaired.
Native persistent source ordering/journal/outbox, original Dot view/wakeup and
the buyer-to-named-merchant vertical remain unaccepted.
