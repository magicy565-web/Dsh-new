# V22 mobile master control

The home route now centers one animated companion on a quiet, full-height mobile
canvas. A single current-task link and command composer replace the former hero,
quick-start grid and business shortcut cards. Desktop uses the same restrained
surface. The existing goal, commerce, library, expert and execution services remain
the source of truth.

## Interaction contract

- Tap the companion or Tasks to open a bottom sheet. Filter active work, items
  needing attention and finished work. Selecting a task opens its exact controls.
- New commands go through the existing goal-confirmation sheet. Saving does not
  run the goal. The saved task opens in the control drawer without leaving home.
- Start, pause, resume and confirmed cancellation call existing goal APIs.
- Approval opens the exact conversation and its existing bound action review.
  Review opens the exact goal result. Reading either is never approval.
- Add instructions explicitly targets one task's existing conversation. Its
  actual active conversation state participates in the companion status, even
  after the goal has been reviewed. Stopping that follow-up cancels that run,
  without changing acceptance of the original goal.
- The collapsed workspace menu retains business libraries, product hosting,
  delegated services, experts, activity and runtime settings.

The provider must be configured for genuine execution. This feature supplies the
control surface; it does not configure the private native runtime, create new
permissions, silently dispatch Workers, perform Shopify operations or deploy.

## State, failures and accessibility

The companion has independently animated body, eyes and hands: breathing, blinking
and an occasional wave when idle; focused motion while a real goal or associated
conversation runs; and a more frequent wave for approval, review or failure.
Focusing the command input shifts its gaze toward the composer. No fabricated progress or task data appears in the
production UI. Bootstrap failure or expiry freezes the active animation and
disables writes while preserving the last snapshot with a stale-state message.

Unknown write outcomes retain the original path, body and request ID. Task
switching/closing is frozen until the original request is reconciled; duplicates
are rejected by the existing backend idempotency fence. Viewer controls remain
read-only, with server access control unchanged.

The existing Modal provides focus trapping, Escape handling and focus restoration.
The avatar is a labelled button. System reduced motion disables animation by
default. A separate 44px motion button lets the user explicitly enable or pause
it, with the preference stored locally and usable even if storage is blocked.
Background visibility events pause every layer. Offline/loading states remain
still regardless of the motion preference. VisualViewport
resize keeps the avatar and composer above the mobile keyboard. Safe areas and
small/landscape viewports are handled without horizontal overflow.

## Asset

`src/experience/assets/control-spirit.png` is an original transparent image made
with built-in Image Gen and retained as the original visual reference. The current
production companion is an articulated SVG/CSS interpretation in ControlSpirit.tsx,
with separate body, eye and hand layers. It is not a raster sprite sheet or video.
No animation dependency or per-frame React updates are required. The original
generation prompt remains in `docs/V22-CONTROL-SPIRIT-PROMPT.txt`.

## Run and verify

Production source requires Node 24+ and the existing reviewed runtime setup:

```sh
npm ci
npm run build
npm start
```

The browser suite uses the production bundle, real HTTP handlers, runtime and
stored application state, with an explicitly scripted provider (no model calls):

```sh
npm run test:control:browser
```

This Windows host cannot validate the existing directory-fsync implementation.
For explicitly memory-backed functional checks on this host:

```sh
node --experimental-test-module-mocks --import ./test/fixtures/goal-commerce-memory-preload.mjs test/master-control.browser.mjs
node --experimental-test-module-mocks --import ./test/fixtures/goal-commerce-memory-preload.mjs test/muse-commerce.browser.mjs
node --experimental-test-module-mocks --import ./test/fixtures/goal-commerce-memory-preload.mjs test/goal-commerce.browser.mjs
node --experimental-test-module-mocks --import ./test/fixtures/goal-commerce-memory-preload.mjs --test test/goal-commerce.http.test.mjs
```

`CHROMIUM_PATH` selects an installed Chromium browser. `CONTROL_QA_OUTPUT`,
`MUSE_QA_OUTPUT` and `GOAL_CONTEXT_QA_OUTPUT` select evidence directories.
The main control suite covers the full goal lifecycle, follow-up run cancellation,
exact approval rejection, committed-response loss/retry, stale data, viewer UI,
keyboard focus, reduced motion and 320/390/430/768/1440/landscape layouts.
It also samples actual transforms over 5.6 seconds for three independent layers,
checks the explicit reduced-motion override and persisted pause preference, and
simulates hidden/visible document events to verify background suspension.
The soft-keyboard check simulates VisualViewport events; this is not physical
iPhone/Android or Safari verification. Memory checks do not certify disk recovery,
live native execution, SSO deployment or external connectors.

## Local interaction preview

```sh
npm run preview:control
```

This opt-in test preview uses memory storage and scripted 12-second responses.
Its header says “本地交互预览”. The printed localhost address is only for reviewing
the interaction; it contains sample tasks, loses state at shutdown and must never
be used as the production server entrypoint. Real startup remains `npm start`.

## Existing cloud Worker integration

When the authenticated bootstrap advertises dotIntegration.enabled, home now uses
CloudControl against the existing same-origin /api/personal-worker API, instead
of presenting local Harness goals as cloud Worker delegations. SSE change notices
and a bounded three-second polling fallback refresh the original Worker state.
Queued, leased/running, return_pending and succeeded are distinct visible nodes;
unreceived, unclaimed, stale and uncertain work cannot show an executing pulse.

Public task submission requires an explicit checkbox and an existing conversation.
Cancel binds the exact job ID; completion review binds its completionHash. Returned
file links retain the original artifact ID and version. Unknown writes retain their
original request ID through useWrite. No MCP credentials or new backend are added.

On 2026-10-11 the actual workspace.cnsubscribe.xyz browser session showed the old
chat UI, two historical jobs and four files. Separate read-only Workspace — xy
identity/inbox calls succeeded, but identity reported nativeExecutorAttested=false
and inbox was empty. These observations do not prove a new task can execute.
The live site had not received this UI at this checkpoint.

test/cloud-control.browser.mjs checks the deployed Worker API contract using
explicit fixtures. Those checks are UI/contract regression only, not live task
or deployment acceptance. Release the frontend with the original backend owner,
preserving authentication, data, Worker identity and lease state. Confirm the
original job/file IDs in the live UI before claiming integration is delivered.
