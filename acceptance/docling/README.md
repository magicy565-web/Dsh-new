# Private CPU Docling source

This Compose project runs the official CPU Docling Serve v1.37.0 image, pinned by digest for the amd64 server, plus the restricted nginx entry described below. It adds no SQL, Redis, vector database or remote model service. One local worker, two CPU threads and a 3 GiB memory cap are configured; remote services, external plugins, UI and API documentation are disabled. Bundled image models remain visible; do not mount an empty cache over them. Offline model flags prevent runtime model downloads.

The approved entry correction adds a separate pinned unprivileged nginx (64 MiB). Only nginx joins the new ingress bridge and publishes 127.0.0.1:5001; Docling remains exclusively on the internal parser network. nginx forwards only GET/HEAD health/ready and POST `/v1/convert/file` to the fixed Docling service, retains upstream API-key enforcement, disables request/response disk buffering and access logs, and does not retry requests. This avoids Docker29's internal-only publishing limitation without giving Docling an external route.

Follow the explicit persistent-state preparation in [Medusa preparation](../medusa/README.md). The API key and reviewed limits live in its read-only `secrets/docling.json`, mounted only into this service through `DOCLING_SERVE_CONFIG_FILE`. The key is absent from Compose environment, process arguments and Docker inspect environment. Startup does not create or rotate it.

```sh
node acceptance/medusa/write-env.mjs --state-dir "$WORKSPACE_SERVICES_STATE_DIR" --check
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml config --quiet
chmod 0644 acceptance/docling/nginx.conf
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml pull
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml up -d
docker compose -p workspace-pr99-library -f acceptance/docling/compose.yaml ps
curl --fail http://127.0.0.1:5001/health
```

Loopback 5001 is the existing Host's permitted HTTP origin. The Host runs on the host machine and uses `http://127.0.0.1:5001`; do not replace it with `http://docling:5001` or relax its HTTPS/loopback URL checks. Host configuration and exact per-document `authorizeParserTransfer` consent are still required through the original reviewed connection. Health does not establish that connection or grant original-file transfer rights. No real Library file is sent by these preparation checks.

The private configuration limits a request to one source, 5 MiB and ten pages, with 30 seconds document/synchronous wait and a queue of one. The existing Host also caps its timeout at 30 seconds. A timeout remains a failure and must not cause hidden retries or longer transfer authorization. Combined configured service memory caps including the new ingress are 5.75 GiB. The image is roughly 4.4 GB compressed/distributed and needs additional extraction/storage. Parent reports direct-internal-IP synthetic PDF conversion passed on the server; this author did not perform it. Local ingress tests use synthetic HTTP backends, so real Host parsing and server loopback still require field validation.

For the existing healthy server container, do not rerun the initial full-project pull/up above. Apply only the [entry update procedure](../../docs/OMP-LOOPBACK-INGRESS-20261017.md): pull nginx alone, start only `ingress` with `--no-deps --no-build --pull never`. This leaves the healthy Docling engine untouched.

Use this project's `restart` or `stop` to preserve state. Do not delete unrelated Docker images, volumes or services to make space automatically. Current evidence is in [the deployment handoff](../../docs/OMP-DEPLOYMENT-PREPARATION-20261017.md). Fixed upstream sources: [README](https://github.com/docling-project/docling-serve/blob/v1.37.0/README.md), [settings](https://github.com/docling-project/docling-serve/blob/v1.37.0/docling_serve/settings.py), [Containerfile](https://github.com/docling-project/docling-serve/blob/v1.37.0/Containerfile).
