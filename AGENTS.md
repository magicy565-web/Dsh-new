# DSH development boundary

The user selected DeepSeek Harness as the sole execution host and explicitly
requested removal of the standalone Workspace Harness and remaining legacy
implementations on 2026-10-26. Develop native bundles under integrations/dsh.
Do not restore old React/Node apps, OMP/Pi/TUI, custom Agent loops, composition
servers, installers or historical release archives in the current tree.

Reuse native DSH sessions, model execution, tools, permissions and attachments.
Business workflow gates belong in optional plugins, not the general substrate.
The packages/domain-* packages contain reusable domain rules only. The native
dsh-workspace-memory bundle adapts the business-memory domain to DSH; the other
two domains await integration. Preserve source/version/review boundaries and state keys.

Run npm ci --ignore-scripts on first setup (Node 24+), then npm run check. Optional Client
DOM tests use the root devDependencies: npm run test:client. Neither establishes
live host/model/browser acceptance. Never put user data, credentials, native
sessions or generated release archives in Git.

Work on agent/harness-20261023; stage explicit paths only. Do not force-push or
rewrite release history. Preserve untracked user files and other checkouts.
See docs/DEVELOPMENT.md for the current layout and integration work.
