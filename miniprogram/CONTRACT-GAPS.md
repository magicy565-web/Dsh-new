# Client / backend handoff — 2026-10-12

Client branch starts at e67596dc31ce61ed5d1121e1d6f79d0563a043d9. It includes the entire client-side original Muse correction from 4f2c0b9 (PR34 delivery head cf6de2935c9c57d86dac57a58ed79e79e5d990d5, final source ee1ad6c16a528284a9bfaf47512094295adb06bb). No backend, shared package/lock/build script, main, deployment, production probe, credential or permissions change.

## Required login integration

The existing boundary `Options.loginBroker(code)` must be provided by the deployment integration, with `baseUrl` pointing to its reviewed HTTPS origin. The default remains empty. The client acquires a code once per login (concurrent taps share that attempt), never stores it, and requires this response:

```ts
{ token: string, // existing 43-character A-Z/a-z/0-9/_/- session token
  session: { authenticated: true,
    user: { id: string, role: string },
    csrfToken: string | null,
    expiresAt: string | null,
    mode: 'enterprise' } }
```

A candidate HTTPS broker request is `POST <reviewed broker route>` with `{code:string}`. This is a contract proposal, not an implemented or tested public route. The backend must verify code/AppID on WeChat's server and map to the already authorized enterprise subject and original conversation. AppSecret, ingress assertions and membership/role decisions stay server-side. It must preserve signed ingress, membership, Origin, CSRF, expiry/revocation, and original Muse owner/session checks. `X-Workspace-Session` transports the original session only. The client next reads `GET /api/session` using that token; subject mismatch fails, and the actual role wins over broker claims. Tokens/CSRF stay in memory. Cold launch requires a fresh authorized login, then reads the same cloud conversation and subject-scoped local pending request. No stub login succeeds in the shipped app.

## Existing API limits and safe client handling

1. `POST /api/conversations` currently accepts title but has no requestId dedupe. Add an optional requestId with durable subject + body fingerprint dedupe and return the same conversation on replay. Current client coalesces concurrent creation, reloads authoritative cloud state after an uncertain response, and refuses to replay unknown creation when no exact conversation can be recovered. It never generates another creation as a retry.
2. `POST /api/runs/:id/action-decision` currently permits `{proposalId, decision:'approved'|'denied', confirmed:true}` only and returns conflict on repeated decisions. Optional durable decision requestId + immutable scope fingerprint would simplify reconciliation. Current client saves the original decision and reads `GET /api/runs/:id` to reconcile that exact proposal before repeating it. It never turns a text message or attached/reference file into consent.
3. Existing `POST /conversations/:id/messages` with provider Pi produces governed cloud run/proposals. The existing Muse prepare route requires an already structured order (serviceId, product, market, objective, budgetCredits, deadlineAt, publicDataConfirmed) and does not interpret a natural-language goal. For conversation-first Muse preparation, backend must return a draft scope plus only necessary missing fields through the governed goal flow; the client must review that exact scope and separately confirm public-data authorization before using the original prepare route. Client currently displays and operates real existing original Muse orders; it does not invent scope, auto-create an order, claim a wake, or substitute Pi text as Muse execution.
4. Images/PDF can be uploaded to original storage; current model adapter is text-only. Client states that they are stored and omits them from model input. Reopening resources reads those real uploaded file IDs from bootstrap. Private library association stays separate from model/Connector export. No fake OCR/extraction is shown.

No shared dependency or lockfile change is needed. The request journal uses the native file API in a distinct baseUrl + subject namespace, writes before mutation, preserves original request bodies across a cold restart, and contains no identity credential. Only an explicit retry sends a retained request. A storage failure blocks a new mutation.
