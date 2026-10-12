# Unified recovery integration

The independent `codex/integration-recovery-20261012` branch recovers integration without writing the original PR56 branch. Its base is the actual PR56 head `41d45fa25997fa5f1d8a89d104f9a6accb59ce58`, which already contains the supplier owner MCP / GA4 work and the first Pi TUI patches. The two remaining PR58 commits were applied in order with `cherry-pick -x`:

| Original PR58 commit | Integrated commit |
| --- | --- |
| `2b2b5188a72c801435b5bb9807f9ba2f24e4fc9e` | `d89aa076b7c948120030fbb7ddfb27cb81396d23` |
| `47b4dfb787ba67dc86ec7644840d6f53c54a7c0f` | `07d2f5a793ff5c23f28e7a27e11fca12cb310c85` |

[PATCH-SOURCES.json](PATCH-SOURCES.json) records the original supplier and TUI patch mappings and retained account-isolation fixes. Two historical patch IDs differ because their unchanged fixture context retains binary HTTP response bytes from `d0bbe12`; all added and removed lines in those two patches match. This does not discard the image-byte/account-isolation fixes.

The original integration task completed its handoff with evidence-only commit [`9148e23dad830458f3f552fcc6513ad26d3d4125`](https://github.com/magicy565-web/workspace-agent/tree/9148e23dad830458f3f552fcc6513ad26d3d4125/docs/validation/unified-candidate-41d45fa). Its diff from `41d45fa` contains only that validation directory and no unpublished application source. Those logs describe the older candidate and its methods; they are not substituted for tests of this branch's additional Agent mode and final fixes. Final packaging is owned by this recovery branch alone.

## Source and evidence

The current fallback delivery uses the **portable checkpoint** profile in [`PORTABLE-DELIVERY.md`](../../miniprogram/scripts/PORTABLE-DELIVERY.md). It includes every tracked current source/config/test/document path except the fixed historical-output prefixes; the required `docs/validation/managed-commerce-sources.json` test input is explicitly retained. Every excluded path, mode, Git blob and reason is listed in `SOURCE-MANIFEST.json`. `exactGitTree=false`: this package does not contain or reconstruct the complete Git tree or Git history. The immutable GitHub source SHA remains canonical.

The source and WeChat import manifests name the same full source commit and tree. The verifier checks the pinned original commit, full tree metadata, every included source blob, explicit exclusions and client archive integrity. This alone does not prove compilation equivalence; a separate clean extraction/install/build and byte comparison must establish that result.

The earlier full-tree packager remains unchanged for environments that possess all historical blobs. Its archives include every tracked historical file; those older archives are never the current client.

Validation records distinguish the source commit being exercised from a later evidence-only delivery commit. Generated screenshots, logs and archives are added after source freeze; they are not recursive inputs to the archive that contains them. Do not relabel earlier counts, screenshots, historical acceptance JSON fields or uncommitted diagnostic hooks as final-source acceptance. Each run records command, exit code, source before/after and evidence hashes. Failed initial runs remain available alongside follow-up runs.

For the earlier full-tree profile only, use the existing packager and verifier with an explicit source commit and backend commit (never the packager's historical default):

```sh
python3 miniprogram/scripts/package-fixed-combination.py --repository "$REPOSITORY" --commit "$SOURCE_COMMIT" --backend "$SOURCE_COMMIT" --compiled "$REPOSITORY/release/miniprogram" --output "$DELIVERY_DIRECTORY"
python3 miniprogram/scripts/verify-fixed-delivery.py --source "$SOURCE_ARCHIVE" --client "$CLIENT_ARCHIVE" --destination "$NEW_CLEAN_DIRECTORY" --record "$VERIFICATION_RECORD"
```

That full-tree verifier safely extracts the archive, checks every blob/mode/hash and reconstructs the exact Git tree. It does not restore Git history. The portable verifier deliberately makes no full-tree reconstruction claim. Both source profiles can be built with the original lockfiles and scripts; compare resulting mini client bytes against `BUILD-MANIFEST.json`.

## Minimal reproduced corrections

The recovery checks exposed two reachable UI defects. The first bootstrap completion could select the latest conversation after a user had already clicked Goals; the initial selection now requires an unchanged navigation revision. A deterministic delayed-bootstrap test retains the explicit Goals route and confirms it starts no work.

The original Muse delegation list cleared its value on every same-path refresh. This unmounted an in-progress verified attachment preview and aborted its download. The existing read hook now has an opt-in same-path refresh retention mode used only by MuseConversation. The original component key still contains workspace, user, role and conversation. Writes remain blocked while loading; changing paths or receiving a read failure clears the retained value. File SHA checks, abort handling, server authorization and existing approval methods are unchanged. The deterministic slow-file regression also checks that a refused refresh removes the old preview and file controls.

Browser-driver corrections wait for the prior page operation to finish and drain the existing render queue before closing Chromium. Current reports read their actual source commit from Git and allow isolated output directories. The main-conversation scenario explicitly requires no active Shopify review; dedicated publication and notification scenarios cover the mounted approval component. These changes do not alter product permissions or production services.

The old standalone Commerce page is deliberately retired, documented in [TT041-CONVERSATION-UI-CANDIDATE.md](../TT041-CONVERSATION-UI-CANDIDATE.md) and implemented by `7b891844`. Current navigation omits it, App no longer imports/mounts the old panel, and `/commerce` maps to the original Library. Current-route tests verify that mapping and the real Library's private draft CRUD, revision conflict, current-editor request retry, dirty navigation, failed detail reads and viewer restrictions. The old supply component's distinct supplier/listing, durable pending-request and exact publication-confirmation checks remain separate component contracts using a test-only in-memory bundle; that harness does not restore a production route or claim the old page is user reachable. Its dirty-state callback and the current App's actual navigation guard are checked separately. Library has draft/archived products, no publish endpoint, and no persisted pending-request scope; these are not claimed equivalent to the retired supplier/listing features and no such feature was added.

The supplier browser driver now reaches the same unconfigured draft-creation boundary through the current “审阅草稿创建与已选图片上传” UI and the original compiled approval component. Default-empty consent, the exact preview hash and action, blocked preparation, zero execute requests and an instrumented zero Shopify-fetch count are checked before the original disabled monitoring/null data/stable summary/reentry/cancellation checks continue. The older button timeout remains in the earlier candidate evidence; it is not silently removed or counted as a pass of that old source.

## Boundaries and remaining acceptance

All current integration checks use local synthetic fixtures. Actual Pi PTY tests launch the original Pi CLI and original extensions; their provider is a temporary loopback fixture. They are evidence of transport/tool/queue/receipt behavior, not real natural-language model quality or a real native Host/Muse execution. Browser screenshots use compiled original Page/Component code and original WXML/WXSS in a limited Chromium renderer; they are not WeChat DevTools or device evidence.

The existing signed owner-session supplier MCP and separately configured owner-binding MCP preserve their original admission and approval checks. The worker endpoint remains lease-bound and read-only. GA4 metadata configuration is not an account connection; startup tests use synthetic configuration only. Unknown public-image availability stays unknown. A publication request receipt is not an observed publication timestamp, and the original shopify-observation path is required for publication-relative monitoring.

No new credentials, account permissions or persistent access were created. No production/model/Shopify/Muse/notification call, deployment, payment, main update/merge or force push is authorized by this recovery. The future seven-day notification's durable continuing consent and persisted recipient-authority design remain unapproved; this work keeps the existing manual approvals and does not add that design. Real provider/Host/Muse, Shopify/GA4, WeChat/device, Windows and independent security acceptance remain separate gates. CI startup failures with no jobs are not passing test evidence.

The initial merged and `c3e9fd2` checkpoints retain their exact earlier failures in separate historical evidence. Their passes are never substituted for a later source. A baseline-identical file alone is not evidence that a user-visible defect is acceptable; reachable defects were corrected and obsolete harness routes were migrated with their distinct safety assertions preserved. Final reports separate current product routes from the retired component contract, and list all remaining non-synthetic acceptance gates.

## Fallback validation checkpoint

[`ac358ff`](../../test/muse-conversation-ui.dom.test.mjs) adds a bounded wait for actual unmount abort before retaining the existing strict signal assertion. The historical intermittent immediate-signal failure did not reproduce in the fallback environment. Removing the product's unmount abort in a temporary mutation experiment makes the test fail before the independent 20-second read timeout; original product bytes were then restored and verified. [Mutation and regression evidence](../validation/fallback-abort-checkpoint/README.md) records those distinctions.

[Fallback evidence](../validation/fallback-ac358ff/README.md) records backend 698 pass/8 skip, UI 19, combined conversation 17, current Library/retired Supply component 13, mini business 126, and three actual Pi PTY suites using deterministic local fixtures. The extra backend skip relative to cloud 699/7 is the historical Git-object proof unavailable in a source-only checkout. Chromium startup is blocked before page assertions by this environment's socket restriction; earlier browser evidence remains historical. No new screenshot/browser-pass or independent security-acceptance claim follows from these DOM and protocol results. Later frozen-source delivery validation must name its own exact commit.
