# TT041 read-only control plane

Exclusive changes: server/dot-control-plane.mjs, test/dot-control-plane.test.mjs,
and this document. The frontend, server entrypoint, worker dispatch, store schema,
original Dot authorization and callback subscriptions are unchanged.

## Verified baseline and reuse

The independent local worktree is based on the exact PR22 commit
78f155367524b48381d79b2edebe0e5e2925e85d, tree
974090bdc566fd34748e172fa9e1e4c608ce7306. Task 1's 273-file read-only snapshot
was reused without another clone/download. Every blob, tree and original commit
object was verified before the existing portable Git created the worktree.
The original parent is an explicit shallow boundary. No synthetic history was used.
PR22 and PR15 remain separate Draft PRs; neither was merged.

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
of active execution. Claimed and running remain different statuses.

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

    node --test --test-isolation=none test/dot-control-plane.test.mjs

21 tests pass, zero failures/skips. They cover buyer/enterprise isolation,
allowlisting, state/freshness, original V22 helper parity, lease/fence/deadline,
closed failures, duplicate/older input, heartbeat suppression, cancellation and
late results, partial reads, JSON restart/replay/ack, retention gaps, permission
changes, evidence/approval invalidation and exact procurement sharing scope.

The default subprocess-isolated test runner hit spawn EPERM in this sandbox;
Node's built-in test-isolation=none ran the same tests without a child process.
The JSON round trip is an explicitly temporary offline fixture, not validation
of the original production writer's durability or subscription delivery.

No full frontend build, original native Host, genuine Dot/Muse execution,
production OAuth refresh/callback, deployment, provider billing or real
buyer/merchant vertical flow was run. The existing PR22/PR15 source evidence and
these passing fixtures must not be promoted into those acceptance claims.
