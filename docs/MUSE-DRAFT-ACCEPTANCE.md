# Conversation Muse draft checkpoint

Execution source: `96231bbff32c0bbb03329dd2b218e58a98f557d8`, branch
`codex/cloud-muse-draft-20261012`, [Draft PR39](https://github.com/magicy565-web/workspace-agent/pull/39).
It starts at e5ae755 and leaves that independent review baseline untouched.
The [fixed client contract](MUSE-DRAFT-CONTRACT.md) uses revision/draftHash and
expectedRevision/expectedDraftHash. No frontend files, new business modules,
scheduler, external identity or approval issuer were added.

The real Pi schema tool `workspace_propose_muse_draft` records only an inert
proposal. The original Workspace transaction persists the Run, draft ID/version
and exact request receipt together. Unknown facts remain null; unquoted values are
unconfirmed suggestions. Original referenced product revision/name is resolved
locally for review and excluded from Pi context. Text input snapshots retain the
original ID/version/SHA permission checks. Draft preparation requires separate
amount, deadline and exact public-text confirmations, then creates only the
original review_required delegation. Approve/dispatch/lease/Attempt/files still
use the original protocol. Explicit rejection prevents executing the old review.

Actual normal development verification (overlapping counts are not summed):

| Command | Result |
|---|---|
| `npm run test:all` | exit0; backend551 total/544 pass/7 historical skip; original UI19/19; conversation14/14; web and mini build pass |
| `node --test test/muse-draft-flow.test.mjs` | 5/5, zero skip; actual official Pi faux tool and signed enterprise loopback HTTP/Store/native protocol |
| Initial Pi/Muse/crash/usage + draft checkpoint | 18/18, zero skip; prior to the additional concurrency case |

Business fixtures verify one draft through missing-field clarification and one
original order through separate confirmations/prepare/approve/dispatch; repeated
messages and concurrent identical creation return the same stored ID/Run; old
revision/hash cannot prepare after clarification; unquoted suggestions never
become order facts; referenced product changes block preparation; original order
survives a missing draft receipt acknowledgment/reopen without another model call
or order; rejection prevents old approve/dispatch. Dispatch proves only local
protocol queuing, with wake.observed=false. No real Muse accepted/executed anything.

Initial fixture failures are retained. They used a reused closed Pi provider,
omitted optional empty collections and mismatched original Library UUID/change
shapes. Fixtures now use fresh providers per locked Store lifetime, actual
reference/update API shapes and the original 409 approval-required contract. No
permission, scope, no-duplicate or no-effect assertions were removed. A later
concurrency fixture exposed a provisional-ID response race; the response now
uses the ID from the original deduplicated admission transaction.

Evidence: [validation/muse-draft](validation/muse-draft). The old source ZIP is
still historical P1-failed material; this checkpoint is code/contract evidence,
not a new package or deployment. Client PR38 must still integrate and exercise
this actual API through its Page callbacks before final one-time packaging.

The independent e5ae755 security review was interrupted by platform safety
checks and has no completed conclusion. This task did not rerun that blocked
audit using a different path; these are ordinary requested business regressions.
No independent security pass is claimed. Real model authorization, original Muse
account/execution, WeChat device/TLS and production remain untested. Production
was intentionally off and not probed or awakened; no paid request, new credential,
main change/merge, force push or production deployment occurred.

Preview: current execution tools/environment expose no user-accessible forwarded
port URL. localhost is only internal and is not a handoff address. The installed
[Sites skill](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md)
says “Native `create_site` creates a private, unpublished Site and returns its ID
and source credential.” That is a separate publishing workflow, not an existing
cloud port URL; it was not invoked under the no-new-credentials constraint. The
existing preserved web UI can be inspected in the previously saved real local
Chromium [390px screenshot](https://github.com/magicy565-web/workspace-agent/blob/e5ae75584b45c8be02dc10b048ebd27b7ea7d3c3/docs/validation/cloud-pi-p1/browser/mobile-390.png)
and [file preview](https://github.com/magicy565-web/workspace-agent/blob/e5ae75584b45c8be02dc10b048ebd27b7ea7d3c3/docs/validation/cloud-pi-p1/browser/verified-file-preview.png).
They show explicitly local fixtures, not the new mini intake, live accounts,
reference-pixel acceptance or actual external execution.
