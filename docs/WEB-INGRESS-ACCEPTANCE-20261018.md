# Web and authenticated-ingress acceptance, 2026-10-18

## Fixed 305 source identity

The verified source was the 1320-file subset based on `2376015b5749b621ee7ca0d673c2c499323e3976` with declared source changes through `30500368986f9bbb5e310734e1aacee17add9802`. Its manifest SHA256 was `20157cabe716fe9bf11d907be4eced0e47f9d6c25c2c286b30c04ab183f1ce57`. This was not a complete Git tree and did not include later PR111 or Space changes.

All 97 planned product assertions have passing evidence across two executions: 65 completed in the original partial run, then the remaining 32 passed on an unchanged-source continuation. This is not a claim that one 97-test process exited successfully.

## Results and retained failures

- The original locked `npm run build:web` (TypeScript check plus Vite build) exited 0. Contracts passed 10/10 and DOM passed 27/27. The auth log completed all 28 original access/audit checks.
- An earlier preflight had stopped before build or any test because the expected Chromium checksum had one transcribed hexadecimal character wrong. The binary was unchanged; three independent checksum readings established the correct pin. The first failure was retained.
- In the partial run, a long acceptance TMPDIR exceeded Chromium singleton-socket and ingress Unix-socket path limits. All 11 browser bodies failed in setup; the Caddy auth fixture failed configuration after the 28 access/audit bodies. Its stuck test process was explicitly stopped and terminated. Suspension/termination was not counted as a passing exit.
- The continuation used a fresh short mode-0700 TMPDIR, an empty allowlisted environment and the same locked source/dependencies. Only the original three built assets were copied, with an exact file-set/hash check before copying and before/after tests. Application/test source and assertions were unchanged.
- From 08:07:29 to 08:07:58 UTC, browser 11/11, ingress core 15/15, ingress HTTP 5/5 and Caddy 1/1 passed, each with zero failure, cancellation or skip; the continuation naturally exited 0. Previously passed 65 bodies were not repeated. Stage timeouts did not fire.

The continuation preserved exact before/after checks for 1320 source files, three build assets, 45992 dependency/runtime files or links, 2223 selected browser/npm/Caddy files or links, and the acceptance envelope. Original package and lock hashes were unchanged.

## What the evidence establishes

- Node 24.19.0, Bun 1.3.14, OMP 18.10.4, pi-ai 1.1.0, TypeScript 6.0.3, Vite 8.0.16, React/ReactDOM 18.3.1, JSDOM 29.1.1 and Playwright 1.61.1 were the original checked installations. The selected existing Chrome 156.0.8078.4 was separately pinned; it was not presented as Playwright's bundled revision.
- The real browser launched with sandbox requested and verified. Its 11 checks covered the built UI, conversation continuity, citations, explicit unavailable/unconfigured states and small-screen geometry. API responses were synthetic: the report explicitly recorded `originalServer=false`, `originalSdk=false` and zero external model calls. These browser checks alone do not prove deployed backend login or real model replies.
- The original HTTP ingress tests passed, including the previously failing maximum-size base64 upload after the independently reviewed canonical-validation fix.
- Installed Caddy 2.11.7 was used in a temporary local fixture. It exercised Basic authentication, protected Unix transport, overwritten identity, removed Authorization, exact signed request bytes and SSE cancellation. Identities/keys/data were synthetic; production owner provisioning and Caddy configuration were not changed.
- DOM tests exercised actual UI code but used synthetic model/provider or source transports where stated in the original fixtures. They are not real business data, live Medusa, Docling or paid-provider acceptance.

## Evidence digests

Only method, result and digest metadata are recorded here. Original running logs, screenshots, credentials and runtime data are not part of this repository note.

- First preflight failure report: `88deaf759b2869e4dc19553a0c5d93996ff6bac844e8d8e70175b316119d27b7`.
- Partial-run report: `1853c94a0e42a3194422b6d8da1bb9121696685b43f5e9aee853ad4205857a0c`.
- Remaining-32 report: `083446a987d9e080352eca91f04c62b1dd7831cdead67e27df1ef6ba4ab56fd3`.
- Original three-asset manifest: `7f8a5ec92fa63652b401f6fb19cce51cdbcde5c5d68799c31fbf83daf8b79d1f`.
- Browser continuation log: `f04a3d05061c067a90d9b0a9e0ceacf6e1698f65d675e10ab0a104584d905884`; browser report: `0b60083e89623ae21d5ba08571d08d22fbbeea761a647a5391f28458943a6b75`.
- Ingress HTTP log: `2811dfb79f135e03f4d305241443a715e81fdd54732f90361502058fc7b4b9c4`; Caddy log: `b4c83f22a652f727a37da20490eef23b9d2e32cbf041d8bd84c565caa06492bf`.

Later source integrations need their own affected regressions. This 305 evidence does not automatically certify the final PR111/Space candidate, production deployment, real credentials or real model spending.
