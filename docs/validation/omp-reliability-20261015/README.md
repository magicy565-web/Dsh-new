# Bounded OMP terminal reliability investigation

PR68 only; starts at `af87df4532747ab773c26f7336cc5148eebef380`. Inquiry draft-only correction is separately pushed at `b2cce783af70837c5a41daff1f4be01407a4678f`. All tests use isolated synthetic original services/identities/materials and finite keyless model responses. Official SDK/TUI/HTTP/worker components are actually executed. No live model, paid call, real enterprise material, production request, network workaround or deployment was used.

## What the two retained failures prove

1. `test/workspace-omp-terminal.test.mjs`, natural-input case, historical line45: the original first HTTP Run succeeded; after `/ws-front-status`, `!cat /tmp/forbidden-synthetic` remained visible in the official editor and the required refusal notification was not observed within the existing 700×25ms polling bound. The retained output does not prove whether Enter was lost, delayed, classified as paste, or the notification was missed. It does not show shell execution. The terminal exit code at the failure point was not captured. See `historical-shell-refusal-42of43.txt`.
2. Same file, unconfigured-interactive case, historical line126: the two expected unconfigured refusals were displayed, zero Runs remained, then `/quit` returned terminal exit1 instead of0. The old assertion retained no shutdown stderr/scrollback; its underlying exit cause cannot be recovered from that file. See `historical-quit-42of43.txt`.

These are separate symptoms. Neither is explained by the inquiry identity-rate-limit fix or by a subsequent successful run. Source inspection finds asynchronous official input handling, paste classification and original shutdown cleanup, but none is assigned as a cause without reproduction evidence. Fixed dependencies remain Node24.19.0, Bun1.3.14 and official OMP18.10.4.

## Bounded reproduction and retained diagnostics

- Six isolated child processes, each executing both exact target tests: all **2/2**, process exit0. Per-process conditions, durations and logs: `isolated.json`.
- Three rounds of two concurrent child processes with the same two target tests: all six processes **2/2**, exit0. Per-process logs: `parallel.json`. The same test deadlines and assertions apply; no failed run was automatically retried.
- A preliminary two-process collector had a Python variable-name bug and raised TypeError after subprocess completion. Both subprocess logs show2/2, but their process exit-code collection was incomplete; `collector-error-lane-*.txt` is retained and excluded from the bounded counts. This collector error is not a terminal defect.
- Four-file original terminal/intent/enterprise-control regression: **11/11**, exit0, in `controls-11.txt`. This overlaps target tests and is not added to a unique business-case count.
- The final complete parallel combination passed **45/45**, process exit0, in **65.752 seconds**, recorded separately in `facts.json` and `full-45.txt`. It adds the two new startup-state checks to the historical43; counts overlap other focused runs.

The only terminal-test change adds failure-only stage, driver/terminal exit, driver stderr and bounded official scrollback diagnostics **before owned-process cleanup**. The synthetic binding token is omitted. No production input/shutdown handling, polling limit, expected refusal or expected exit0 was changed, and no silent retry or serial-only workaround was added.

Minimal existing test entry for the next occurrence:

```sh
node --test --test-name-pattern='actual official OMP TUI consumes natural input|default official terminal stays interactive' test/workspace-omp-terminal.test.mjs
```

Run from this PR68 worktree with the already installed fixed runtimes; no model key or account configuration is required. The fixtures construct only local synthetic original services and their owned POSIX PTYs. One case submits natural input, waits for the original reply, reads exact status, tests shell and foreign-command refusals, then quits. The other tests natural-input and `/ws-task` unconfigured refusals with zero Runs, then quits. This is a minimal **candidate reproducer**, not a deterministic reproduction: the two original intermittent causes remain **unestablished**. Stop this bounded investigation here; a later occurrence needs the new pre-cleanup failure diagnostic to distinguish input transport, hook delivery and shutdown failures. Do not label long-term terminal reliability fixed.

## An independently reproduced error-contract regression

The first new full parallel combination was **44/45**, process exit1 (`initial-contract-44of45.txt`). Its single failure was *not either terminal case*: `test/workspace-omp.test.mjs:330` correctly refused an injected non-admitted cached receipt before a new model request, but a late profile-neutral error-text edit had changed the expected public-scope refusal message. Production error text now restores the original public message and retains the correct private-profile message. The existing assertion, failed status and zero new model-call requirements are unchanged. This fixes a reproducible error-contract regression; it is not claimed as a fix for the historical TUI flakiness.

## Issue and human-review boundaries

Read-only GitHub verification found **#70–#74 all open**, all original checklists unchanged. No issue was closed or acceptance checkbox set. #70 has component evidence and an unresolved intermittent terminal risk; #71 and #73 have synthetic-material/actual-component evidence; #72 still lacks successful real public-source verification; #74 remains blocked by real material authorization, safe existing model configuration, verifiable cumulative CNY5 allowance and real sources. [GAPS](../factory-workflow-20261015/GAPS.md) records these distinctions.

The model-selected `confirmed:true` from the old inquiry contract was not human approval. The [draft-only correction](../factory-inquiry-review-boundary-20261015/README.md) removes that claim: saving only creates unreviewed internal drafts, never approval or sending. Human review of specific documents/versions and subsequent external actions retain their original approval boundary. Seven-day continuous notification permission remains unapproved and undeveloped.
