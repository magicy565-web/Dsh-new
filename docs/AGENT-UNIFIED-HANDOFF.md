# PR59 → PR47 Pi Agent API selected integration (2026-10-13)

## Fixed inputs and branch ownership

- Single Workspace business/client baseline: [PR59](https://github.com/magicy565-web/workspace-agent/pull/59), tested application source `24c37b06284720b4b9d8d7b79dc19d56ef5d51b1` and evidence checkpoint `18cc80aca0f88a68fb96d2f1d960897f8a48dac2`. Subsequently integrated its new Native Host/Muse commits through `32c8ce98fe28cda1e22a16bf0d1088c768e081c8` in conflict-free two-parent merge `9f808f202ce825a2ab647f11456eb5dbcf8fe76e` (separate from Agent code).
- Imported interface source: [PR47](https://github.com/magicy565-web/workspace-agent/pull/47), commit `1e0cc43d973b5d10861561f2cd4979065d5f33f6`.
- Work lives only on `codex/unified-pi-agent-api-20261013`. PR59, PR47, PR52, other workers and `main` are unmodified. **Draft; release blocked.**

## No duplicate business implementation

The PR59 versions of the single `server/index.mjs` 8787 host, existing enterprise access, original Workspace Store, Pi Runtime/Durable, original supplier product facts, Shopify publication/repair, GA4 views, notification outbox, Muse/Dot bridges, original Pi TUI and WeChat conversation remain authoritative.

PR47's `/api/agent/v1` is a **thin transport and document-preset adapter**: accepts existing-member scoped credentials, submits the original Runtime runs, uses Workspace Store for business tasks and original Pi checkpoints for execution, and uses SQLite/files only as a reconstructible SSE/artifact view. The three preset types and Python client are copied from PR47, not recreated.

The original Dot, Muse and procurement Worker token SHA-256 values are reserved. New Agent member Bearer bindings using any of those existing digests are rejected at startup. This uses the original host's scope configuration and does not create another login or grant system.

Shared files are integrated selectively:
- `server/runtime.mjs`: PR47's Agent preset context/proposal and resume checks, already including the original supplier context.
- `server/pi-provider.mjs`: PR47's source-checked preset/research Pi tools **plus the newer PR59 supplier revision/cancellation check**. Normal supplier, Muse and ordinary Pi tools are retained.
- `server/access.mjs`: PR47's bearer/member/scope/audit functions over the PR59 native Host Session/login/CSRF code. PR59's `nativeSessionById` and original optional session ID reading are preserved.
- `server/index.mjs`: optional Agent adapter in the existing createApp/init/shutdown, original Host response privacy filtering, original ordinary business routes unchanged. Disabled unless explicitly configured. Agent health is `/api/agent/v1/health`; root `/health` remains owned by the existing host.
- `package.json`: only historical Agent test/client/launcher commands added, original dependencies unchanged.

Legacy PR47 tests, client, deployment examples and documentation are retained as **source and regression starting points, not evidence that this new combined commit passed**.

## No release acceptance claimed

This integration has been authored through the connected GitHub source interface. Exact-target insertions and source checks were performed; several changed JavaScript modules passed a direct V8 syntax parse. **No checkout-wide Node 24 / Python / browser or true HTTP integration test was executed here**, because the active container cannot reach this private GitHub repository and the repository's hosted Actions environment is returning `startup_failure` with zero jobs. This must not be counted as a passing test or deployment.

Required next gate on this exact new commit:

```bash
npm ci --ignore-scripts
npm run build
npm run build:mini
npm run test:agent
npm run test:agent:client
npm run test:all
npm run test:agent:acceptance
```

The final acceptance runner intentionally remains release-blocked pending independent Shopify/commerce source review. Do not update historical source pins or remove failing evidence merely to pass a command. The additional Pi policy/endpoint fingerprint impacts recovery of preexisting runs; an independent reviewer must assess that change before making this branch the deployment source.

Further required real gates: actual authenticated Host terminal, Muse/Dot execution receipt, production model/read-only research, approved Shopify draft/channel, exact product GA4 data, WeChat native subscription and real seven elapsed days. None is inferred from local fixtures. No credentials, live external writes, payment, production deployment or main merge were performed.
