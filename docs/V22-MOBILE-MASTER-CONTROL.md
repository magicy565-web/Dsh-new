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

The companion floats/breathes when idle, moves more actively while a real goal or
associated conversation is running, and gives a gentle attention motion for
approval, review or failure. No fabricated progress or task data appears in the
production UI. Bootstrap failure or expiry freezes the active animation and
disables writes while preserving the last snapshot with a stale-state message.

Unknown write outcomes retain the original path, body and request ID. Task
switching/closing is frozen until the original request is reconciled; duplicates
are rejected by the existing backend idempotency fence. Viewer controls remain
read-only, with server access control unchanged.

The existing Modal provides focus trapping, Escape handling and focus restoration.
The avatar is a labelled button. Reduced motion disables animation; background
tabs pause it. Image failure falls back to a lightweight CSS avatar. VisualViewport
resize keeps the avatar and composer above the mobile keyboard. Safe areas and
small/landscape viewports are handled without horizontal overflow.

## Asset

`src/experience/assets/control-spirit.png` is an original transparent image made
with built-in Image Gen. CSS animates the actual asset; no video, WebGL engine or
third-party animation package is required. Its generation prompt is included in
`docs/V22-CONTROL-SPIRIT-PROMPT.txt`.

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
