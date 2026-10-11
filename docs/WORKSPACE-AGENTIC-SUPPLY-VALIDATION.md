# Validation report — Agentic Supply V1 local development source

**Date**: 2026-10-12. **Source baseline**: V22 Muse receipts archive at commit `78f155367524b48381d79b2edebe0e5e2925e85d`. Local worktree only; no GitHub PR, merge, production deployment or external charges performed.

## Checked in this session

| Test | Result | Limit |
| --- | --- | --- |
| Supply Network real local HTTP, persistence, MCP privacy, publication/unpublication, Shopify synthetic read | **7 / 7 passed** | Upstream Shopify fixtures; no actual merchant credentials |
| Existing commerce and Muse hosting product tests | **12 / 12 passed** | Scripted upstream fixtures only |
| Dot/Muse bridge, API, MCP and recovery isolated regression tests | **31 / 31 passed** | Local fixtures, not hosted Dot/Muse execution |
| Entire original backend script with `NODE_OPTIONS=--experimental-strip-types` and temporary **older historical static assets** used solely for backend fixture availability | **384 passed, 6 skipped, 0 failed, 390 total** | Node 22.16 not required Node 24; static assets came from an earlier archived bundle, **not newly built V22/Supply UI** |
| Updated backend source files | `node --check` passed | Syntax only |
| Updated `.tsx` UI files | TypeScript transpilation parse passed | **Not a semantic typecheck or functional browser preview** |
| `npm ci` + current UI `npm run build` | **Blocked** | Registry DNS unavailable in container, project needs Node 24 and missing React/Vite dependencies |
| Dot live identity request from installed Workspace — xy connector | **Failed internally** | No valid returned identity, current OAuth/MCP connectivity not accepted |
| Muse live claim/submit | **Not run** | No authorized original live lease/task/credentials in session; must not invent one |
| Shopify live read | **Not run** | No approved live shop token in this session |
| Grokbot connection | **Not run** | No independently verified adapter/budget controls |

No claim is made that the personal Agent team is connected or that marketplace/billing/write operations are production ready. The pilot's MCP bearer mechanism is suitable only for a private test ingress; **public ChatGPT/Muse installation requires reviewed OAuth and principal isolation**.

## Validation prerequisites on a suitable development machine

- Node 24+, `npm ci`, `npm run typecheck`, `npm run build` and browser suite.
- Host configuration must be supplied through secure server settings and never committed, including Shopify token and independent sourcing MCP credentials.
- Frontend responsive visual regression at 320, 390, 430 and desktop widths; verify keyboard and touch controls and disabled-viewer state.
- Native Muse/Dot tests on the original authorized host require current OAuth, connection epochs, leases, task IDs, artifact provenance, verified budget limits and human acceptance. Reuse original state; do not clone or reset it.
- Migrating beyond one enterprise requires a separate PostgreSQL tenancy/row-level security project; the current state storage **must not** be shared across independent enterprise accounts.
