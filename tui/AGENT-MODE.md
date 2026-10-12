# Native Pi Agent mode — source checkpoint, acceptance pending

This follow-up adds five native `pi.registerTool()` definitions in the existing
extension: supplier intake/get/profile/preview and original Muse draft creation.
It reuses the same original owner transport, MCP clients and draft HTTP service.
Every tool requires a visible TUI confirmation; model arguments contain no
approval, dispatch, publication or schedule-activation operation. The original
manual commands and review hashes remain required for those operations.

Explicit `npm --prefix tui run agent` (or trusted Host environment
`WORKSPACE_PI_MODE=agent`) selects Agent mode. Default startup remains the existing
no-model command mode. Agent mode leaves model configuration and login to Pi's
existing profile, `/login` and `/model`; the launcher does not open or copy real
credentials. The Host still drops provider key environment variables. An existing
absolute `PI_CODING_AGENT_DIR` may select its reviewed original Pi profile.

The five schemas register only after the original owner MCP handshake succeeds.
No business tool runs without a real TUI and per-call confirmation. Stable request
IDs derive from the native Pi session/tool-call IDs and original owner scope;
requests are journaled before sending and model output never supplies a grant.

**This is a preservation checkpoint, not acceptance.** Syntax and existing command
regressions have been checked. Actual Pi native tool-call execution with a
deterministic local provider, rejection/no-UI scenarios and final documentation
are still being validated. Real natural-language quality, model text intake,
real provider login/spend, production Host, Shopify and Muse remain unverified.
No real model/key/account operation or new authorization has been performed.
