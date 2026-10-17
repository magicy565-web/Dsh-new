# Additional live entry checks

Uses the existing Compose/nginx implementation in commit 6789079fe8578b205f2cbad10d21cf0f1d18d33b; no second proxy implementation or overlay is needed.

This follow-up separates Medusa UI from the DB/Redis network: UI joins internal frontend plus ingress; API joins private plus frontend; databases remain private only. Backend authentication, original Host source proof and per-file authorizeParserTransfer are unchanged. The existing pinned nginx image and packing/migration fixes are reused.

Official comparison: nginx supports service-name re-resolution through resolve since OSS 1.27.3 (https://nginx.org/en/docs/http/ngx_http_upstream_module.html#resolve). systemd-socket-proxyd (https://github.com/systemd/systemd/blob/main/man/systemd-socket-proxyd.xml) avoids a new container external bridge, but requires host units and container identity/recreation coordination. Reuse nginx here to avoid those host lifecycle privileges. Only proxy containers join the external-capable bridge. A fixed HTTP upstream is not an outbound packet ACL: that network still gives the proxy outbound capability. No firewall changes or egress restriction are claimed.

Run from repository root on the already authorized server AFTER applying the existing deployment instructions and obtaining corresponding network permission:

```sh
python3 acceptance/ingress/check.py docling
python3 acceptance/ingress/check.py medusa
# Explicit process restarts only; no DB/Redis restart, recreation or volume deletion:
python3 acceptance/ingress/restart-check.py docling --confirm-restart
python3 acceptance/ingress/restart-check.py medusa --confirm-restart
```

check.py inspects actual published bindings and service network privacy before HTTP checks. No credentials/body is logged; redirects and environment proxies are disabled. Missing Docker, services, ports, incorrect binding/privacy or unexpected HTTP/auth status fails. These read-only checks do not start or stop services. Use an existing authorized Docker operator; do not grant new Docker-group rights.

restart-check.py restarts application then proxy processes and retries health/auth only for at most 120 seconds. File transfers are never retried. It explicitly distinguishes process restart from container recreation. For recreation acceptance, record IDs, force-recreate only the selected application with the same reviewed image/config, verify IDs changed, then rerun check.py without restarting proxy. That mutating procedure requires the existing server operator and is still pending.

Final business acceptance must use the original Host connection at http://127.0.0.1:5001 and explicitly approved synthetic document with exact authorizeParserTransfer. Record Host run/artifact proof and parsed text; verify absent/revoked/source-changed consent prevents transfer. Health/direct curl conversion does not satisfy this requirement. No real Library document or model call is made by these scripts.

Rollback network separation by restoring only the previous network memberships if necessary; stop proxies to fail closed. Preserve volumes and state. Never use down -v, global cleanup, public ports, host networking or authentication injection.
