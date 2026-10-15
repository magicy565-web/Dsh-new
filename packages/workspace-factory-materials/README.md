# Workspace factory materials

Private local package `@workspace-agent/pi-factory-materials` for official Pi 1.1.0 and OMP 18.10.4. Its `pi.extensions` and `pi.skills` entries load the standard extension and the selected factory-materials Skill. No lifecycle hooks or runtime dependencies are installed by this package.

An ordinary installation registers three tools and returns `unconfigured`. It does not discover environment variables, files, accounts or credentials and does not convert Agent Bearer credentials into a Library Session. Loading this package does not authorize private Library disclosure or install a cached-context guard.

The reviewed controlled Host may import `factoryMaterialsExtension({client, authorize})`. The injected read-only client implements `status(signal, model)`, `materials({productId?, limit?}, signal, model)` and `document({documentId, documentVersion}, signal, model)`. `authorize(signal, model)` must reject on revoked or changed authority; each tool awaits it before and after the read. The client supplies validated `workspace-factory-materials` receipts with the original exact sources, revisions, versions and hashes. Blocked/unavailable results remain errors; partial results retain their original notices. The plugin neither projects private fields nor extracts or infers facts.

The original Workspace Library remains the only store and permission authority. Access requires the existing enterprise Session, reviewed member/workspace, exact model recipient, bounded expiry and explicit fields/record revisions/document versions. Before every provider call, the controlled Host must also reauthorize all cached Library receipts from the original journal, including compacted or forked history. Never enable these private reads in the public-only profile without that guard, or migrate an old private transcript just because its provider/model tuple matches.

Tools:

- `workspace_factory_materials_status({})`: report reviewed access state.
- `workspace_factory_materials({productId?, limit?})`: read approved products; limit 1–20.
- `workspace_factory_document({documentId, documentVersion})`: read one approved original document version, 1–100.

Tool arguments cannot select fields, recipient, workspace/member, arbitrary URLs or local paths. Missing capacity/MOQ/lead time/certification remains pending. Public references are not this factory's supply or qualification proof. Text extraction and administrator review are not independent certification verification.

For Pi, use `pi install /absolute/path/to/package`. Its package resource settings can disable both `extensions` and `skills` with empty arrays; `pi remove /absolute/path/to/package` removes the registration. For OMP, use `omp plugin link /absolute/path/to/package`, `omp plugin disable @workspace-agent/pi-factory-materials`, `omp plugin enable @workspace-agent/pi-factory-materials` and `omp plugin uninstall @workspace-agent/pi-factory-materials`. These are local package operations, not npm publication. Package removal does not delete enterprise records or files. The SDK acceptance tests exercise both official hosts using copied package directories and finite explicit keyless providers; their synthetic client receipts are not real Library authorization tests.

## Interface version 0.2.0

See [the interface and migration contract](https://github.com/magicy565-web/workspace-agent/blob/codex/standardize-factory-plugin-interfaces-20261015/docs/FACTORY-PLUGIN-INTERFACES.md) for supported fixed upstreams, errors/cancellation, original source and artifact checks, and integration boundaries. The local `./contracts` export supplies the published JSON Schema, pure input validator and TypeScript DTO declarations. The default and named extension entrypoints remain compatible; incomplete inquiry source references and callback approval/sent claims fail closed. Ordinary installation remains unconfigured. Private adapter code is `UNLICENSED`; retained upstream/reference notices keep their own licenses.
