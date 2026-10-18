# Document tuple schema correction: SDK verification pending

Correction source commit: `95e83ed66f1abcd36302f69883c0cbacc4fcc724` (four files, exact remote contents and Git-tree delta checked).

Parent source commit: `d12bab4d96fb5c92af6b9bbc25695764488e05b9` on the original PR99 development branch. This correction contains one production file and three test files. No lock, permission, receiver, current-source validation, budget or public error path changes.

## Why this correction is needed

The fixed official OMP 18.10.4 source (`687892d1046ecaf18829b45f5b86928a308258f4`) uses strict schema normalization for the DeepSeek-host compatibility path. It preserves object alternatives, converts literal `const` to singleton `enum`, and closes each object branch independently. The previous model-facing `structuredMemoryRemember` schema put only the three exact-key fields inside each alternative, while requiring `statement` at the root. The strict-normalized branch can therefore exclude the required statement. Separately, the finite test provider incorrectly demanded the original `const` spelling on the final wire.

- [Official provider conversion](https://github.com/can1357/oh-my-pi/blob/687892d1046ecaf18829b45f5b86928a308258f4/packages/ai/src/providers/openai-completions.ts#L2798-L2870)
- [Official strict schema normalization](https://github.com/can1357/oh-my-pi/blob/687892d1046ecaf18829b45f5b86928a308258f4/packages/ai/src/utils/schema/normalize.ts#L2172-L2276)
- [Official object closure](https://github.com/can1357/oh-my-pi/blob/687892d1046ecaf18829b45f5b86928a308258f4/packages/ai/src/utils/schema/normalize.ts#L2345-L2347)

The preceding d12bab4d constructor-entry correction is verified effective in the third server round: enabled-document requests now reach the actual finite provider and the clarification case passes. The remaining request counts are consistent with the first document-tool selection in the finite fixture. This strict-schema explanation is a separate static compatibility finding; no original failing wire schema was retained.

These are static official-source findings. The actual installed-SDK schema-helper probe and corrected complete Session tests have not run yet. The original probe remains pinned to the old extension SHA, so the previous shape can still be reproduced.

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

The pending isolated run still uses original Node24.19.0, Bun1.3.14, OMP18.10.4 and root locked pi-ai1.1.0. It has synthetic documents, loopback synthetic Docling and a no-fallback finite provider. No real model charge, production deployment or forbidden old receipt restoration test is part of the correction.
