# Original Dot Session recovery

This candidate extends the current `muse-reviewed-3f972c4-20261011` native Host. The six payload files are listed with before/after SHA-256 in PATCH-MANIFEST.json. Only the existing production maintainer should integrate and publish them. No credentials or production data are packaged.

The new actions are private Host file actions. They are absent from browser HTTP and MCP/model tools. Existing `resume-empty`, Muse approvals, original grants, keys, callbacks, OAuth subject and authorization durations remain intact.

1. Freeze backend deployments and new orders. Confirm no unfinished delegation, unresolved native submission or pending service operation. Keep the single business writer and original native Sessions.
2. Integrate the manifest-verified payload into the latest native release. Independently run the original Dot/Muse regression suite and the three real Harness scenarios below. Back up the existing release/configuration using the normal deployment workflow; do not reset or edit the business database.
3. After the sole controlled restart, obtain current Host epoch/configurationHash and original Dot connection ID/authorizationEpoch. Never reuse the old epoch 43 or connection epoch 35 without inspecting current state.
4. Select the existing private WORKSPACE_NATIVE_REVIEW_FILE with owner-controlled mode 600. Submit an `inspect-reviewed-history` command, version 1, a fresh requestId, current expectedEpoch/configurationHash, empty callbackCandidateIds, and original connectionId/authorizationEpoch. It writes `native-review-REQUESTID.result.json` with historyHash and a metadata-only summary. It does not resume execution or edit Goals/tasks. Read the exact report before recovery.
5. Select a second private `resume-reviewed-history` command with a fresh requestId, the same still-current epoch/configuration/connection, empty callbackCandidateIds, and the exact inspected historyHash. Do not include new bindings or callbacks. The Host recomputes and checks the complete digest; a stale or changed review is rejected.
6. If the Host is paused, restore its scope first. If it is already active, only restore the original paused Dot connection. The existing native runner then rebinds original OAuth/tool handles, persists the original binding with its new connection epoch, and refreshes the existing Muse mount without changing its configured gates.
7. Verify the private result, original identity/inbox, all original receipts/files and unchanged pending Goal. Recovery creates no task or attempt and performs no model turn. Explicit retry of a previously persisted question must use its original browser requestId and byte-identical content. It will retain the original Goal and dispatch at most one task after a fresh authenticated Dot event subscription.

Completed history must have terminal exact receipts, durable original Session delivery, requester acceptance/closure and exact saved file versions whose bytes pass the artifact SHA-256 check. An active undispatched Goal is eligible only when it is the exact preceding confirmed public user input with the stable native input ID, unchanged revision 1, zero started rounds, and `activation=disarmed`. Model-created or already-running Goals, orphaned/incomplete job history, changed receipts, draining/revoked connections and concurrent native changes are rejected.

Do not blindly repeat a review after a partial private-file/storage failure. Inspect the original connection, scope, binding file and private receipt first. Preserve the original tasks and any unresolved authority. No automatic restart, task replay or permission extension is introduced here.

Linux test commands (all use isolated temporary data; synthetic results and OAuth identities, no external model):

```sh
export DSH_TEST_SOURCE_ROOT=/absolute/original/harness
export DSH_TEST_PACKAGE_ROOT=/absolute/isolated/candidate
export TSX_TSCONFIG_PATH="$DSH_TEST_SOURCE_ROOT/tsconfig.base.json"
node --import "$DSH_TEST_SOURCE_ROOT/node_modules/tsx/dist/esm/index.mjs" --test "$DSH_TEST_PACKAGE_ROOT/test/workspace-dot-history-review.test.mjs" "$DSH_TEST_PACKAGE_ROOT/test/workspace-dot-native.test.mjs"
node --import "$DSH_TEST_SOURCE_ROOT/node_modules/tsx/dist/esm/index.mjs" "$DSH_TEST_PACKAGE_ROOT/test/fixtures/workspace-dot-history-native.mjs" "$DSH_TEST_SOURCE_ROOT" "$DSH_TEST_PACKAGE_ROOT" settled
node --import "$DSH_TEST_SOURCE_ROOT/node_modules/tsx/dist/esm/index.mjs" "$DSH_TEST_PACKAGE_ROOT/test/fixtures/workspace-dot-history-native.mjs" "$DSH_TEST_SOURCE_ROOT" "$DSH_TEST_PACKAGE_ROOT" pending
node --import "$DSH_TEST_SOURCE_ROOT/node_modules/tsx/dist/esm/index.mjs" "$DSH_TEST_PACKAGE_ROOT/test/fixtures/workspace-dot-history-native.mjs" "$DSH_TEST_SOURCE_ROOT" "$DSH_TEST_PACKAGE_ROOT" active-pending
```

These are restart/ownership/integrity regression checks. They do not prove real Dot/Muse execution or business acceptance. Native execution remains reported as independently unverified.
