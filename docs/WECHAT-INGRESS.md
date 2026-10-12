# Native WeChat ingress adapter

The optional adapter is mounted by the existing `npm start` path only when
`WORKSPACE_WECHAT_INGRESS_FILE` names a reviewed private configuration. Default
startup reads no native account key and opens no extra listener. DSH source/Host
is never needed. No configuration, credential, certificate or live account was
created for this change.

The configuration uses existing deployment material, via absolute private regular
file paths (bounded, not symlinks). The TLS listener binds loopback only and needs
the already reviewed HTTPS proxy/domain to forward the exact public Host:

```json
{
  "version": 1, "host": "127.0.0.1", "port": 8788,
  "tlsCertFile": "<existing absolute certificate path>",
  "tlsKeyFile": "<existing absolute TLS key path>",
  "ingressKeyFile": "<existing absolute Ed25519 ingress key path>",
  "appId": "<existing reviewed AppID>",
  "appSecretFile": "<existing absolute AppSecret file path>",
  "bindingProfileFile": "<existing reviewed member binding profile path>"
}
```

This is a shape example, not usable credential material. The ingress key must
match the original configured public key/issuer/keyId/workspace. The mapping
profile described in `server/wechat-code-exchange.mjs` contains only keyed OpenID
digests and existing subjects, plus a current administrator review. It cannot add
members or roles, use UnionID as an implicit account match, or select another Muse
owner. Actual AppSecret, OpenID, session_key, code and bearer never enter the
durable business records or audit; only bounded HMAC code-attempt digests persist.
Those records are validated and hidden from bootstrap. A ten-minute local replay
fence is conservative local bookkeeping, not a claim about WeChat key/code TTL.

`POST /api/session/wechat` at that HTTPS native ingress takes exactly `{code}`.
The fixed official code2Session adapter has bounded timeout/body, no redirect or
retry. A reviewed mapping generates the ORIGINAL signed `/api/session/login`
request. Response is `{token, session}` using its original 43-character bearer and
Session DTO. Subsequent native requests resolve that same ephemeral Session and
sign exact original method/target/body. Untrusted identity/assertion/cookie headers
are discarded. Original membership, CSRF, role gates, signature nonce/expiry,
origin, session expiry/revocation and Muse owner checks still execute in Workspace.
There is no second session issuer/store, model loop or scheduler.

The compiled client has a fixed HTTPS broker adapter and an empty default origin.
Setting a reviewed service origin enables that adapter. It obtains one fresh wx
code per login attempt, then checks actual `/api/session`; subject mismatch fails
and the actual role wins. Code/token/CSRF are memory-only. No stub login succeeds.

Local evidence: original access/code-exchange/native ingress tests 30/30;
unchanged PR37 strict14/14; backend546 total/539 pass/7 historical skips, UI19/19,
conversation14/14, official mini build pass. Network is an explicitly offline
official-shape fixture followed by real loopback signed Workspace HTTP. No real
WeChat code/account/HTTPS listener/device/domain/review, original live Muse or
production was tested. Actual configured TLS startup remains unrun because no
existing host certificates/account material are available in this cloud workspace.
No chat credential request, new credential or production access occurred.
