# DSH development boundary

Scope correction: the user rejected building a broad business platform. Follow
docs/SCOPE-REDUCTION.md. Treat "continue" as continuing the agreed scope, not as
permission to invent the next business module, panel, approval chain or stage
engine. Audit and remove duplication first; use native DSH capabilities and
on-demand skills. Existing business bundles are not the required core. The
current five-bundle development profile is historical implementation state,
not the target architecture. Preserve data during any subsequent code removal.

Buyer magazine scope is defined in docs/BUYER-MAGAZINE-ARCHITECTURE.md:
conversation-driven creation, with no visual editor requirement. Read actual
materials from the user's accessible local workspace or server-side work-order
uploads. Cloud execution does not imply access to the user's computer. ERP owns
transactions and supply reservations; no ERP vendor or work-order integration
has been selected or validated. Do not implement parallel transaction state.

The user selected DeepSeek Harness as the sole execution host and explicitly
requested removal of the standalone Workspace Harness and remaining legacy
implementations on 2026-10-26. Develop native bundles under integrations/dsh.
Do not restore old React/Node apps, OMP/Pi/TUI, custom Agent loops, composition
servers, installers or historical release archives in the current tree.

Reuse native DSH sessions, model execution, tools, permissions and attachments.
Business workflow gates belong in optional plugins, not the general substrate.
The packages/domain-* packages contain reusable domain rules only. The native
dsh-workspace-memory and dsh-inquiry-recovery bundles adapt their domains to DSH.
The Medusa product domain awaits integration; the native local product library
already supplies product context. Preserve source/version/review boundaries and state keys.

Run npm ci --ignore-scripts on first setup (Node 24+), then npm run check. Optional Client
DOM tests use the root devDependencies: npm run test:client. Neither establishes
live host/model/browser acceptance. Never put user data, credentials, native
sessions or generated release archives in Git.

Work on agent/harness-20261023; stage explicit paths only. Do not force-push or
rewrite release history. Preserve untracked user files and other checkouts.
See docs/DEVELOPMENT.md for the current layout and integration work.
