# Native memory-fact lifecycle: recovered source, SDK acceptance pending

Date: 2026-10-17.

This development commit preserves eight previously reviewed source/test files
after the local executor reverted to an older filesystem snapshot. It is not a
deployment or an SDK acceptance claim. All eight files were recovered from the
actual original tool records and pinned GitHub originals; no missing logic was
guessed or added during recovery.

## Exact source identity

- Original production preimages: db04918440c1a1c1af18ef31f47efa47b44f5cbd.
- Development parent verified: bc30d7faf26c55fab46033cf9001e23eaa602a56.
- Recovered complete eight-file patch: 58,824 bytes.
- SHA256: 65979a9b53e060e5cdf36025b323b5c200ab06f6f0ad8964f904f890fa1a086a.
- This equals the original final reviewed patch byte for byte.
- The recovery archive has new metadata and its own hash:
  da943364caad2004efdbe916c24fcfd239907f0910e1e285f645d11e060378d1
  (88,026 bytes); it is not the lost archive.

The source changes are four existing production files:
server/pi-business-agent.mjs, server/workspace-omp-bridge.mjs,
server/workspace-omp-worker.mjs, server/workspace-omp-session.mjs;
plus test/fixtures/brain-native-facts-host.mjs,
test/fixtures/brain-native-facts-wire.mjs,
test/workspace-omp-fact-lifecycle-contract.test.mjs, and
test/workspace-omp-native-memory-facts.test.mjs.

## Checks actually repeated after recovery

Node 24.19.0, original source, no package stubs:

- All 1,238 files in the existing isolated acceptance baseline matched.
- git apply --check and patch application succeeded.
- All 1,242 expected source files matched after application.
- node --check passed for each of the eight recovered files.
- node --test --test-concurrency=1 test/workspace-omp-fact-lifecycle-contract.test.mjs:
  5 tests passed, fail/cancelled/skipped/todo all zero; 110.131039 ms.
- All 1,242 source files matched again after the tests.
- Package and dependency-lock files were included in these checks and unchanged.

The isolated baseline is the original dbccbf9 source bundle with four
document-reference changes plus five committed Host v4 source/test changes.
It is not a claim that the entire current development branch was tested.

## Pending SDK acceptance

12 new actual-SDK finite-model integration tests remain unexecuted at the time
of this commit. The combined intended command has 17 new tests (5 pure + 12 SDK):

```sh
node --test --test-concurrency=1 \
  test/workspace-omp-fact-lifecycle-contract.test.mjs \
  test/workspace-omp-native-memory-facts.test.mjs
```

The isolated runner needs the original locked root pi-ai 1.1.0 and the existing
official OMP 18.10.4/Bun 1.3.14 installation selected by WORKSPACE_OMP_PACKAGE_ROOT
and WORKSPACE_BUN_BIN. No real model requests are needed. The earlier Host
71/71 result does not replace these SDK lifecycle tests.

## Scope retained

Initial trusted exact fact keys and allowMemoryRead select this optional
capability. Original Host authority stays in the Node closure. Actual SDK native
Session ID must bind before saving the mapping or the first model request.
Original receiver, Session, Run, all fact dependencies/current and final commit/
disclosure checks remain enforced. Normal same-scope second turns preserve the
Session ID; adding, removing or changing selection on an existing Session refuses.

No extra profile is enabled, no Store/policy is copied, and no default fact
permission is created. Default no-fact behavior remains the original path.
The old prohibited receipt-restoration review and its variants are not part of
this recovery or test command. No runtime logs, credentials, business data,
real-model result, deployment or production acceptance is included.
