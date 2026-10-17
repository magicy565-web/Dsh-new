# Medusa HTTPS proxy header verification

Source baseline: `ab3302ed25c2363418aad0a808b6dd6b5140ff42`.
Date: 2026-10-17. This records offline and isolated nginx verification only.
Live Caddy TLS, certificate, browser and authenticated login acceptance are separate and were pending when this note was written.

## Scope and trust boundary

Only the existing UI nginx proxy header configuration changes. On its 8080 entry,
TLS identity is accepted only for the literal tuple:

- observed source peer `172.21.0.1`;
- Host `medusa.cnsubscribe.xyz`;
- one `X-Forwarded-Proto: https` value.

nginx literal `map` strings are case-insensitive. Missing values, another peer/Host,
an unselected port, or a protocol list fall back to the original local HTTP identity.
The private 9000 entry retains that original local identity. Both entries overwrite
forwarded host/port/client-IP fields and remove `Forwarded` rather than trusting
caller-supplied identity. Existing route allowlists, ports, Origin, Cookie and
Authorization behavior are unchanged. No API configuration, CORS, secure-cookie,
trust-proxy, account, database or dependency change is included.

The peer was observed, not inferred: a held host TCP connection to
`127.0.0.1:4173` appeared in the UI container's `/proc/net/tcp` as remote
`172.21.0.1`, with the container at `172.21.0.2:8080`. This is a host-loopback
trust boundary, **not a Caddy-process identity**. Other host processes can use
the same tuple. Verify the actual Caddy connection peer after enabling it, and
revalidate after Docker network recreation. No broad private-network trust is added.

## Source hashes

- Original `acceptance/medusa/nginx.conf`: 1966 bytes,
  SHA256 `25f5a1e1a860ea3e7bb8484a983159820243264c3470ec94416634a2be088cab`.
- Updated file: 2959 bytes,
  SHA256 `be398434a0d2d289a46eba711144ab8050747401f34d34f641ad15a1bf2f7eac`.
- `test/medusa-https-forwarded-headers.test.mjs`: 4516 bytes,
  SHA256 `073177364bb6289330e4fd9f07fdbe5ae56c3b7340252309451160e4b65a5554`.
- Reviewed two-path source patch:
  SHA256 `4bfd036cd6aa1dd75fbfd99b104ec32ef41f4a284dfc40c2f553c08b756e4405`.

## Local configuration contract

Node 24.19.0 ran:

```sh
node --test test/medusa-https-forwarded-headers.test.mjs
```

11/11 passed, failures/cancelled/skipped/todo all 0; 102.710831 ms.
These tests parse the configuration contract and do not execute nginx.

## Actual isolated nginx

The existing pinned image was used, without installation or version changes:

`nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8`

The synthetic fixture retained the updated production configuration, changing only
the trusted peer to fixture loopback `127.0.0.1` and the upstream to loopback
`127.0.0.1:19001`. It added an echo upstream and a `127.0.0.2` source proxy.
No running API, account request, real business data or external network was used.

```sh
sudo -n docker run --rm --pull never --network none --read-only \
  --user 101:101 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m,mode=1777 \
  --mount "type=bind,src=$PWD,dst=/work,readonly" \
  --entrypoint /bin/sh \
  nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8 \
  /work/run-nginx-echo-isolated.sh
```

First attempt: nginx syntax was valid, but startup failed creating the default
`/var/cache/nginx/fastcgi_temp` on the read-only filesystem. Exit 1; none of the six
probes ran. Its 341-byte log SHA256 is
`674e051543303d0154856ac02a26905f816830387505133167bdecf25f7e67e8`.

Only the fixture was then corrected by adding `fastcgi_temp_path`,
`uwsgi_temp_path` and `scgi_temp_path` under its existing writable `/tmp`.
The production patch, read-only filesystem, dropped capabilities and network
isolation were unchanged. Fixture before SHA256:
`da96b85a98098dfb59945674a4c83c687075ceac98ed394173d6f31dfb400074`;
after SHA256:
`a7a2ceadb4c94a01285b05487b35644d36ccfca947342c5b8c00718a832ce7be`.
The 495-byte fixture-only correction patch SHA256 is
`3bffb7d149f8fdfb2f821db61fce3ec1018b7dc5349c7d305672d7d64d3aee0f`.

The second attempt passed `nginx -t` and **6/6 actual echo probes**, exit 0:
exact trusted tuple plus sanitized spoofed headers; wrong Host; missing protocol;
protocol list; different source peer; and private 9000 local HTTP identity.
One initial readiness-poll connection refusal preceded readiness; all six formal
assertions passed. The 521-byte log SHA256 is
`dd47242be2446beb1da3754e9d3a15137cda0429af5ad10e0b0735308f751a03`.
Raw logs and runtime files are retained outside this source repository.

## References and remaining checks

- [nginx map semantics](https://nginx.org/en/docs/http/ngx_http_map_module.html)
- [Caddy reverse proxy header behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Medusa v2.21.2 original Express/session settings](https://github.com/medusajs/medusa/blob/v2.21.2/packages/core/framework/src/http/express-loader.ts)
- [Express CORS behavior](https://expressjs.com/en/resources/middleware/cors/)

Live deployment requires the separately approved UI-only operation. The running API
must not be rebuilt or restarted by this patch. Actual Caddy peer, certificate and
HTTPS rendering remain live acceptance work; this note does not claim login passed.
