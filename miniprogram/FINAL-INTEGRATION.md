# Unified development integration after the 18:56 checkpoint

The fixed `65252e2` source/import packages remain an immutable checkpoint. Small later fixes are committed/pushed with tests, without regenerating large archives. The final unified source/import package will be generated after the independent TUI and supplier MCP fixed commits are integrated and validated.

## Original notification cold recovery

Reproduced on the original compiled Page/Client, signed local HTTP and persisted original Store: create two distinct supplier products, execute one separately approved first-sample or seven-day notification for the older product, lose its local acknowledgement, then restart server/client and enter directly through `onShow`. The page had no supplier mode and selected the newer product because only `supplier-*` and `publication-*` pending requests restored the business context; notification pending labels were also missing.

Minimal fix: treat the existing `notification-*` journal kinds as supplier business recovery, restore the existing `pendingSupplierId`, and label the original pending notification operation. No change to sender, consent, approval, native subscription, request journal, role or backend semantics. The new tests cover both notification phases and duplicate retry clicks, verify the original monitor/operation/request body, and require exactly one provider attempt, one native popup and no second monitor. Unknown delivery stays unknown.

Validation: `npm run build:mini` passed; `node --test miniprogram/test/business-recovery-regressions.test.mjs miniprogram/test/notification-closure-client.test.mjs miniprogram/test/publication-client.test.mjs miniprogram/test/lifecycle.test.mjs` passed 36/36. Reproduction failed before the two-line page change on both notification phases. Local transport/provider fixtures only; no live WeChat/Muse/Shopify proof.

Further integration remains in progress. No main merge, force push, production/deployment, payment or credential/permission creation.

## Pi TUI integration

Cherry-picked the independently handed-off commits `533a2ab759f8208c3b3300ae7f4e91342eab0ff1`, then `0fbdeb04e0a5ae00755163b8ed81e8c741c7ab70` in order. Integrated commits are `59f2b6f` and `2ce3efc`; all TUI files and the isolated dependency lock remain under `tui/`, without changing root dependencies or the existing backend execution kernel.

Reverified on the unified branch: exact README `npm --prefix tui ci` and `npm --prefix tui start -- --version` (private temporary data directory) return Pi coding-agent 1.1.0; TUI tests 5/5; actual installed Pi CLI/PTY keyboard-and-confirmation smoke has seven checks including the unchanged Python consumer's same-task claim/heartbeat/upload/submit and cold TUI readback; original Pi/Muse binding/policy tests 3/3; consumer offline tests 40/40. Model runs remain zero in the local transport fixture. Earlier installation with `--ignore-scripts` also worked; the documented normal install was then checked separately.

No existing live owner transport, remote Muse installation/version/egress, actual owner login, real external task claim/return or production authority was supplied. Passing actual Pi TUI runtime does not prove those missing integrations. Windows/PowerShell remains unverified.

Additional original draft approval/rejection response-loss tests pass for both decisions: cold restore replays the exact original request and scope, one operation/approval remains, zero Shopify creates/uploads; duplicate retry clicks cause one replay. `business-recovery-regressions.test.mjs` now reports 6/6 including nested phase/decision cases.

## GitHub CI observations (commit-specific)

Parent's read-only check: packaging head `d4612de0c251039898b0f1c59824d5721e447f99` has runs 38292607838 and 38292535772, both startup_failure with zero jobs. Earlier 38284242811 is historical. This agent read the original workflow API for integrated TUI head `2ce3efc85cad8e7af670ca9d7c3088399f4e3cde`: PR-triggered run 38293253100 is completed/startup_failure; jobs API returned an empty list. None is a passing CI run. No rerun, billing, repository settings or workflow changes were made.
