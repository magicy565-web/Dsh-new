# Native memory-fact lifecycle: isolated SDK acceptance

Date: 2026-10-17. Source commit: `b2c44fae0d3e690ca1ac9c8ccfd7c2a9e5f06c80`.

## Actual result

The two new test files passed **17/17** in one server invocation: 5 pure
lifecycle-contract tests and 12 official SDK tests with synthetic data and
finite model responses/SSE. Node reported suites 0, pass 17, fail 0, cancelled
0, skipped 0, todo 0, duration_ms **31725.376859**; exit status **0**.
Completion was observed at 2026-10-17 20:22:46 UTC. No test rerun or assertion
change was needed.

The log is named `tests.tap`, but its contents use Node's default **spec text
reporter**, not TAP wire format. Its 1,710 bytes have SHA256
`534de87127328c69ba5f6f86fea83b398db5aa9d9e2330aaf9e1d986d920d4de`.
Only this sanitized narrative and evidence hashes are included in GitHub;
the original runtime log remains outside the repository.

This closes the pending SDK test item in
[the recovery record](NATIVE-MEMORY-FACTS-RECOVERY-20261017.md). It does not
establish real-model business acceptance or production deployment. The earlier
Host 71/71 result is separate and is not counted in these 17 new tests.

## Exact source and runtime

The server used its existing isolated 1,238-file acceptance source: original
dbccbf9 plus the four document-reference changes and five committed Host v4
source/test changes. It applied only the eight-file increment, not a branch
pull or the entire current repository.

- Recovered archive: 88,026 bytes; SHA256
  `da943364caad2004efdbe916c24fcfd239907f0910e1e285f645d11e060378d1`.
- Unchanged reviewed patch: 58,824 bytes; SHA256
  `65979a9b53e060e5cdf36025b323b5c200ab06f6f0ad8964f904f890fa1a086a`.
- Baseline manifest SHA256:
  `f3576ec1060d9d26e548b39b6ddf462d24d797c28caa275183017adcd61cd638`.
- Increment manifest SHA256:
  `e1ca9c5e154dd08e4c2cd764b4b78b125ae4cf5374888f90920fdeecc7af95b8`.
- Source checker SHA256:
  `3d685c367e96318b22ea69d5c9aa88fd4126b1ffc23f199b89b2f82aba5a71bb`.
- Actual runtimes: Node **24.19.0**, Bun **1.3.14**, OMP **18.10.4**,
  root **@earendil-works/pi-ai 1.1.0**. Existing installations were reused.

An initial diagnostic queried the wrong older package namespace
`@mariozechner/pi-ai` and returned MODULE_NOT_FOUND. Reading the original
package declaration identified `@earendil-works/pi-ai`; its actual installed
version was verified. No dependency was installed or substituted for that
mistaken diagnostic.

## Exact invocation and source checks

```sh
NODE=/opt/workspace-acceptance-20261017/node-v24.19.0-linux-x64/bin/node
TESTROOT=/tmp/brain-document-reference-7bGsdW4h/brain-document-reference-source-dbccbf9-20261017
NATIVE_WORK=/tmp/native-facts-acceptance-20261017-Acrm6B
INCREMENT="$NATIVE_WORK/native-memory-facts-recovered-20261017"
WORKSPACE_BUN_BIN=/opt/workspace-acceptance-20261017/workspace-agent/support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun
WORKSPACE_OMP_PACKAGE_ROOT=/opt/workspace-acceptance-20261017/workspace-agent/support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent

(
  cd "$TESTROOT/source" &&
  env -i \
    PATH="$(dirname "$NODE"):/usr/bin:/bin" \
    HOME="$TESTROOT/verification-home" \
    NO_COLOR=1 \
    WORKSPACE_BUN_BIN="$WORKSPACE_BUN_BIN" \
    WORKSPACE_OMP_PACKAGE_ROOT="$WORKSPACE_OMP_PACKAGE_ROOT" \
    "$NODE" --test --test-concurrency=1 \
      test/workspace-omp-fact-lifecycle-contract.test.mjs \
      test/workspace-omp-native-memory-facts.test.mjs
) > "$NATIVE_WORK/tests.tap" 2>&1
TEST_EXIT=$?
printf '%s\n' "$TEST_EXIT" > "$NATIVE_WORK/test-exit.txt"
"$NODE" "$INCREMENT/verify-increment.mjs" after "$TESTROOT/source" \
  > "$NATIVE_WORK/post-test-verify.log" 2>&1
VERIFY_EXIT=$?
```

The archive checksum, archive member safety check and all five checksums in
SHA256SUMS passed. The source checker verified **1,238 exact files before**
application. `git apply --check` and `git apply` passed once. The checker then
verified **1,242 exact files after application and again after tests**; every
check exited 0. Package and lock files were included and remained unchanged.
The checker rejects changed, missing, symlinked, nonregular or unexpected
source files; only node_modules dependency directories are excluded.

Evidence hashes retained on the server:

| Evidence | Bytes | SHA256 |
|---|---:|---|
| preflight.log | 253 | `8d0522cf8687b84d4e68b097c9d19a93a53c027ce0674c02296ec298d95973dd` |
| apply.log | 105 | `7e7957ef16a42d9109d3194c7c772fd0f45d978d7555cca859546190ac02a0b4` |
| post-test-verify.log | 105 | `7e7957ef16a42d9109d3194c7c772fd0f45d978d7555cca859546190ac02a0b4` |
| test-exit.txt | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |

## Twelve SDK cases and their actual coverage

1. Actual SDK ID binds the original Node fact Host before saveSession and the
   first model event; a normal second turn preserves the mapping/receiver/ID,
   saves source-backed Context and Decision, references the existing Goal,
   and leaves Goal records and executionRefs unchanged.
2. No fact selection retains the original default mapping and tool path.
3–5. Adding, removing or changing initial trusted fact selection on the same
   Session refuses before any model request and preserves the saved mapping.
6. Original allowMemoryRead=false refuses before binding, saving or requesting.
7. An ordinary dependency change at disclosure withholds the answer.
8. Node's final current check withholds output after a dependency change.
9. Cancelling the original active Run stops its native fact Session without
   final delivery or execution references.
10–12. Fresh official SDK finite-SSE cases exercise actual provider Request
   serialization and the wire gate for normal delivery, dependency change and
   cancellation. These use a loopback test RPC bridge to the original Node Host;
   the preceding finite-response cases exercise the production worker bridge.

The additional five pure tests reject incomplete/nonfunction lifecycle callback
pairs or a second profile before SDK initialization. Test counts are cases,
not a count of every assertion in each case.

## Remaining boundary

All materials, facts, identities and model responses were synthetic. No paid
model request or Docling parser request occurred. Running Medusa, Docling,
API, database and authentication settings were unchanged. This is acceptance
of the narrow SDK/Host lifecycle and fixtures, not a real-model facts-to-Brain
business result or user-facing default configuration.

Initial trusted exact fact selection, original Library/model receiver grants,
Session/Run/current/commit checks and unchanged old scope/catalog behavior are
still required. An old Session cannot acquire facts retroactively. The excluded
receipt-restoration review or variants were neither changed nor retried.
