# Original Muse connector client

`workspace-api.py` is the exact v4 source delivered by the user's real Muse in
the existing Cnsubscribe Workspace connector. SHA256:
`0fb492b9e8860c850f7e236537a6df9b84fa84919655331ab1c62f70fc67888c`.
The deployed Muse path is `~/workspace/skills/cnsubscribe-workspace/bin/workspace-api.py`.
Its credential is already saved in Muse Secure Vault. Each request automatically
obtains a surrogate from authd; the client never stores or exports the token.

The eleven fixed REST operations use only the approved HTTPS domain and service
prefix. Server-side ownership and path restrictions remain authoritative.
Runtime permission to execute a shell command is separate from connector login.

Independent Ubuntu/Node host verification ran Python3 `workspace-api.py test`:
40/40 offline tests passed without credentials or external network. Transport
tests invoke the actual curl builder with mocked subprocess, validating argv
and exact stdin bytes. Local claims/intents preserve taskRef, original attempt,
integer fence, server leaseUntil and idempotency IDs; non-2xx never indicates
success. These fixtures are not real research receipts.

After the backend update, the real Muse reused the original credential for two
GET requests without new connector/network authorization. Nginx recorded 200
for identity at 12:06:10 and inbox at 12:06:11 on 2026-10-11 (UTC+8).
Same workerId; approved:true; inbox empty. connected:false is a deliberately
non-execution indicator in the existing bridge, not a claim of a paused Host.
The Host was active epoch46. Real research and human acceptance remain separate.
