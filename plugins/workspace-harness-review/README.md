# workspace-harness-review

Read-only HTTP surface for the deployment-review snapshot produced by
`wh review --out <file>`.

```yaml
plugins:
  - id: review
    name: workspace-harness-review
    config: { reviewFile: .harness-review.json, maxAgeHours: 24 }
```

- `GET /api/harness/review` (admin only): returns
  `{ review, file, generatedAt, state: 'ok' }` with the archived document.
- Missing file → **503** `HARNESS_REVIEW_UNAVAILABLE`, health check `degraded` with
  the concrete state (`missing` / `invalid` / `stale`) — never an invented verdict.
- A document older than `maxAgeHours` (default 24) is reported as `stale`.
- The file is read once at mount for the health check (which the kernel requires to
  be synchronous) and re-read on every request, so a fresh report is served without
  restarting.
- Only `wh review --out` output (with `verdict` and `composition.digest`) is
  accepted; arbitrary JSON is refused. Files are bounded to 1 MiB.

Generate and serve:

```sh
wh review --composition harness.dev.yml --out .harness-review.json
node harness.mjs --composition harness.review.yml
curl -H 'x-harness-actor: local-operator' -H 'x-harness-role: admin' \
  http://127.0.0.1:8792/api/harness/review
```
