# Brain page response ordering: local client acceptance

Base: `da04f977535b724d2ea22077f80670f1962b4f39`, PR99 development branch. Date: 2026-10-18 UTC.

## Defect and minimal change

Overlapping reads of the same Brain page could finish out of order. A newer `BRAIN_SOURCE_CHANGED` response correctly cleared the card and Decision dialog, but an older successful response could subsequently restore their stale contents. The page now numbers each read within its existing effect. Only the latest request may set the brief, error or loading state. Existing effect cleanup still rejects results after conversation removal, navigation or unmount. No Host, source permission, model, receipt or default-capability logic changed.

## Reproduction and actual result

`test/workspace-brain-page-client.test.mjs` compiles the original Brain component subtree, mounts its actual React components, and calls the original `api()` over real loopback HTTP with synthetic response bodies. The test controls ordinary polling callbacks and response order. For every delivered response it waits for actual HTTP JSON consumption, the resulting promise continuations and React `act()` rendering; absence assertions do not use a fixed post-response sleep.

One continuous scenario covers:

- A persisted Decision opens and continues in its original conversation; a newer unrelated conversation does not retarget the page.
- An older request's `finally` cannot end the latest request's loading indicator.
- A newer source/version refusal clears the card and dialog; an older successful response cannot refill them or erase the actionable refusal.
- Navigation to a different conversation, removal of the displayed conversation and unmount all reject late previous-page responses.

The identical final test was run against a separate copy containing the unchanged baseline Brain component: exit 1, failing `An older success cannot replace a newer refusal`. Against the changed component: **1/1 passed**, fail/cancel/skip/todo 0, exit 0, total 2819.799328 ms. This is one client lifecycle test, not a count of separate SDK assertions.

- Baseline component SHA-256: `1a68fb59debf43b62a3f68442c9416a0094f2b89f48944af9446027d5f85afe4`.
- Baseline-failure log: 1043 bytes, SHA-256 `53aca9270d5972d34299baddab46c16649e13ab541993bec56f571d003c6313e`.
- Final-pass log: 245 bytes, SHA-256 `cc1d5629c3cfadb3d925be4c57c608566f29bee7f31374b208cfe634f2f7c59b`.

Only sanitized methods/results and hashes are committed; the local logs and temporary fixture trees are not repository artifacts.

## Reproduce with normal project dependencies

Node 24.19.0/npm 11.9.0 were used. From a clean checkout with network access to the official registry:

```sh
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
node --test test/workspace-brain-page-client.test.mjs
```

The test resolves dependencies through the checkout's normal `node_modules`; it has no machine-specific installation path. It uses TypeScript 6.0.3, React/ReactDOM 18.3.1, JSDOM 29.1.1, `@types/react` 18.3.31 and `@types/react-dom` 18.3.7. Every directly used version was read from the actual installed package and matches this repository's lock. This local run reused those real packages from an existing project installation through a temporary `node_modules` symlink, because a fresh isolated install was unavailable. No package stubs or older package versions were substituted. The test-only CommonJS compile and JSDOM CSS/no-layout support do not modify production imports, source configuration or CSS.

The isolated official-registry `npm ci` attempt used a fresh HOME/cache/config, `--fetch-retries=0 --fetch-timeout=20000`, and failed with registry DNS `EAI_AGAIN` followed by npm's `Exit handler never called!` (exit 1; no completed package installation). The reviewed executor alternative failed before npm started; it was stopped. No lock was changed.

Package hashes before and after:

- `package.json`: `2491412413bf931503c6f34295fe46bdfb4a520c29650b895529a557d527fb94`
- `package-lock.json`: `2a7969eb6e35551c7d75cf9aa944d4f461de86d1e84e1afb28312d8187fa19bb`

## Boundaries and remaining acceptance

`npm run build:web` was actually attempted and exited 2 at TypeScript because `@assistant-ui/react` 0.15.28 is absent from the available installation (including resulting implicit-any errors). Vite was not reached. The actual `workspace-brain-read-http-compat.test.mjs` command was also attempted but stopped before assertions because original imports require unavailable `@earendil-works/pi-ai` 1.1.0. These are unresolved dependency blockers, not successful full-App or Host-HTTP acceptance.

The passing test demonstrates client response ordering and conversation lifecycle with real React/API/HTTP. It does not establish browser visual/layout correctness, server authorization enforcement, full application build, native SDK/real-model behavior, or deployment. The separately prepared upload→model remember→Brain→continuation SDK slice still awaits its own acceptance. No production service, paid model or previously restricted receipt-restoration review was run here.
