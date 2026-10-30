# Commerce canvas: architecture and acceptance

The commerce canvas is a project-level workspace for seeing, organising and acting on the relationships between
products, collaborators, AI Workers, channels, trades and executions. It is a view over backend records and the native
DSH Assistant. It is not a data source and it creates no business facts.

## Layers

| Layer | Responsibility | Source |
|---|---|---|
| Data | projects, parties, mandates, work orders, trade | `service.js`, `/workspace`, `/trade` |
| Projection | record to node / edge / status | `src/projection/*.mjs`, `src/model.mjs` |
| Layout | shared coordinates (team) and viewport (personal) | `/layout` (merge writes), `canvas/viewport-store.mjs` |
| Interaction | gestures, selection, add, connect, inspect | `src/canvas/*` |
| Action | create, delegate, authorise, accept | `POST /command`, native Assistant |

## Rules that do not change

- Nodes are produced only by projection. A user cannot create an empty node; `Add` opens a capability menu that either
  hands work to the Assistant or opens an existing business dialog.
- Only relations backed by a command can be dragged out, and the result is a draft placeholder that becomes a node only
  after a service receipt. A rejected draft is rolled back with its reason.
- Coordinates are optimistic. Every business state is shown from receipts.
- A saved position always wins. Nodes without one are placed by `canvas/layered-layout.mjs`, which is deterministic,
  never overlaps another node and never moves a saved node.
- Switching a view only filters what is shown; hidden nodes keep their coordinates.

## Layout and save state machine

`canvas/layered-layout.mjs` ranks nodes left to right by edge direction (back edges are dropped so cycles terminate),
stacks unrelated groups instead of interleaving them, orders each column by the barycentre of its upstream nodes and
gathers unlinked nodes in a grid below. `Auto layout` uses the same function and is undoable.

`canvas/layout-saver.mjs`: idle, pending (400 ms debounce), saving, then saved, conflict (offer "load latest" or
"keep mine"), offline, error (retry) or readonly. A receipt only counts as saved if it carries a higher layout revision.
Timers are always invoked detached from the instance because browsers throw `Illegal invocation` otherwise.

## Views

| View | Shows |
|---|---|
| Global | everything, with an "only related to the selection" toggle |
| Commercial network | products, factories, distributors, markets, channels, buyers and their relations |
| Execution | AI Workers, service orders, dependencies, deliveries, approvals, evidence and the trade chain |

## States and exceptions

| Case | Behaviour |
|---|---|
| No project | read-only canvas, central prompt to create a project |
| Zero nodes | grid plus a dismissible onboarding card with three entry points |
| Filter without results | top banner with a "clear filter" button |
| Load failure | last picture kept, error banner with retry |
| Trade source unavailable | trade nodes shown as placeholders, one top notice |
| Narrow container (< 700 px) | toolbar at the bottom, inspector as a bottom sheet |

## Verification status

Automated: `npm run check`, `npm run test:commerce` and the eight client smokes under `dev/`. The layered layout, the
save state machine (including a browser-style scheduler) and the token contract each have their own test file.

Manual, in real Chromium with a synthetic workspace served outside DSH: select, inspector, search, add menu, fit view,
zoom, drag with automatic save and undo, shortcut panel, activity drawer, view switch, minimap, light and dark themes,
empty state and a 390 px layout. Not verified: the live DSH host, a live model, a real multi-user conflict and touch
gestures on a physical device.
