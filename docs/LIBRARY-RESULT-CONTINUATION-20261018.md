# Authorized Library input, saved reply and same-Session continuation

This is a scoped local acceptance record, not a live service or deployment sign-off.

## Source identity and actual gap

At inspection, the existing integration development branch
`codex/omp-all-plugins-integration-20261017` pointed to
`1ef1a7f73b32608a439afaf56be0997562a346c7`. It did not yet contain the Space
permission fix. This work starts from the already saved descendant
`91c84882b4ee708c702847112a3f6ce4f3159d85`, retaining that fix and the full
integration baseline. It does not restart from main or merge a candidate PR.

The tested code is commit `a1634abc39972389f55b21f19de983f3126e672a` on
`codex/authorized-library-result-continuation-20261018`. This documentation
commit changes no tested executable bytes.

The existing application already had the required production paths. The missing
evidence was one connected flow: the previous document SDK fixture selected no
product and did not exercise the production reply-save button. No production
blocker was found in the new run, so no production module, authorization rule,
default enablement, dependency or lockfile was changed.

The change adds one opt-in `library-flow` fixture trajectory and one focused DOM/SDK
test. Other fixture modes retain their existing inputs. Product selection uses
one exact Library product revision and the `name`/`description` field mask; the
unapproved category is checked absent from every finite model wire request.
Medusa, Shopify, marketplace and market-validation tools stay disabled in this
trajectory. Association alone still fails to authorize an unreviewed document.

## Actual execution

```sh
node --test --test-concurrency=1 --test-reporter=tap \
  test/workspace-library-result-sdk.dom.test.mjs
```

The command ran once: exit **0**, wall **12.740 s**, actual TAP **1 pass, 0 fail,
0 skipped, 0 cancelled, 0 todo**. The test body executed and completed.
TAP SHA256:
`95d71e49cd9f64a90762209a5b6731ba7790c151c6370177b6ca8b4fc2b36d8d`.

The run used Node 24.19.0, official Bun 1.3.14, OMP 18.10.4 and locked pi-ai
1.1.0 from the existing verified installation. No dependency installation was
performed. The isolated production bundle was copied from the unchanged
91c84882 frontend; no repeated web build or old heavyweight acceptance was run.
The JavaScript bundle SHA256 was
`c924a5d3d9e5fb45a75f2de8fe98dbab8f392ba0c4c0f24cf540e404e0df2551`.
A clean checkout needs the ordinary `npm run build:web` prerequisite before this
DOM test; that command was not counted as newly run here.

Only PATH/HOME/TMPDIR/XDG_CACHE_HOME/LANG/NO_COLOR and the original
WORKSPACE_BUN_BIN/WORKSPACE_OMP_PACKAGE_ROOT paths were supplied to the test
process. HOME/cache/tmp were fresh private directories. No provider, Agent,
Medusa, Docling or proxy configuration was inherited. Original test fixtures
use short-lived synthetic signed identities and synthetic parser/model values;
no real account, credential or token was created or accessed.

## What completed

1. Original signed Host login and CSRF, then the actual Library HTTP interfaces
   imported one synthetic document and one internal draft product. Import uses
   the real APIs, not a rendered browser upload form.
2. The original reviewed startup configuration pinned the exact source versions,
   artifact SHA, receiver, field mask and complete-file parser-transfer approval.
   The new conversation selected those original Library references. An earlier
   submission without the required document selection was refused before a Run.
3. The production chat bundle submitted the first message. The official native
   loader/Session read the original skill, authorized product projection and
   selected document through real Host tools. Four finite provider requests
   completed; the first request contained neither source content, and the final
   request contained both authorized inputs. Only one parser request occurred.
4. The completed reply included the approved product fields and document fact.
   The user-facing **Save reply to Library** button issued exactly one original
   Artifact POST, with the exact reply, conversation and Run references. The
   saved Markdown download matched the reply and its SHA256.
5. The next message was entered and sent through the same production composer.
   It completed with one finite provider request, the same persisted native
   Session mapping and both prior authorized sources. It did not parse again.
6. Another member could not read the owned conversation (404). No execution
   references or enterprise-memory writes were created. Browser errors were empty.

Saving remains the existing explicit user action on a completed Agent reply.
This work grants no autonomous Artifact write capability to a readonly Agent.

## Real components and finite services

Real: production React bundle, original signed HTTP/Session/CSRF, Library,
Artifact bytes and Store, original Run ownership, official Bun/OMP SDK, native
tool receipts, JSONL and same-Session continuation. JSDOM has no layout and does
not certify a real browser, Tencent ingress or enterprise IdP login.

Finite: original SSE preload returns only the selected synthetic trajectory;
its fetch assertion rejects unmatched requests without live fallback. Docling
is the original finite loopback responder. Both Runs asserted zero external
model requests. The product is an original Workspace Library product, not a
real Medusa product. No container pull/start, Medusa account/token, paid request,
Tencent access, PR112 retry or old OMP receipt migration was performed.

The earlier split 27-case acceptance and Space permission tests were not rerun
and are not added to this run's one-case result. Raw logs, private reviewed
configuration, Sessions and runtime output remain outside Git.

## Remaining real-user acceptance steps

1. An authorized operator must use the fixed development version in an approved
   test entry with the existing enterprise login, one writer, persistent data
   and pinned runtime. This work did not deploy or inspect a real login session.
2. Import a real permitted sample document and Workspace Library product, then
   have the operator review their exact IDs/revisions/version/SHA, permitted
   fields and model receiver. The existing startup review configuration is
   loaded on startup; associating an upload in the UI does not create that grant.
3. Supply an already approved parser connection and explicit complete-file
   transfer consent, plus separately authorized real-model billing and an
   enforceable budget through existing secure configuration. No such real calls
   are authorized or executed by this record.
4. In the real browser select the reviewed references, send the first question,
   explicitly save/download the reply, then send the next question in the same
   conversation and verify the original Session mapping and saved bytes.

Real Medusa remains separate and unexecuted: its temporary-container and test
identity approval is still absent. It was not requested again or worked around.
