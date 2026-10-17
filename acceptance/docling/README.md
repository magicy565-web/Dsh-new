# Private CPU Docling source

This Compose project contains only the official CPU Docling Serve v1.37.0 image, pinned by digest for the amd64 server. It adds no SQL, Redis, vector database or remote model service. One local worker, two CPU threads and a 3 GiB memory cap are configured; remote services, external plugins, UI and API documentation are disabled. Bundled image models remain visible; do not mount an empty cache over them. Offline model flags prevent runtime model downloads.

Follow the explicit persistent-state preparation in [Medusa preparation](../medusa/README.md). The API key and reviewed limits live in its read-only `secrets/docling.json`, mounted only into this service through `DOCLING_SERVE_CONFIG_FILE`. The key is absent from Compose environment, process arguments and Docker inspect environment. Startup does not create or rotate it.

```sh
node acceptance/medusa/write-env.mjs --state-dir "$WORKSPACE_SERVICES_STATE_DIR" --check
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml config --quiet
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml pull
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml up -d
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml ps
curl --fail http://127.0.0.1:5001/health
```

Loopback 5001 is the existing Host's permitted HTTP origin. The Host runs on the host machine and uses `http://127.0.0.1:5001`; do not replace it with `http://docling:5001` or relax its HTTPS/loopback URL checks. Host configuration and exact per-document `authorizeParserTransfer` consent are still required through the original reviewed connection. Health does not establish that connection or grant original-file transfer rights. No real Library file is sent by these preparation checks.

The private configuration limits a request to one source, 5 MiB and ten pages, with 30 seconds document/synchronous wait and a queue of one. The existing Host also caps its timeout at 30 seconds. Cold CPU parsing within that limit is unverified; a timeout remains a failure and must not cause hidden retries or longer transfer authorization. Combined configured service memory caps are approximately 5.7 GiB. The image is roughly 4.4 GB compressed/distributed and requires substantial additional extraction/storage; the local pull failed for insufficient Docker storage, so no service health, restart or real parse is claimed.

Use this project's `restart` or `stop` to preserve state. Do not delete unrelated Docker images, volumes or services to make space automatically. Current evidence is in [the deployment handoff](../../docs/OMP-DEPLOYMENT-PREPARATION-20261017.md). Fixed upstream sources: [README](https://github.com/docling-project/docling-serve/blob/v1.37.0/README.md), [settings](https://github.com/docling-project/docling-serve/blob/v1.37.0/docling_serve/settings.py), [Containerfile](https://github.com/docling-project/docling-serve/blob/v1.37.0/Containerfile).
