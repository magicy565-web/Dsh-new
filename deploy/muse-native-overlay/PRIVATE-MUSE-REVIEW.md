# Reviewed Muse activation and orders

The independent Muse connection has completed a genuine Secure Vault handshake:
HTTPS identity and inbox returned 200 at 11:07:53 and 11:07:59 on 2026-10-11.
Missing credentials return 401. Authentication is verified; real research and
human acceptance are separate. During candidate preparation the three gates are
false, the Host is paused and the Muse inbox is empty.

Five new actions consume only the existing operator-selected owner-controlled
private review file. They are not HTTP routes or model/MCP tools. Every action
requires version 1, stable requestId, exact expectedEpoch/configurationHash,
configured workerId, confirmed:true and callbackCandidateIds:[]. Unknown fields
are rejected. The fixed actor comes from the original selected configuration.

- `muse-activate` also requires all three reviewed gates. It invokes the existing
  service.resume, rebinds original native tools, then remounts Muse at the new
  epoch. Original Goals, Sessions, completed history, Dot connection pauses and
  OAuth bindings are preserved. No resumeConnection is called. Unresolved Worker
  assignments still block resume; a repeated recorded review does not run twice.
- `muse-order-start` accepts an exact order and extraCostLimitUsd:0. This first
  order permits only public channel-validation/product research, with matching
  order/review requestId. Existing owner-bound WorkerDesk create, approve and
  dispatch methods submit once. An uncertain submission is preserved for
  reconciliation. Internal budgetCredits are authorization limits, not USD.
- `muse-order-refresh` reconciles an owned original order, recording the complete
  returned report and SHA256 for review.
- `muse-order-accept` requires the exact delivered reportSha256 and confirmation.
  It reuses WorkerDesk acceptance to save an immutable receipt. Wait for the human
  to review the genuine report before selecting this action.
- `muse-order-cancel` requests stop of an owned task. Muse must confirm using its
  original attemptId and fence. A cancellation request alone is not a stop receipt.

Durable private receipts are saved before the command is removed. A requestId
cannot change its original command. Restart retains work and pauses the Host;
rollback must preserve current business/OAuth data and fences. No direct state
file mutation, new runtime, writer, Agent, scheduler or public admin API is added.

The pending original Dot Goal is a separate recovery task. Muse activation does
not dispatch or replace that Goal and does not restore the Dot connection.

Actual Linux Node 24.21.0 validation: 11 native tests pass, zero failures/skips.
The expanded Cordis Host test proves an original saved Goal and paused Dot
connection survive activation, retry is idempotent, a product order submits once,
and acceptance rejects a changed report hash. The original Dot/Harness regression
separately passes 1/1. All use isolated fixture identities/data, with no paid calls;
none are genuine Muse research evidence. Older overlapping counts are not additive.

The earlier TypeScript/Vite build and 19 DOM tests passed. The full source backend
run had 361 passes, 3 failures and 3 skips: the deployed Harness subset omits SDK
server/agent-loop testkit and built exports. GitHub CI startup_failure executes no
jobs. Neither is a full backend pass. The candidate needs manifest/service-user
import checks and private backup before activation. Preserve original frontend and
identity service. Real claim, heartbeat, upload, submission and final human
acceptance remain separate deployment evidence.
