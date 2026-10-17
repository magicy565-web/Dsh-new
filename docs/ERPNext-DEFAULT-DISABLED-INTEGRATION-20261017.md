# ERPNext adapter: selected source intake, default disabled

## Version and scope

The 11 new files from PR108 HEAD `91c0dd43e6d271907530738fca5ace2e5fe18ad7`
are copied byte-for-byte onto integration parent
`432e46702dd04d69827eb040e47d622e0115715c`. This is a selective source intake,
not a merge of the Work branch or an activation/deployment. The original author
handoff remains unchanged, including its accurate then-unavailable SDK evidence.
This separate note records later independent verification.

The selected files are the seven files under `plugins/workspace-erpnext-enterprise`,
three dedicated files under `test/erpnext-enterprise-adapter`, and
`docs/ERPNext-ENTERPRISE-ADAPTER-HANDOFF-20261017.md`. All were additions; the
integration-parent tree had no conflicting paths. Original free-trade client,
shared loader/configuration/allowlist, Host/RPC/journal, UI and root dependency
locks are unchanged. The existing 21 document-to-Brain slice files retain their
reviewed hashes. Its isolated 1,245→1,252 source patch/package remains unchanged;
this extra plugin is not implicitly included in that pending SDK verification.

The original `projectPlugins` selector discovers this package but leaves it
disabled in `config.json`, `config.business.json`, `config.enterprise-context.json`
and `config.medusa-enterprise-readonly.json`. Its two definitions are unconfigured
without the original trusted capability. No real ERP authorization is created.

## Independent evidence, separately scoped

On 2026-10-17, the independent server verifier ran the fixed source-review kit
at 22:24:30–22:24:33 UTC, exit 0, using actual Node24.19.0, Bun1.3.14 and official
OMP18.10.4:

- Native-ESM syntax/manifest build passed; no transpilation was required.
- Package tests 27/27, unchanged original client tests 77/77, independent ordinary
  disclosure-gate tests 6/6. Each had fail/cancel/skip/todo 0. Inputs and responses
  were synthetic with loopback HTTP; no real ERPNext or model calls.
- Official `discoverExtensionPaths`/`loadExtensions` loaded the two original
  definitions. Original `toolWireSchema`, `isJsonSchemaValueValid` and
  `validateToolArguments` accepted their plain empty-object JSON schema and
  rejected non-object/additional URL/fields/name arguments.
- Default unconfigured direct tool execution and staged discovery, enable,
  disable, none, re-enable and temporary-package uninstall passed.
- 25 fixed source files checked before/after; 40 source/harness/Bun/selected SDK
  input hashes were identical. This does not cover every transitive dependency.

The review kit runner was invoked as:

```sh
env -i PATH=/usr/bin:/bin HOME="$ISOLATED_KIT_PARENT" \
  /bin/bash review/run-review.sh "$NODE24" "$BUN_1_3_14" "$OMP_18_10_4_PACKAGE_ROOT"
```

These names stand for the exact preverified original binaries/package and an
independent temporary kit directory. No credentials, SDK replacement, dependency
install, production restart or real ERP configuration was part of the run.
The runner's own input hashes and exact invocation are retained with the bounded
acceptance record, not copied here as runtime paths or original logs.

Evidence identities:

- Source-review archive: 81,856 bytes, SHA256
  `0e6fb8e3454d7ba6cf4bdc0d5dbb2916a732a475ed0d5cd3c74011f16d8667f6`.
- Original loader/schema result: 509 bytes, SHA256
  `0bdfe24eb7dfdd1c280b974c18bf8758f023a26010348f26b94afa2fdb6ca1bc`.
- Complete bounded verifier report: 8,292 bytes, SHA256
  `89ddd63792488e5efe5848aa58cf903a21bd4149b8f9d07632aaa47c0445c3ca`.

The intake writer separately reran on the current source combination:

```sh
node plugins/workspace-erpnext-enterprise/scripts/build.mjs
node test/erpnext-enterprise-adapter/verify.mjs
node scripts/check-plugins.mjs --pack
```

Build and all-15-package static pack closure exited 0; packed external imports
passed 27/27 (350.400207ms; fail/cancel/skip/todo 0), Node24.19.0. Pack commands
used an isolated HOME/npm cache/config and offline ignore-scripts packing.
The new plugin remained disabled. This local combination check did not rerun
77/6 or official SDK; those results above belong to the independent verifier.

## Still not a connected business feature

Official evidence is loader/schema/direct default-definition execution only:
`modelAgentSession:false`, `privateHostIntegration:false`, `realERP:false`,
`paidCalls:0`, `externalBusinessWrites:0`.

The adapter reuses the existing exact free-trade client peer and original control
for a host-frozen document/field projection. Projection hashes are not Library
Artifact/document-version hashes. Library remains the enterprise fact authority;
no mapped fact has been persisted or migrated by this intake. Private business
use still requires reviewed original Host journal/RPC/receiver/current/final
wire integration and separate actual AgentSession verification. Merely enabling
the plugin or adding receipt names to an allowlist is insufficient. Old private
receipt restoration is outside this work and is not retried or loosened.
