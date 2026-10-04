# Versioned release plan

Scope: one enterprise, one shared trusted-operator workspace, one active writer.
Existing Muse-inspired chat layout remains the product baseline. This is not a
multi-tenant SaaS or an official Muse service. No production deployment, paid
provider call, credential generation, or live schedule is implicitly authorized.

## 0.3 — Functional closure

- Make existing approvals, skills, connectors, schedules, runs and artifacts
  accessible through the application without replacing the chat-first layout
- Preserve precise approval scopes and safe disabled/configuration states
- Cover repeated actions, errors, dismissal, refresh and history navigation
- Gate: backend + built-React/real-HTTP DOM tests, typecheck and production build
- Browser pixel/layout acceptance is a separate gate; DOM tests cannot satisfy it

## 0.4 — Single-enterprise deployment candidate

- Explicit fail-closed access boundary, sessions, request forgery protection and
  attributable audit records for the supported deployment architecture
- Offline verified backup/restore, clean startup, restart and recovery exercises
- Reviewed deployment configuration, operation and incident-recovery runbooks
- Gate: hostile access/session tests, independent source review and recovery drill
- A configuration template is not evidence that ingress/identity/TLS is deployed

## 0.5 — Real integration acceptance candidate

- Opt-in, bounded, real-provider acceptance runner and inspectable evidence format
- Keep scripted models, native source fixtures, live provider and production
  evidence distinct; no credential values or conversations in evidence packages
- Gate: authorized real provider end-to-end and cancellation/restart acceptance;
  optional native runtime additionally needs the reviewed target build/profile
- Muse live hookup remains separately deferred

## 1.0 — Launch gate

- All functional/security/recovery gates pass against the exact release
- Actual deployment target, TLS/identity boundary and backup destination verified
- Real browser desktop/mobile/navigation visual acceptance against references
- Actual approved provider path passes and cost/operating limits are accepted
- Independent security review has no unresolved release-critical findings
- Deployment itself requires explicit authorization; candidate archives do not
  constitute public deployment or production readiness

Proceed through all authorized implementation stages. Report only exact remaining
credential, authorization, budget or environment blockers when those prevent the
next gate. Preserve earlier releases and produce one final inspectable candidate.

## Current implementation outcome (2026-10-04)

0.3 functional closure is implemented with 14 built-React/HTTP/DOM scenarios.
0.4 access/session/audit/offline recovery controls are implemented and tested;
final independent review and actual deployment remain pending.
0.5 exact FastAIToken/gpt-6-sol text and real Harness relay adapters are implemented
with genuine SDK/native offline fixtures. Live gates remain blocked on secure
credential setup, verified protocol/pricing and the authorized CNY5 total hard cap.
1.0 is not declared. Preserve these separate gates instead of treating coding
completion as production launch completion.

## 0.5.0-rc.2 continuation

Native-aware recovery now validates full logs through the native public persistence
API, preserves JSONL generations/checkpoints/IDs and native assets, applies
restrictive policy resets without Agent execution, and stages recoveries behind an
incomplete marker. Original absolute path activation is mandatory. App-store
migration uses fully synced backup publication and explicit recovery diagnostics.
The native storage overlay brings otherwise-temporary spills under the backed-up
home. Supported native APIs are tested with real source and synthetic model streams.

A concrete remaining implementation gap was also identified: the launch checker
required native live evidence while only a direct-text acceptance runner existed.
The delivered native runner now supports guarded session-lifecycle acceptance with
a provider factory across restarts. It does not claim native tool/profile acceptance.
Those must be verified against the selected real profile, separately from text
and session continuity. Secure credentials, hard spending cap, actual deployment,
browser visual acceptance and final independent review remain external gates.

Conditional implementation scopes still explicit: Windows native backup leases;
image-offload/team/workflow/native-scheduler/worker-delivery recovery owners; the
chosen host/IdP signing gateway; and actual selected-tool/profile acceptance.
These are not reclassified as credential-only blockers. The native recovery tool
refuses unsupported state until its owning integration is reviewed and implemented.

## Runtime diagnostics continuation

The supported operational slice is complete: read-only diagnostics, source-bound
local fixture reports, current-process provider observations, scheduler lifecycle
and safe storage/connector/recovery blockers, plus fresh/stale/disconnected/
reconnected/restarted UI states. Bounded status reads and retired-instance handling
prevent stale success claims. Refresh neither probes nor retries paid/external
work. No additional feature scope is needed to close this diagnostic slice.
Existing conditional native recovery scopes and all actual launch gates above
remain explicit and unfulfilled.


## Business-flow / Work transfer checkpoint

A subsequent actual conversation trace found gaps beyond the earlier management
UI closure: registered files/connectors did not reach the agent, actions did not
pause/resume the same run, and repeating schedules could not yield fresh outputs.
These are now implemented with explicit context snapshots, a guarded application
connector bridge, generated artifacts and opt-in bounded recurrence templates.
The prior “0.3 functional closure” was narrower than complete business-flow closure.

This handoff is a coherent development checkpoint, not a fresh all-green release:
backend261/native-focused36/acceptance13 pass; UI18 predates final recurrence UI,
scenario19 remains unverified, final offline install failed on missing cached
xmlchars, and source-bound evidence/clean extracted run must be regenerated in an
authorized Work environment. See the root handoff document for exact boundaries.
