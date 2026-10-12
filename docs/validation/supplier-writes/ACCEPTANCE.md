# PR48 publication-chain checkpoint

Validated source: `c2ba9eafad5cb36e11f231012dcd0fdf6f28b268`, tree `1881c0f020a05e5c40b3a669154b2d247d5a1ea1`. Base: `08a760c045474ed92244bf2ac01e883d91a0a17d`. Remote branch is `codex/cloud-supplier-shopify-writes-20261012`; Draft PR48 targets the existing supplier development branch, never main. This is a later development round, not a relabelled20:30 delivery.

## Frontend handoff

Stable minimal contract: `docs/SUPPLIER-PUBLICATION-CLIENT-CONTRACT.json` at fixed commit `40b9601c08c82a604e67013e2e75bc415c76a017` (unchanged in this source). The shared authenticated base path is `/api/conversations/:cid/supplier-services/:sid`. GET `/publication` returns current readiness, original operation history and latest receipt. POST `/shopify-review` freezes current revision/preview and action `draft` or `publish`; publish requires the exact existing Publication GID. POST `/shopify-decision` explicitly approves/denies that exact operationId/scopeHash. POST `/shopify-execute` uses the original operation, approval and Connector run. POST `/shopify-reconcile` performs reads only and cannot upload/create/price/activate/publish. Exact requestId/body is retained across local response loss. Old `/shopify-draft` remains non-writing.

Implemented chain: original reviewed preview → original domain-bound approval → owned image version/SHA read → staged image transfer → Shopify DRAFT → retail variant → exact media-ID/READY read-back → separately approved channel activation/publication → original-operation status/reconciliation. Credentials are delivered by the original broker; each write checks original Connector revision/enabled state and supplier cancellation. Muse file reads retain the approved administrator role and original owner/Session path. The existing enterprise session watcher stops subsequent steps on actual session revocation, and an already expired session leaves approval unused. No client disconnect is treated as proof of abort or remote non-execution.

## Actually run

- Fresh focused source tests:24pass,0fail,0skip. Raw `targeted-final.txt`.
- Fresh full backend source tests:594total,587pass,0fail,7skip. Raw `backend-final.txt`. Skips are pre-existing conditional native-source/Windows cases, not newly disabled publication tests.
- TypeScript/Vite build passed (`build.txt`); existing bundle-size warning remains.
- Existing UI19/19, conversation UI14/14, official-types mini build, mini client29/29 passed. These were run during this round before the final assertion-only test repair; frontend code is unchanged. Raw separate logs retain each scope.
- Actual local Chromium151 browser checked320/390px backend SSR preview and original central-spirit conversation, with screenshots in `browser/`. Browser source checkpoint was`cf9d10c6`; it uses the real Pi SDK with a synthetic faux response and synthetic image. It does not exercise the new client publication controls or prove a real model/store/Muse/device execution.
- An initial imported HTTP binding test failed until the original generic approval route recognized this domain binding; retained `initial-integration-failure.txt`. A later isolated WIP run exposed a pre-existing assertion searching all preview JSON for500, which could match random hashes. The repaired test checks the actual public consumer content; raw earlier output retained and latest full run is green.
- `SOURCE-BYTES.json`/`SOURCE-SHA256SUMS.txt` describe479 original Git source blobs. No CRLF or text re-encoding is used. No archive is regenerated in this accelerated checkpoint. PR45's existing source08 archive remains unchanged and does not include PR48.

## Remaining code versus configuration versus real acceptance

Code remaining: frontend new publication controls are assigned to the original frontend task; separately reviewed partial-draft repair is absent; traffic and selected-channel notifications are assigned to separate parallel tasks, then require service integration. The earlier unfinished traffic/Slack candidates are preserved only on WIP branch `codex/cloud-supplier-monitor-adapters-wip-20261012` at`96fb4914a4be95ff8f36d58c72ec4eeb1b3bce8a`, outside PR48 and outside this full-run claim. Its notification code has not been tested; no completion claim is made. This publication adapter currently supports the bounded Google staging hosts and requires ready single-variant media; unsupported staging hosts remain blocked.

Configuration/authorization missing: actual product/shop/model/channel choice, existing host credentials and scope grants, host write enablement, original Connector enablement and explicit per-operation approval. No new credential/permission is created and no secret is requested in chat.

Real acceptance unrun: actual model product conversation/preview; actual store draft/media; separate real publication; first live order/refund/attributed traffic sample; first external notification; a full real seven-day continuous period; real Muse online protocol verification; WeChat device acceptance. Production is deliberately off and was not probed/woken/deployed. Local fixture tests cannot replace these stages. No paid/external live action was executed. The previously blocked independent audit is neither retried nor relabelled as these ordinary implementation tests.
