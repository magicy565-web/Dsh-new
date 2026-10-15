# Factory plugin interface acceptance

Base: PR #68 at `d82d35fd7213012ff6b0e5f2f24d765aba021a9e`. Branch: `codex/standardize-factory-plugin-interfaces-20261015`. The change implements the existing materials/customer/inquiry contracts; it does not wire the separate plan, monitor, ingestion or Shopify plugins.

## Result

- Three private standard packages are versioned 0.2.0 with explicit repository/license metadata, portable `./contracts` exports and TypeScript input declarations. Root entrypoints/tool names and the existing inquiries `./drafts` and customers validator imports remain compatible.
- Registered JSON Schemas and direct runtime validation share business constraints. Complete typed original inquiry/product source references, exact selector/API/workspace correspondence, safe filenames, empty/NUL/newline rejection and safe integer versions are checked before dispatch. Source order is normalized without dictating the model's tool order.
- Error, unconfigured and partial-save results preserve the upstream content/details envelope and mark `isError`; partial material extraction remains data with its uncertainty. Failures have distinguishable safe reasons and suppress arbitrary Host exception text/codes.
- The existing worker/bridge, original Library transport and `pi-business-agent` closure preserve per-operation and original Run cancellation through to original reads and commit checks. The last closure now combines both signals rather than dropping the operation signal. No new scheduler, framework, grant or executor was added.
- Existing original artifacts remain the only save service. Exact concurrent replay creates one artifact per file; changed requests conflict; partial batches resume after original Store restart. Edited/versioned original artifacts cannot be claimed as the unchanged draft on replay. Explicit review/unsent flags are required from injected save callbacks, and model `confirmed` fields cannot constitute approval.

The [interface/migration contract](../../FACTORY-PLUGIN-INTERFACES.md) lists the exact DTOs, Host signatures, error semantics, compatibility changes and six minimal A/E integration locations. The common changes are confined to existing transport/disclosure boundaries; `server/index.mjs`, `workspace-omp-session.mjs` and all A/B/E new files are unchanged. Skills remain guidance, with optional file saving and variable model-written output. Shopify data and writes remain with the existing Shopify service.

## Verification

`checks.json` records exact commands, exit codes, counts and ephemeral test-output hashes. `source.json` records the scoped source/test/doc files and SHA-256 values. `upstream-audit.json` records pinned packages, inspected official SDK source paths/hashes, license evidence and the optional writing-reference checks. No real business records, credentials or raw Session/Run journals are included.

- **133/133**, zero skips/failures/cancellations, exit 0, **134.004 seconds**: complete affected factory, OMP/terminal/native tool, original Pi business conversation and Library regression, explicitly using the installed audited OMP SDK path. An earlier broad run had 131 passes and two environment-gated skips; both were exercised successfully in the final run.
- **13/13**, zero skips/failures, exit 0: final supplemental checks for portable package exports, declaration consumption, real raw schema validators (47 cases per engine), seven separate business-policy cases per engine, a real Pi customer SDK loop, error/partial/cancellation/authority boundaries, inquiry source-order normalization and original-service idempotency. These cases overlap the 133; counts must not be added.
- `npm run typecheck` and `git diff --check`: exit 0.
- Existing copied-package tests actually execute official Pi install/list/disable/remove and OMP local link/list/disable/enable/uninstall outside the repository, plus Skill/native-tool coexistence. The interface test also executes `npm pack --dry-run --ignore-scripts` and TypeScript declaration consumption for every package.
- Original-service tests cover invalid selectors, foreign members/enterprises, wrong recipient, changed sources/versions, forged cached receipts, pre/post revocation, original artifact commit cancellation, request conflicts, same-Run concurrent duplicates, edited artifacts and partial-save recovery across actual app/Store restart. The original material client's pending response reader is explicitly cancelled without receipt disclosure.

## What this proves and what it does not

The actual official package/CLI/SDK/schema/tool/Skill and original HTTP/Session/Library/Run/Store/artifact components execute. Model answers/tool choices are finite explicitly keyless scripts. Some isolated SDK tests inject clearly labelled synthetic client callbacks; the original-service integration suites separately exercise actual persistence and authorization. Their counts do not prove real model judgment or prose quality. Real/paid model calls: **0**.

No real enterprise material authorization, verified customer, live commercial publishing or business outcome was tested. The existing hosted CI startup problem is not claimed fixed; local passing tests are not hosted CI success. A/B/E and independent Shopify integration must still be performed in their own authorized scope using the documented seams. This branch does not change/merge main, force-push, deploy, create credentials, grant new permissions, contact customers or run paid models.

`gh` GraphQL repository lookup was forbidden in this environment. The connected GitHub API successfully confirmed the private repository and push permission; it is the PR creation fallback. This is a connector-path limitation, not a failed implementation check.
