# PR111 backend service integration

Date: 2026-10-18 UTC. Status: source integration with local compatibility evidence; final combined App HTTP and official SDK acceptance is pending.

## Exact source identity

- Mainline parent: `30500368986f9bbb5e310734e1aacee17add9802`.
- Selected PR111 source: `b2903442ab50e97ab082b320f3aab40f0b7f1be3`.
- Common ancestor used for the two overlapping files: `7e88a7807a2a16fc324de582dc8605b76f748d83`.
- 28 selected implementation/test/documentation files: 26 retain the fixed PR111 bytes. Only `server/index.mjs` and `server/pi-business-agent.mjs` use clean three-way composition with the mainline parent. This integration note is an additional file.
- Reviewed 28-file patch SHA256: `8f4478d95dd1f477c7b42db296b3403e401071dd19ccc4bee8039fd8a868414c`.
- Selected-file manifest SHA256: `ae2fc10f85829014ac7d02acdbbd764e45c04a696a763ab8114d3eefeeb8b6f0`. Its preparation-status text predates final approval; the file hashes are unchanged.

The selection moves existing enterprise-context and Medusa services into their plugin packages, retains server compatibility exports, and adds the existing backend-selection/lifecycle contract. No root dependency or lock version changes are included.

## Mainline behavior retained

The composed `server/index.mjs` retains trusted actor propagation for ordinary Goal creation, the reviewed configuration's `modelBudget` field, and its forwarding into the business adapter. `server/pi-business-agent.mjs` retains the original `budgetStore: store` and `assertBudgetCurrent: assertActive` arguments. The durable budget reserve/settlement implementation is unchanged.

The enterprise binding authority and its existing source, receiver, current-state and final disclosure checks remain in place. The extracted tool service retains complete correlated `oneOf` branches, including the free `statement` field and its existing limits. The Medusa server compatibility factory still supplies the original environment and error class; the standalone package factory does not implicitly read the process environment.

## Meaning of backend selection

`backendPlugins` is trusted App startup composition. On the standard business path, creating a new enterprise binding goes through the App's selection guard before backend import. Native extension/schema loading does not create an independent backend authority. Medusa selection similarly controls creation of its client and HTTP handler.

This is startup/new-binding disablement. It is not a claim of process isolation, hot revocation, deletion of data, or physical removal of every dependency. Programmatic use of a package factory or explicitly supplied trusted Host remains a trusted composition boundary. Backend selection does not grant model tool permission, recipient permission, or write approval.

## Local verification on the applied candidate

Actual runtime: Node `v24.19.0`. All commands below exited 0 on the selected source after applying the exact reviewed patch.

```sh
node --test test/plugin-service-boundary.test.mjs \
  test/enterprise-context-extension.test.mjs \
  test/enterprise-context-oss.test.mjs \
  test/medusa-catalog.test.mjs \
  test/workspace-native-capability-discovery.test.mjs
node test/plugin-service-parity.mjs "$FROZEN_MAINLINE_305_SOURCE"
node scripts/check-plugins.mjs --pack
```

- Five original test files: 41/41, fail/cancel/skip/todo 0, 756.239384 ms. Log SHA256 `f05eca3a839a35c8b21a0ed0a72f6a9bdd2607e0ae53033dbd2794efd7bcbe60`.
- Compatibility runner: 90/90 comparisons against the frozen parent source. It compares schemas, tool outputs and call order using synthetic clients. Log SHA256 `50891d701127a1774163f4a36a021b661d81c3270b3a53fea75dd6d8e6905993`.
- All 15 plugin packages passed static import and `npm pack --dry-run` closure checks. The report is explicitly `staticOnly: true`; business tools and model requests were not executed. Log SHA256 `b0a7cde2d273df1ab43d32b658a673af3e60657a39202ad2887aa077f8e270b4`.

Independent review also ran the same five-file 41-case set, the 90 comparisons and 15-package static check. Separately, it ran three unchanged no-App lifecycle cases in a temporary harness after omitting the unavailable App import. Those 3/3 cases are limited lifecycle evidence, not a pass for the original complete lifecycle test file. They cover selection snapshots, close/cancellation, and refusing a success receipt or retry after a possibly committed remote operation.

## Pending acceptance and limits

The review's original seven-file invocation exited 1: 41 assertion cases passed, while two files failed to load because the local locked `@earendil-works/pi-ai` dependency was absent. The actual Node total was 43, including two file-load failures, not 47 passing cases. The original App HTTP/lifecycle cases and four selected Host cases therefore remain unexecuted locally. Official runtime preflight was also unavailable locally; neither static package checking nor synthetic parity is official loader/AgentSession evidence.

The separate fixed-parent Web/auth acceptance package remains unchanged. Its results cannot establish this later backend extraction's combined HTTP/SDK behavior. A subsequent isolated run on the integrated source is required before release. This integration does not deploy services or call a paid model. Original run logs, credentials and application data are not committed.
