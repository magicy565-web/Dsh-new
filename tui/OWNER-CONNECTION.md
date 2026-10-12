# Exact owner connection and read-only diagnosis

The built-in bridge is implemented. Actual host integration/enablement is not
performed or authorized by this PR. No production session, key, token, grant,
login, listener, proxy configuration or deployment has been created.

## What already exists, and what is still missing

| Layer | Source state | Live prerequisite |
| --- | --- | --- |
| Original login/session | `server/access.mjs`; original native login in `server/wechat-ingress.mjs` | Existing reviewed owner/admin membership and successful original login |
| Per-request native signing | Existing `createWechatIngress` resolves the opaque original Session then signs exact method/path/body | Original configured HTTPS native ingress, matching existing signing key and public origin |
| Host → TUI bridge | **Implemented** in `owner-host-launch.mjs`, `owner-session-transport.mjs`, `owner-rpc.mjs` | Original trusted login host must attach its already-held Session to its authenticated terminal launch action |
| Browser-only SSO → terminal handoff | **Not present in this repository** | Requires reviewed host integration; setting an environment variable is insufficient |
| Real Muse consumer | Checked-in v4 CLI matches `workspace.muse.pull.v1` | Current remote installation, original Secure Vault/authd/egress and actual Muse execution remain unverified |

The repository's browser `workspace-web` registration does not register a
terminal/device/localhost login flow. Its full production browser gateway is not
in this source tree. Do not invent one, copy browser cookies into Pi, use the Dot
OAuth token as owner authority, or give Pi the ingress private key.

## Built-in secure launch from an existing trusted host

This is a callable implementation for the **existing host**, not a snippet to
paste credentials into. After its original safe login has already returned the
native `{token, session}` in memory, its reviewed terminal action can invoke:

```js
import { launchWithExistingOwnerSession } from '/absolute/source/tui/owner-host-launch.mjs';

const child = launchWithExistingOwnerSession({
  origin: originalConfiguredNativeHttpsOrigin,
  token: originalLogin.token,
  session: originalLogin.session,
  conversationId: originalReviewedMuseConversationId,
  mode: 'diagnose', // GET-only first; 'tui' requires an attached real terminal
});
```

The host retains the token in memory. Pi receives only a private inherited RPC
pipe. It receives no Session token, CSRF value, ingress signature/private key,
provider keys or Worker credentials. The host drops unrelated secret environment
variables before launching Pi. This bridge opens no network listener and saves
no credentials. It only admits the fixed original conversation paths plus the
three owner reads required for connection/diagnosis. Login, grants, arbitrary
HTTP paths, worker claims and different conversation paths are rejected.

On each request the host rechecks the existing native Session through the
configured HTTPS ingress. Before mutations it obtains current CSRF from that
same Session; the ingress independently revalidates membership/session and signs
the exact original request. Redirects and non-JSON login pages fail closed.
The backend's original approval/review hash remains mandatory.

An existing native login host with no attached terminal can run `mode:'diagnose'`.
`mode:'tui'` fails `OWNER_TTY_REQUIRED` there. Attaching a real authorized terminal
to that host is an explicit integration prerequisite, not something the TUI can
infer or provision. **Actual production mounting requires separate approval.**

## One-command read-only check

From the inherited owner Host context:

```sh
npm --prefix tui run diagnose
```

Or use `/workspace-muse diagnose` in the actual TUI. For an already configured
**local fixture/development** backend only:

```sh
WORKSPACE_PI_LOCAL_URL=http://127.0.0.1:8787 npm --prefix tui run diagnose
```

The command performs only GETs. It reports owner admission, exact original
conversation, original Muse binding/approval state, historical `lastSeenAt`,
checked-in consumer SHA/contract/path and separate live-verification flags.
It never approves, dispatches, claims, wakes, sends a notification or renews
authorization. A successful diagnosis remains `realMuseVerified:false`.

| Error | Required operator action |
| --- | --- |
| `EXISTING_OWNER_TRANSPORT_REQUIRED` | Attach the already-authorized Host through the implemented bridge; missing host integration is code/setup work, not missing credentials in chat |
| `OWNER_SESSION_EXPIRED` / `SESSION_REQUIRED` | Return to the original secure login, then reopen from the original Host |
| `AUTH_REQUIRED` | Restore the original signed ingress; cookie or token alone cannot access the enterprise backend |
| `OWNER_ORIGINAL_CONVERSATION_MISMATCH` / `MW_ORIGINAL_BINDING_REQUIRED` | Restore the exact original reviewed owner/conversation binding and data; do not invent a replacement |
| `OWNER_INGRESS_JSON_REQUIRED` / `OWNER_INGRESS_REDIRECT_REJECTED` | Verify the configured endpoint is the existing native HTTPS ingress, not a browser login redirect or backend port |
| `OWNER_SESSION_IDENTITY_MISMATCH` | Use the original authorized workspace/owner/admin session; do not expand roles |

Default sessions expire after 15 idle minutes / 8 absolute hours; deployment
configuration can differ within the existing allowed bounds. Backend restart revokes sessions.
The cold-backend fixture explicitly logs in again. Request/task recovery does
**not** preserve authentication, and this bridge never refreshes or recreates it.

## Real Muse's side: pull commands, not a listener

The checked-in consumer is `deploy/muse-native-overlay/client/workspace-api.py`.
Reviewed SHA256: `0fb492b9e8860c850f7e236537a6df9b84fa84919655331ab1c62f70fc67888c`.
The historical installed path documented in its README is
`~/workspace/skills/cnsubscribe-workspace/bin/workspace-api.py`; current presence
and version must be checked inside the actual Muse environment.

Its `main()` runs **one** of eleven operations and exits. It has no listener,
watch process, polling loop or automatic claim. After the separately authorized
live read-only check is permitted, the existing Muse can run:

```sh
python3 ~/workspace/skills/cnsubscribe-workspace/bin/workspace-api.py identity
python3 ~/workspace/skills/cnsubscribe-workspace/bin/workspace-api.py inbox
```

These use its existing Secure Vault/authd and exact `/api/muse-worker/v1` egress.
Do not export a raw key or add a new credential. GET identity/inbox may update
handshake timestamps, but prove no task execution. Claim/heartbeat/upload/submit
require a specifically approved real task and its original IDs. No new automatic
listener, repeated task authorization or notification consent is implemented.

Linux is verified with synthetic native ingress + real loopback signed backend
and an actual child process over the inherited pipe. Production TLS/account,
remote Muse and Windows remain unverified.
