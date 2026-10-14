// Test-only injection into the same official AgentSession/InteractiveMode as
// agent:dev. Every control below is a human command; no paid provider is loaded.
import { createWorkspaceClient } from '../../pi/extensions/workspace.mjs';
import { createWorkspaceAgentRuntime } from '../../scripts/pi-workspace-agent.mjs';
import { syntheticFrontend } from './pi-workspace-agent-faux.mjs';

const frontend = await syntheticFrontend([() => { throw new Error('Lifecycle human commands must not call the frontend model.'); }]);
const client = createWorkspaceClient({ baseURL: process.env.WS_AGENT_URL, token: process.env.WS_AGENT_TOKEN });
const { runtime, InteractiveMode } = await createWorkspaceAgentRuntime({ client, isolationDirectory: process.env.PI_AGENT_TEST_DIRECTORY, ...frontend });
try {
  await new InteractiveMode(runtime, { startupDiagnostics: [{ type: 'info',
    message: 'Explicit synthetic lifecycle agent fixture · official AgentSession and InteractiveMode · no live model account' }] }).run();
} finally { await runtime.dispose(); }
