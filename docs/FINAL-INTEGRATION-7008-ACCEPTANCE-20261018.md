# PR111 / Space final integration acceptance, 2026-10-18

The fixed integrated source through `7008f5b66731edcd12cb62aa33eb3c4a19ce3218` passed its selected build and **70/70 product tests** in one isolated run, 08:20:45–08:22:12 UTC. Overall exit was 0; all 12 test stages exited 0 with fail/cancel/skip/todo each zero. No source repair or assertion change occurred during this run.

## Precise identity and execution

- This was the verified 1355-file source subset based on `2376015b5749b621ee7ca0d673c2c499323e3976`, the nine declared commits through `30500368986f9bbb5e310734e1aacee17add9802`, then PR111 integration `a9f6243e970e16a72cbe652d0524479946d95214` and Space integration `7008f5b66731edcd12cb62aa33eb3c4a19ce3218`. It was not a full Git tree.
- Source-manifest SHA256: `6d3c578a485b465e442dfeea9d7a5ed852b1ac1baf9feba90bfa72c0c410521b`. The source increment contained exactly 55 changed paths from the earlier 1320-file subset, including 35 added-to-subset paths.
- Reviewed acceptance archive: 284119 bytes, SHA256 `26b750a6e51926335d848c469ed5888d357a28531222ba76bd2eb86c4eff8543`. Combined patch SHA256: `632817aa0e0c0a8758341527cfab85d17ff31ade7ee79c312c1d65a69def22b0`.
- A fresh private directory was materialized from only declared source and named wrappers. No prior build, results, home, runtime fixture or dependency link was copied. The runner used an empty allowlisted environment, a fresh private short TMPDIR and the original pinned dependency donor. Each test group was bounded at 180 seconds plus 10 seconds cleanup grace; no timeout fired.
- Original `npm run build:web` ran TypeScript `--noEmit` and Vite and exited 0. Every source file, all 45992 dependency/runtime files or links, all 2223 selected browser/npm/Caddy files or links, and the envelope matched before/after. Package and lock were unchanged.

The exact grouped commands are the original files below under `node --test --test-concurrency=1 --test-reporter=tap`. The document SDK group additionally used `--test-skip-pattern='diagnostic only:'`; the two capability Host cases used `--test-name-pattern='^document capability discovery '`. DOM used `--test-isolation=none`. The separately retained repeated-lookup diagnostic was not executed or counted.

| Original selected group | Passed |
|---|---:|
| `plugin-backend-lifecycle.test.mjs` | 5 |
| `medusa-catalog-http.test.mjs` | 1 |
| `workspace-native-document-mainchain-sdk.test.mjs` | 5 |
| `workspace-continuous-budget-sdk.test.mjs` | 2 |
| `workspace-goal-owner-http.test.mjs` | 1 |
| Selected `goal-brain-memory-fact.test.mjs` cases | 2 |
| `space-signed-host`, `space-medusa-source`, `space-sources-host` test files | 17 |
| `space-sources-ui.dom.test.mjs` | 5 |
| `harness-web-release.browser.mjs` | 11 |
| Authenticated-ingress core / HTTP / Caddy test files | 15 + 5 + 1 |
| **Total** | **70** |

## What passed, and the limits

The original startup/HTTP/SDK path uploaded synthetic material, parsed it through a synthetic Docling endpoint, let the finite provider discover authorized tuples from actual wire schemas, saved source-bound structured memory without preseeded facts, saved Brain Context/Decision against an HTTP-created existing Goal and continued the same native Session. Original current-source/receiver/member gates and ordinary memory revocation were exercised. Clarification and lookup-only cases passed without a mandatory business sequence. The eight-call and default four-call limits remained unchanged.

The continuous-budget group passed three same-Session Runs and the unknown-usage hold before a later send. It exercised the committed persistent accounting implementation; synthetic usage is not an actual provider bill. Goal creation did not execute the Goal or authorize business spending.

Node 24.19.0, Bun 1.3.14, official OMP 18.10.4 and pi-ai 1.1.0 were real. Model replies were finite synthetic SSE, not a real model: `native-document-provider-preload.mjs` replaces SDK `fetch`, accepts only the pinned provider URL/method and directly constructs responses without calling the original fetch. Original test assertions checked the finite provider summaries and zero external model requests. No separate exported provider network audit or successful live-model invocation is claimed.

Backend lifecycle tests used an isolated copy for module removal/reinstallation and preserved original Library state. They do not establish arbitrary hot unloading of an enabled production application. Space Host tests used original signed enterprise HTTP/Session/Store and a local synthetic Medusa service. Space DOM used actual React and original Host with synthetic source transport; widths are not visual-geometry measurements. Ordinary Space operation idempotency/history is distinct from old OMP receipt restoration; that prohibited review and PR112 were not selected.

The actual browser used the approved Chrome 156.0.8078.4 with Playwright 1.61.1, sandbox requested and verified. Its 11 checks used synthetic API responses and explicitly reported `originalServer=false`, `originalSdk=false`, zero external model calls and exact verified-source-subset identity. The ingress Caddy case used installed Caddy 2.11.7 with temporary synthetic credentials and protected local transport. Neither configured production authentication nor changed the production Caddy service. The existing TypeScript/Vite/React versions remained 6.0.3 / 8.0.16 / 18.3.1.

## Explicit remaining deployment boundaries

This run does not deploy the source, create real credentials, contact a paid model, prove live Docling/Medusa/PostgreSQL, or certify the untested PR109 production review API. Original authenticated startup still needs the actual owner member/key configuration, a valid original Agent read-only principal, reviewed exact document/Artifact/Goal pins, approved model/parser recipients and durable budget. The finite fixture cannot substitute for those production inputs.

Space CLI currently supports explicit `WORKSPACE_SPACE_ENABLED` only. A live Medusa approved-source reader still requires trusted `createApp.spaceOptions.medusaSource` injection; no CLI/env loader for that reader was shipped in this candidate. Catalog admin configuration does not create this read scope. Keep it unconfigured until a separately reviewed minimal assembly, real PR109 endpoint acceptance and dedicated read-token/data-disclosure authorization exist. Do not reuse a Medusa admin key, add automatic source discovery or imply model access from a Space citation.

The earlier 305 result remains 65+32 composed evidence with its retained packaging failures. These new 70 tests are the final candidate's distinct affected-regression evidence, not a sum with older runs.

## Evidence digests

The final sanitized operator report is 12562 bytes, SHA256 `9fc2326615ab88580313978ee6646d4411f4399aec4f4ff1325f3cdd24ba598f`. Its checksum-verified safe evidence summary is 17933 bytes, SHA256 `f7e965ff692a50bcbb1350be886dd586d99d992feb6e8aa4cc2df9e7a8651642`. Only bounded result/digest information is included here; raw logs, runtime paths, original JSON, credentials and screenshots are not committed.

- Build log: `c62b06917ebc392d16a4469b393562d8292350553cb663f7c83431ac36be739c`.
- Document SDK log: `7cad3860804abc303698b50d19b91af58ccaf92476de96cbf1973a93268c6881`.
- Continuous SDK log: `7b7fd7154af1f6b448f728180530ddae061742feb544b5283815ee600aa0ee8d`.
- Space Host log: `810298748692b3177f68a82f0b24af8357803766145aa980c28735eb285bbb7d`; Space DOM log: `2728d3dd35736ce5f61562246507d7665056e6b9e77362bf79fc67ef0e1e718b`.
- Browser report: `40b7fae248ee56999af186dc3e848390de92c33c3efde9fb31d43efc55d74c23`.
- All-stage exit-code file: `dd6f3ae3d47d03977455413a3afb4153cec159e0ace0e9ce3fe6fc839920364c`.
