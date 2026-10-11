# TT041 Supply Commerce UI continuation

The existing Supply V1 panel was present in PR28 but was not mounted in the V22 Commerce entry. Mounting it directly would lose unsaved-input protection, silently advance an edit's revision after reload, and generate a new request after an unknown commit. This change connects the existing panel to the original persistent HTTP service and repairs those three behaviors.

## Source and ownership

- Fixed base: PR28 `b4e59a99d3ea68e5e62e14d0b38384bab2fe4e7b`; base tree `75558fe990027809bc81cf9d7ec3007cb5b1d212`.
- Independent checkout: `C:\Users\Administrator\Documents\Codex\2026-10-12\task\workspace-commerce-pr28`, branch `codex/v22-supply-commerce-ui-20261012`.
- The original checkout's three uncommitted Commerce files are preserved. The task-2 checkout and its in-progress server work are not edited or imported.
- Existing modules, API client, session identity, V22 dirty-navigation guard, style tokens and original Store are reused. No new runtime, dependencies, account, credentials or connector are created.

The ordinary Commerce entry is a product/supply resource surface. Worker connection/status and internal inquiry tabs are removed from this panel. Legacy Commerce detail URLs still render their existing detail views. This patch does not change the application navigation or claim to complete the conversation-centered product redesign.

## Behavior

- Capture a listing's complete revision snapshot when editing starts. Reading updated data cannot silently rebase the edit. A real HTTP revision conflict preserves typed input; using the latest revision requires an explicit new edit.
- Supplier, listing and publication writes disable during unavailable reads, ongoing writes and unknown commits. Published listing edits retain the existing direct-public-update policy and state it in the editor.
- Confirm publication of the actual supplier fields or listing revision, SKU, price, MOQ, terms, lead time and specifications. Canceling confirmation sends no mutation.
- Save an unknown command before sending, scoped to workspace, subject and role in sessionStorage. No bearer or CSRF credentials are stored. Refresh cannot replay automatically; explicit reconciliation reuses the original path, body and UUID request ID. Known conflicts/failures keep form input.
- Feed dirty edits and uncertain writes into the original V22 navigation/beforeunload protection. Show actual read errors and reload actual HTTP data.
- Reuse the existing resource styles with small responsive adjustments and keyboard focus indicators.

## Verified locally

TT041, Windows NTFS, existing Node `24.19.0`, React `18.3.1`, TypeScript `6.0.3`, Vite `8.0.16`, jsdom `29.1.1`. No installation was performed.

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node --test --test-isolation=none --test-reporter=tap test/supply-commerce-ui.dom.test.mjs test/supply-network.http.test.mjs
```

TypeScript and production build pass. Vite reports an existing-size bundle warning: the final JavaScript is about 508.49 kB minified (144.10 kB gzip). This change does not alter the application's bundling configuration.

The final combined run passes **14/14, zero skips**: seven new production-built UI tests and seven existing Supply persistent HTTP tests. The UI tests use the actual original HTTP server and temporary NTFS Store, including closing/reopening the Store. No memory durability preload is used. Deliberate client-side faults simulate one failed read or a lost response after a real commit. The viewer-scope case substitutes test session metadata to verify UI isolation; it is not an enterprise-authentication acceptance test. Exact output is saved in `validation/supply-commerce-ui/persistent-http-and-ui.tap.txt`.

An existing V22 navigation/interrupted-send regression also passed **1/1, zero skips** before the resource-only cleanup; `App.tsx` and the shared navigation implementation are unchanged. This does not assert that all V22 UI tests were run.

## Remaining acceptance boundaries

1. This is local persistent HTTP plus DOM fixture validation. It is not original native Host wake/model execution, genuine PersonalAgent procurement or commercial acceptance. Original one-Muse/Worker and mounting protections, identity epoch and old task bindings are unchanged. No external messages, task claims, authorization updates, payments or production operations are performed.
2. PR28's pinned baseline does not expose the new buyer-share / exact merchant reply / conversation procurement endpoints. Task 2 is implementing those separately. Its uncommitted contract was read for coordination, but its mutable server files are not copied and no mock endpoint is presented as a working product. A fixed server commit and corresponding original Host verification are required before joining that loop.
3. No pixel comparison or real mobile screenshot is claimed. The browser tool currently returns `Transport closed`. The five requested reference images have not been materialized locally: the official Library transfer fails at Windows metadata application (`os.setxattr` unavailable). Library identity was not stripped and signed download URLs were not guessed or reused outside the supported transfer. The [Library skill](skill://plugin_connector_1p_1b8ff8edfc1481918b252c8277e23125/library/SKILL.md) requires “preserve Library identity through every local edit and writeback,” and its transfer reference requires metadata application and verification before atomically installing the destination. The current static resource CSS is not reference-image visual acceptance.
4. This remains a private development Draft, based on the fixed PR28 candidate. No merge to main, production deployment, service restart or new Muse connection is requested by this patch.
