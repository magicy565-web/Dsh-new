// Actual official OMP InteractiveMode; UI input goes to original HTTP Runs.
// This SDK session has no executable model transport, sample or provider key.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspaceOmpSession } from '../server/workspace-omp-session.mjs';
import { workspaceOmpConfiguration } from '../server/workspace-omp-host.mjs';
import { existingBinding } from '../packages/workspace-procurement/src/extension.js';
import { createWorkspaceOmpTerminalClient, workspaceOmpTerminalControlClient } from '../server/workspace-omp-terminal-client.mjs';
import { workspaceOmpTerminalExtension } from '../server/workspace-omp-terminal-extension.mjs';
import { createOwnerRpcTransport } from '../tui/owner-rpc.mjs';
const environment = process.env, cwd = environment.WS_AGENT_SESSION_DIR;
if (environment.WORKSPACE_OMP_TERMINAL_DIAGNOSTIC === '1') console.error('OMP_TERMINAL_PREPARING');
const nativeRequest = environment.WORKSPACE_OMP_SESSION_RPC_FD === '3' ? createOwnerRpcTransport(3) : null;
const profile = environment.WORKSPACE_OMP_PROFILE || 'public';
if (!['public', 'factory-materials', 'factory-customers', 'factory-inquiries', 'factory-ingestion', 'market-validation'].includes(profile)) throw Error('Use a fixed reviewed OMP profile.');
const transport = createWorkspaceOmpTerminalClient({ baseURL: environment.WS_AGENT_URL,
  expectedEngineScope: profile === 'factory-ingestion' ? 'omp:18.10.4:factory-ingestion-v1' : profile === 'market-validation' ? 'omp:18.10.4:market-validation-v1' : profile === 'factory-inquiries' ? 'omp:18.10.4:factory-inquiries-v1' : profile === 'factory-materials' ? 'omp:18.10.4:factory-materials-v1' : profile === 'factory-customers' ? 'omp:18.10.4:factory-customers-v1' : 'omp:18.10.4:public-v1',
  ...(nativeRequest ? { requestImpl: nativeRequest } : {}), conversationId: environment.WORKSPACE_OMP_CONVERSATION_ID || null });
if (nativeRequest) await transport.verifySession();
const binding = existingBinding(environment);
const created = await createWorkspaceOmpSession({ packageRoot: environment.WORKSPACE_OMP_PACKAGE_ROOT, client: workspaceOmpTerminalControlClient(binding.client, { transport }),
  cwd, agentDir: environment.PI_CODING_AGENT_DIR, sessionDirectory: path.join(cwd, 'ui-sessions'),
  configuration: workspaceOmpConfiguration(environment), bindingConfiguration: nativeRequest ? 'configured_unverified' : binding.configuration,
  uiOnly: true, uiExtension: workspaceOmpTerminalExtension(transport), humanControls: true, hasUI: true });
if (environment.WORKSPACE_OMP_TERMINAL_DIAGNOSTIC === '1') console.error('OMP_TERMINAL_SESSION_CREATED');
const { InteractiveMode } = await import(pathToFileURL(path.join(environment.WORKSPACE_OMP_PACKAGE_ROOT, 'src/modes/interactive-mode.ts')).href);
const mode = new InteractiveMode(created.session, '18.10.4', undefined, created.setToolUIContext, created.lspServers, created.mcpManager, created.eventBus, undefined, created.subagentEventBus);
if (environment.WORKSPACE_OMP_TERMINAL_DIAGNOSTIC === '1') console.error('OMP_TERMINAL_MODE_CREATED');
await mode.init({ autoStartCollab: false }); await mode.renderInitialMessages({ preserveExistingChat: true });
process.once('SIGTERM', () => void created.close().finally(() => { nativeRequest?.close(); process.exit(0); }));
