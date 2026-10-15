# OMP original Host Session business reads — 2026-10-15

This change allows the original OMP public conversation to use its existing
Host Session for `workspace_business_tasks` and `workspace_business_result`
when no business Bearer is configured. It creates no token, member, principal,
role, login system, execution queue or business record. The original Bearer
integration remains available with its existing boundaries.

The original Agent service supplies an internal read client only after resolving
the existing member principal and `agent:read` permission. Enterprise reads
revalidate the original live Session ID, member, workspace and role. Local mode
accepts only the existing local operator, with an existing principal. Missing
service/binding is refused; an authorized query with no records returns `empty`.
The client fingerprint binds the existing principal permission fingerprint,
Session ID and original application instance. Original conversation ownership,
receiver, instance and transcript binding checks remain in place.

The shared business read projection retains the original metadata validation,
credential-like-content rejection, bounded text artifacts, exact bytes, SHA and
source references. The Session transport calls the original `engine.list`,
`engine.find`, `engine.project` and owned artifact projection. It checks Session
and principal authority before and after asynchronous reads, including artifact
failures, and checks ownership after awaited projection/artifact reads.

Only the two existing business read tools are registered and active in this
mode. The OMP child RPC admits only their business read methods. No public
search/browser/subagent, Library, factory write, business submit/resume/cancel,
external Worker or alternative model loop is enabled by this Session client.
An explicit execution request is refused before Run admission. Session read
clients cannot select private factory profiles. Human stop-answer continues to
use the original conversation cancellation endpoint.

The request path remains:

1. Original signed enterprise Session/CSRF, or original loopback local Session.
2. `POST /api/conversations/:id/messages`, read-only intent.
3. Original conversation owner, member binding, recipient and instance checks.
4. Original Runtime Run → reviewed OMP worker → official OMP AgentSession.
5. Existing read tool → original Host member/Session authorization → original
   Agent coordinator/Store and owned text artifact projection.
6. Original tool receipt, source API/record IDs and artifact SHA → original
   OMP journal → Run reply, terminal status and linked business results.

The source references still describe the corresponding original
`/api/agent/v1/tasks/:id` resources. The internal Session client performs no
Bearer HTTP request and exports no raw Session credential. The standalone
`acceptance-deepseek-readonly.mjs` remains a separate Bearer-only acceptance
script; this change tests the original Host conversation path instead.

## Evidence and limits

74 distinct selected tests passed with zero failures/skips. The final six-test
Session suite was rerun successfully after adding local OMP empty-state and
in-flight artifact revocation coverage. Tests ran in a subprocess environment
containing only PATH, temporary HOME and NO_COLOR; injected real model/business
credentials were excluded. The official installed OMP 18.10.4/Bun 1.3.14 runtime
was used for OMP checks. Model responses were explicit finite synthetic responses
with no real-provider fallback.

The new suite exercises real original Host HTTP, signed Session login/CSRF,
Runtime, Store, Agent coordinator/projection, and official OMP SDK tools with
clearly synthetic members, fixture principal configuration, business records and
text documents. Fixture identities/principals exist only in temporary test Hosts;
no production identity or credential was created. It covers:

- Missing principal refuses before any Run; authorized local OMP receives a true
  empty tool receipt without creating a business task.
- Newest-created owner-only task list and exact saved document SHA/source.
- Cross-member/workspace IDs, forged selectors and mismatched Session identity.
- Session logout/rotation, principal expiry, and logout during artifact reading.
- An `agent:read`-only principal can use the existing read tools without gaining
  business execution; execution intent and a forged model write are refused.
- Original application instance mismatch and rotated-Session transcript reuse.
- Original terminal status, linked business results and foreign-conversation 404.

Selected test groups:

```sh
node --test test/workspace-omp-session-readonly.test.mjs \
  test/deepseek-acceptance-policy.test.mjs test/pi-procurement-package.test.mjs \
  test/agent-unified-host.http.test.mjs test/agent-ui.http.test.mjs \
  test/workspace-omp-terminal-host.test.mjs test/workspace-omp-launch.test.mjs
# 39 passed, 0 skipped
node --test test/workspace-omp.test.mjs test/pi-workspace-plugins.http.test.mjs \
  test/pi-business-conversation.native.test.mjs test/pi-workspace-business.test.mjs
# 35 passed, 0 skipped
node --test test/workspace-omp-session-readonly.test.mjs
# Final Session suite: 6 passed, 0 skipped; overlaps the first group.
```

Additional paid requests: **0**. No actual enterprise Host, user Session,
private record, real business tool result, external sending or deployment was
verified here. Synthetic business permission evidence must not be presented as
real enterprise data or business achievement. The earlier one-request real
DeepSeek model connectivity acceptance is separate evidence; it did not validate
business binding or this later code change against a live model.

A future live business check requires the user's exact existing Host, a current
original local/enterprise Session, an already-authorized member/principal and
`agent:read` scope. No missing binding is manufactured. Invoking the model also
still requires reviewed provider configuration, prices, remaining budget and
explicit authorization for any real data disclosure and paid call. Neither the
prior model smoke test nor this keyless regression authorizes another paid call.
No Shopify, MCP, Muse source was changed. No main merge, deployment, permission
change or credential provisioning was performed.


## Actual startup follow-up

See [actual npm entry, authority-race correction and current prerequisites](startup.md)
for the later real `npm start`/original Session/OMP SDK test with explicit synthetic
identities, records and model responses, the completed build, and 43 selected
follow-up regressions. These counts overlap the initial checks above.
