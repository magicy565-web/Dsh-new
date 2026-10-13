# Original native conversation path compatibility — offline checkpoint

Date: 2026-10-13 UTC. Builds on bootstrap commit `646e5536fdcd7803f69c85e2fcc1b1504546d240` on PR #59. No changes from independent PR #60 are included or covered by this evidence.

## Reproduced issue and minimal correction

With the original ID `original:tui/conversation`, the unchanged Pi client could connect after the bootstrap fix but `client.list()` failed at the actual old overlay route with `WORKSPACE_PLUGIN_OWNER`. Pi correctly URL-encodes the path segment. The old frontend compared that encoded segment directly with the original actor's raw native ID.

The frontend now decodes only the captured conversation identifier once, then performs the same exact original-owner comparison. This applies to Muse delegation and original conversation message routes. It does not replace or narrow the original identifier, change the original ingress/signature, reinterpret the whole path, select another owner, or change business logic. Malformed UTF-8/percent encoding returns `400 INVALID_PATH`. A double-encoded or other-owner identifier still fails the original owner check; viewer and foreign administrator checks remain effective.

## Verification

- New baseline test, before this correction: actual signed old route + unchanged Pi client failed with `WORKSPACE_PLUGIN_OWNER` (expected failure).
- Focused native/bootstrap/path tests: 17 passed, 0 failed.
- Full backend: 706 passed, 8 skipped, 0 failed. This is two additional tests above the bootstrap 704/8 checkpoint. The same historical Git-object skip remains.
- Existing Pi TUI, model-tool and supplier-MCP protocol tests: 14 passed, 0 failed (9 + 3 + 2).
- Valid encoded native IDs containing `:`, `/`, and `@` reach the real read-only delegation list and produce zero business writes. Malformed and double-encoded segments, other owners and viewers are checked.
- The message-route mutation probe reaches the correct owner binding then deliberately throws `OFFLINE_PREPARE_REACHED` before preparation. It proves routing only, not real queue creation or Muse execution.

Evidence: `docs/validation/offline-native-path-20261013/`. Commands:

```sh
node --test test/muse-native-bootstrap.test.mjs test/muse-worker.native-binding.test.mjs
npm test
node --test tui/test/*.test.mjs tui/integration/agent-tools.test.mjs tui/integration/supplier-mcp.test.mjs
```

All test authentication, parent lifecycle, business data and Worker counterparts are disposable offline fixtures. The dependency substitutions and unavailable original Host modules described in [the bootstrap checkpoint](OLD-HOST-BOOTSTRAP.md) still apply. No Huawei endpoint, server or live Muse was contacted.

## Delivery and remaining gates

Only explicit source/test/acceptance files are appended to the existing PR #59 branch; historical local omissions are not repository deletions. Earlier portable ZIPs are not rebuilt, re-uploaded or claimed current. Pending ZIP approval remains separate.

The bootstrap commit's GitHub run [38328570453](https://github.com/magicy565-web/workspace-agent/actions/runs/38328570453) completed with `startup_failure` and zero jobs; local results do not substitute for successful remote CI. The final commit's CI must be checked separately after publication.

Real acceptance still needs the original custom-plugin Host login and foreground terminal adapter, an existing authorized original Muse session/conversation, and a user-approved server-on test window. Bootstrap and path compatibility do not provide the missing foreground launcher or verify real Muse claim/result. Do not create conversation rows, copy tokens, change credentials or attach the ordinary app launcher to the old Host object just to satisfy these prerequisites.
