# Document tuple schema correction and installed-SDK acceptance

Correction source commit: `95e83ed66f1abcd36302f69883c0cbacc4fcc724` (four files, exact remote contents and Git-tree delta checked).

Parent source commit: `d12bab4d96fb5c92af6b9bbc25695764488e05b9` on the original PR99 development branch. This correction contains one production file and three test files. No lock, permission, receiver, current-source validation, budget or public error path changes.

## Why this correction is needed

The fixed official OMP 18.10.4 source (`687892d1046ecaf18829b45f5b86928a308258f4`) uses strict schema normalization for the DeepSeek-host compatibility path. It preserves object alternatives, converts literal `const` to singleton `enum`, and closes each object branch independently. The previous model-facing `structuredMemoryRemember` schema put only the three exact-key fields inside each alternative, while requiring `statement` at the root. The strict-normalized branch can therefore exclude the required statement. Separately, the finite test provider incorrectly demanded the original `const` spelling on the final wire.

- [Official provider conversion](https://github.com/can1357/oh-my-pi/blob/687892d1046ecaf18829b45f5b86928a308258f4/packages/ai/src/providers/openai-completions.ts#L2798-L2870)
- [Official strict schema normalization](https://github.com/can1357/oh-my-pi/blob/687892d1046ecaf18829b45f5b86928a308258f4/packages/ai/src/utils/schema/normalize.ts#L2172-L2276)
- [Official object closure](https://github.com/can1357/oh-my-pi/blob/687892d1046ecaf18829b45f5b86928a308258f4/packages/ai/src/utils/schema/normalize.ts#L2345-L2347)

The preceding d12bab4d constructor-entry correction is verified effective in the third server round: enabled-document requests now reach the actual finite provider and the clarification case passes. The remaining request counts are consistent with the first document-tool selection in the finite fixture. This strict-schema explanation is a separate static compatibility finding; no original failing wire schema was retained.

At the time of the source correction these were static official-source findings, with installed-SDK verification pending. The later probe and Session results below now supply that separate evidence. The original probe remains pinned to the old extension SHA; no earlier failed wire capture is claimed.

## Minimal changes

1. Every `oneOf` branch now retains the complete original object properties, required fields and closed-object rule. Only the three exact tuple fields are narrowed by the selected constants. `statement` stays free text under the original 1–4000 length contract. Branches remain correlated; no cross-product of independent enums is introduced.
2. The finite provider takes only contract tuple keys from one complete advertised branch, accepts a literal or a single-value enum, and refuses ambiguous enums. The statement still comes from the actual synthetic parser tool result. Fixture configuration still forbids private `query`/`asset` shortcuts.
3. SDK assertion diagnostics preserve only a whitelist of tool/schema shape metadata before temporary fixture teardown. They do not print schema values, HTTP headers, credentials, uploaded body or raw model context. Production errors remain unchanged.

## Local evidence

Command from the original source directory: `node --test test/workspace-native-capability-discovery.test.mjs` with Node v24.19.0.

Result: 10/10, fail/cancel/skip/todo 0, exit 0, 729.7401 ms. Independent review also ran 10/10, exit 0, 1050.051459 ms. This includes an isolated actual finite-preload process tested with synthetic const/singleton-enum forms and a rejected multi-value enum. It does not replace or emulate SDK normalization. Log SHA-256 `25b6fa60e7b97254ae162c5c507defd2246b73307f3cef5d1ecc7c9ce8f4ad00`.

The same branch-contract assertion against exact parent extension bytes fails because `statement` is missing; fixed bytes pass. Parent red log SHA-256 `d76d490c52b54dbdfb0bd0e14d1a26ab00ca9f290b57f3952eb5eed363bb8ab8`; fixed green log SHA-256 `e84562c290321d7f88250609f9ccbf0afa19297f69f258ddb9c1c9dd236d99f9`. This is a structural regression, not an installed-SDK result.

## Keep all prior server outcomes

- Original 2376015 package preflight failed before tests: import-only pi-ai exports were checked using the CommonJS resolver. Corrected packaging uses Node24 `findPackageJSON` without changing dependencies.
- Packaging v2: SDK 1/5, Host 1/2, pure/narrow 15/15, overall exit 1. Sanitized report SHA `7736d6851a34f60c63ef8805e6b470ebc30c2cc945551c135e4ee31d592e514f`.
- Constructor fix d12bab4d: SDK 2/5, Host 2/2, pure/narrow 16/16, total 20/23, overall exit 1. Clarification and default four-call cases pass; main document chain, exact lookup and document eight-call case still fail. Sanitized report SHA `6fe2a2597ae51bf5c487f966f8e521c7cb652ae662e06543b1e0502149fdd636`.
- All 1295 source paths and 43899 dependency/runtime files/links remained unchanged during the last two server rounds. No prior acceptance is relabelled as corrected SDK success.

The isolated runs use original Node24.19.0, Bun1.3.14, OMP18.10.4 and root locked pi-ai1.1.0, with synthetic documents, loopback synthetic Docling and a no-fallback finite provider. No real model charge, production deployment or forbidden old receipt restoration test is part of this evidence.


## Actual installed-SDK probes and document chain (06:19–06:20 UTC)

Source identity: exact fixed `2376015b5749b621ee7ca0d673c2c499323e3976` 1295-path subset plus d12bab4d and 95e83ed6 corrections across six paths. Nine later documentation-only additions were absent. This was not a whole latest-HEAD deployment.

Two fresh helper-only probes used the installed OMP18.10.4 SDK, original Bun1.3.14 with `--no-install`, empty HOME/environment and a fetch function that throws. They created no Session or model request. Observed compatibility: strict=true, mixed strict mode, root object union allowed. The old remember schema accepted the legal statement before adaptation but rejected it after adaptation with `additionalProperties`; const became singleton enum. The corrected parse/lookup/remember schemas all accepted their legal inputs after actual strict adaptation, with free statement and closed correlated branches retained. These are fresh helper results, not the original failed wire capture. Both diagnostic probes exited 0.

The selected test group completed **23/24, overall exit1**: SDK4/5, Host2/2 and pure/narrow17/17, no cancelled/skipped/todo. Preserve that failed overall result.

The primary installed-SDK case passed in **10379.813207 ms**, through the real original startup, HTTP upload, Library, Session/Run and tool adapters:

- Zero preseeded facts; the model stand-in discovered exact asset/fact parameters from actual tool schema and read the enterprise handbook through the original Skill tool.
- One bounded synthetic Docling request; actual model tool remembered its source-bound statement. First turn used seven finite provider requests.
- Brain Context and Decision persisted against the original reviewed Goal; original page GET worked, another subject received404.
- The same native Session continued for a second turn using three requests. Decision revision2 retained Context revision1 and the unchanged original Goal; no external action/execution reference was created.
- Ordinary fact revocation then refused the original context GET. No extra Run was started.
- Separate model-selected clarification and lookup-only cases passed without forced parse/write/Brain sequence. The no-document default-four bound also passed.

The only failure was a budget fixture repeatedly choosing one identical lookup: five requests were observed rather than eight. Its terminal Run error was not preserved in that round. Do not describe this as a successful all24 run or infer the stopping cause from count alone.

Command shape, with the already verified absolute runtime paths supplied to the original isolated wrapper: `env -i PATH=/usr/bin:/bin /bin/bash ./run-focused.sh "$NODE_BIN" "$BUN_BIN" "$OMP_PACKAGE_ROOT" "$LOCKED_DONOR"`. The wrapper used Node `--test --test-concurrency=1 --test-reporter=tap` for the selected SDK file, two named Host cases, and three pure/narrow files. Before and after, all1295 exact source files and43899 dependency/runtime files or links matched; package/lock and envelope hashes stayed unchanged.

Sanitized report:12139 bytes, SHA256 `d79ac0b9b0e66fdb214d91b348467d2dee56de9261ff10555f011498dd0c56c6`. SDK log:10449 bytes, SHA256 `6a037d0ca1eec8340858bb4d4fe0b953f0ca96c9925285965dc19bbc69ef24dd`. Old/new probe output SHA256: `baab1ec19254f3fc6edc8f7747f9e24dae16f9b20952e303114a44f049196342` / `f65cb9f1438c8559012e2934815d3cdd0828fa8257ac89aaf5046e68024f8876`.

## Separate exact-budget acceptance (06:34 UTC)

Test-only commit `8895d9fe76dd295e843a14875ff209e64c50f612` changed three fixture/test files. Every production source byte was checked equal to the preceding95e run. A fresh independent directory retained the exact1295-file subset and43899 dependency/runtime pre/post checks. No previously successful mainchain, Host or pure case was rerun.

The wrapper selected only these stages in order:

1. `--test-name-pattern='^diagnostic only: repeated identical document lookups ' test/workspace-native-document-mainchain-sdk.test.mjs`. This completed diagnostic execution, not a product acceptance. The original synthetic Run failed with `OMP_SESSION_FAILED`; actual Session metadata contained `tool-call-loop-redirect` count5, five provider requests and no failed tool receipts. This establishes the original SDK redirect, without requiring every repeated trajectory to be a product policy or claiming a more specific terminal exception than was observed.
2. `--test-name-pattern='^initial reviewed document capability retains original eight-call limit ' test/workspace-native-document-mainchain-sdk.test.mjs`. **1/1 passed**, exit0, case3180.855636 ms (group3789.16168 ms). Eight distinct initially reviewed query tuples were discovered from complete actual wire-schema branches; all eight lookup receipts succeeded, exactly eight provider requests occurred, no loop redirect occurred, and a ninth provider send was refused. No parser call, fact write or completed assistant message was produced by this boundary case.

The two-stage wrapper exited0. Diagnostic completion is not added to product pass counts. This separately closes the budget test gap; it is not a retroactive all24 rerun. Production request caps, authorization, SDK guard and budget arithmetic were unchanged.

Sanitized report:11446 bytes, SHA256 `f2af85cfecbc8cf3b3ac6b3a3c64d188deadb9d23bcb0fa837bbc2cb9871a05f`. Budget log:603 bytes, SHA256 `19319141c6173eda827d625b99e6611ea15c273ecb1b98e697106aabfe0d3a65`. Diagnostic log:8600 bytes, SHA256 `b79076d5cff9deb9667c8a1afefc5c67900eef3cc52584fe3c161fd03b614480`. Final source manifest SHA256 `ac8b5ae60ae4482d507507fa1720ac45b6d2f7ede65384cc955bc4c2c3976306`.

## Product boundary

The SDK, startup, HTTP Library and business tool lifecycle were real; provider responses and parser data were finite synthetic fixtures. Actual finite-provider summaries recorded zero external-model requests. Preflight declarations alone are not used as evidence. This proves the selected normal source-bound workflow and budget boundary, not a real-model business run, deployed browser workflow, persistent currency budget or production authentication ingress. The two-Run paid acceptance selector remains an acceptance closure, not continuous online budget infrastructure. Raw journals/logs, server paths, keys and runtime configurations are not committed.
