# Pi TUI → original Workspace Muse task

This optional package adds the actual Pi coding-agent **1.1.0 TUI**, with an
explicit `/workspace-muse` command. It uses the existing Workspace owner routes
and original Muse conversation. The backend Pi SDK is not a TUI, and this client
does not replace it or create a queue, identity, approval model, worker or model
runtime. Root package/lock, server and mini program are unchanged.

## Start

Node 24+, from the repository root:

```sh
npm ci
npm --prefix tui ci
npm --prefix tui start
```

The real Pi terminal opens without a model key. Its generic “No models available”
warning does not prevent these commands; **do not log into a model to use this
flow**. Plain prompts display command help, and this focused launcher disables
model tools, discovered extensions, MCP connections and startup network work.
No model request is needed for drafting or reviewing a task.

With an **already configured local** Workspace and original Muse binding:

```sh
WORKSPACE_PI_LOCAL_URL=http://127.0.0.1:8787 npm --prefix tui start
```

This URL option only accepts literal HTTP loopback origins. It does not start a
server or create the missing original conversation/binding. A bare `npm start`
without the existing Muse binding correctly produces `MW_ORIGINAL_BINDING_REQUIRED`.

For an existing enterprise installation, use a **reviewed host adapter already
connected to the owner's authorized session**:

```sh
WORKSPACE_PI_OWNER_TRANSPORT=/absolute/private/existing-owner-adapter.mjs npm --prefix tui start
```

The module exports `request({method, path, body, signal})` and returns
`{status, body}`. It must preserve the original signed ingress, owner/admin
session, CSRF, exact body and per-request checks. It must honor the signal and
not follow redirects or retry mutations. This repo does not supply or create a
production signer, credentials, login, persistent grant, or permission upgrade.
Never supply a Muse/Dot Worker bearer as owner authority. Missing adapter remains
`EXISTING_OWNER_TRANSPORT_REQUIRED`; there is no anonymous enterprise fallback.

## Use the terminal

1. `/workspace-muse connect` checks the original owner session and conversation.
   `onlineVerified:false` is deliberate: owner access is not proof Muse is online.
2. `/workspace-muse new` collects service ID, public product, market, objective,
   exact credit ceiling and ISO deadline with timezone. Confirm the displayed
   public fields to save a **draft only**. Preserve the returned `orderId`.
3. `/workspace-muse approve ORDER_ID` reads the exact scope and separately asks
   the human to approve its existing `reviewHash`.
4. `/workspace-muse dispatch ORDER_ID` rereads it and asks a second confirmation.
   The original service refuses dispatch before approval. `queued` means queued.
5. Your existing Muse consumer performs its normal inbox/read/claim, heartbeat,
   upload and submit. This TUI cannot impersonate or wake it.
6. `/workspace-muse status ORDER_ID` reads the same task, attempt/fence and phase.
   `/workspace-muse refresh ORDER_ID` uses the original Session projection to
   return the actual receipt to the original conversation.
7. `/workspace-muse accept ORDER_ID` requires another human confirmation bound
   to both original review and returned receipt hashes. Cancel is also explicit.

`list` recovers the original server-side tasks after restart. If the draft
response is lost, `retry` reads the fsynced local request journal and resends the
same UUID/body after confirmation; it never approves or dispatches. The journal
is private runtime data under `tui/.data/`, ignored by Git, and contains public
task scope only. Owner/workspace/conversation changes fail closed.

## Protocol and acceptance boundaries

Owner API: `/api/conversations/:originalNativeAgentId/muse-delegations` and the
existing `approve`, `dispatch`, `refresh`, `cancel`, `accept` operations.
Worker API: `/api/muse-worker/v1`, `workspace.muse.pull.v1`, with
`taskRef` (= original order ID), server `attemptId`, integer `fence`, lease and
stable per-operation request IDs. The checked-in consumer is
`deploy/muse-native-overlay/client/workspace-api.py`; its v4 implementation uses
this protocol. Old `server/worker-provider.mjs` taskKey/DSH workflows are a
different historical path and are not imported or revived here.

Local tests use synthetic owners, ingress keys, Worker bearer and temporary
Store data. They are **not real Muse, real owner authorization, deployment,
paid work, product publication, or unattended notification acceptance**.
Remaining live gates: existing production owner transport; restored exact
owner/conversation binding; verified current remote Muse consumer/egress and
existing grants; one specifically approved real task/budget; actual Muse claim
and returned receipt on that same task. No such external action is authorized
or performed by this implementation.

## Verification

```sh
npm --prefix tui test
node --test test/pi-muse-binding.test.mjs test/pi-muse-policy.test.mjs
python3 deploy/muse-native-overlay/client/workspace-api.py test
```

The extension API and CLI flags were read from the published pinned package's
`docs/extensions.md`, `dist/core/extensions/types.d.ts`, and `dist/cli/args.js`.
[Upstream Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).
