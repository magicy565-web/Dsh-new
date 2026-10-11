# Muse source intake and Linux validation

Date: 2026-10-11 (Asia/Shanghai).

## Source provenance

Authenticated SSH access to the existing ECS succeeded. A source-only snapshot was
read from the original Dot release
`/opt/workspace-dot/releases/7279e6346910b43fc879f5a99fd581be47a9a73f`
and Muse release `/opt/workspace-muse/releases/muse-fixed-20261009`.
It contains 18,182 regular files (Dot 1,709; Muse 16,473), including the deployed
Harness source and built exports. Every extracted file passed its SHA-256 check.
The archive excludes dependency directories, runtime data, private test homes,
credential files and symbolic links; it is not a credential or data backup.

Source archive SHA-256:
`31865fe18bb09d3ee3b965d0c4b9a5ea8b9052478941ee00bfc08a39eb3f6b1b`.
The release manifest declares a commit-like label that the repository API does not
resolve. Treat that directory as a deployment identifier, not a verified Git SHA.
All included files covered by the original release manifest matched their recorded
hashes; its excluded CA certificate was not compared.

The PR snapshot at `4e4246ffe3b380c5762f648e5692379e4eedcafd` was independently
verified against all 195 Git blob IDs. The subsequent `96dd690` commit reorganizes
overlay packaging and documents activation; it preserves the executable code
validated here. The three source-fixture configuration fixes in this change were
applied identically to the Linux test copy and local files, with matching SHA-256.

## Repaired fixture setup

The smaller Dot Harness omits SDK server and agent-loop testkit modules. The
separate deployed Muse Harness includes both and its built public exports.
However, the source tests forced `TSX_TSCONFIG_PATH` to a missing root
`tsconfig.json`. They now use the existing `tsconfig.base.json` source-resolution
facade when available, retaining the older root-config fallback. No source
assertion, storage fsync or skip condition was weakened.

For the full backend suite, set `DSH_TEST_SOURCE_ROOT` to that complete Muse
Harness tree. For the native Cordis Host test, also set `TSX_TSCONFIG_PATH` to the
Dot Harness `tsconfig.base.json` and load its installed `tsx` ESM loader explicitly.
This preserves one source-level Cordis dependency graph.

## Executed checks

Ubuntu 24.04.4, Node 24.21.0, isolated temporary HOME/TMPDIR and fixture stores:

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full backend (`node scripts/test-backend.mjs`) | 367 | 0 | 0 |
| DOM (`node --test test/ui.dom.test.mjs`) | 19 | 0 | 0 |
| Native binding, disk-backed service and Cordis boot | 11 | 0 | 0 |
| Source fixture repair subset | 30 | 0 | 0 |

Counts overlap and must not be added. `npm ci` and `npm run build` exited 0.
The 30 source-fixture checks are included in the backend count; the native binding
checks also overlap it. Provider calls are scripted fixtures. No paid model
request or production data was used. Initial runs and final logs are retained in
the local validation evidence archive for auditability.

Validation archive SHA-256:
`54046897d59200833ae0a3efeebe7dafc54f9bee7029d943d38c56048a4d6117`.

## Live observation and remaining acceptance

The active backend now runs from
`/opt/workspace-dot/releases/muse-native-20261011-1023` and is active/running.
All 12 files in the current overlay manifest match the active release. These are
read-only observations of the concurrently activated release; this validation did
not switch services or edit production configuration.

A verified HTTPS request to
`https://workspace.cnsubscribe.xyz/api/muse-worker/v1/identity` returns
`404 MW_GATEWAY_UNAVAILABLE`, explicitly indicating that Muse REST is not yet
configured. Independent Muse credential/Vault authorization, execution gates,
external budget enforcement and a real accepted research task remain unverified.
The passing tests do not establish those live outcomes or repair old Dot OAuth.
