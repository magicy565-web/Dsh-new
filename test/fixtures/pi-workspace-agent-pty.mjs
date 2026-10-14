// Test-only official TUI launcher. It injects a finite synthetic provider,
// not a user-facing --sample mode, credential profile or replacement runtime.
import path from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceClient } from '../../pi/extensions/workspace.mjs';
import { createWorkspaceAgentRuntime } from '../../scripts/pi-workspace-agent.mjs';
import { PUBLIC_PROCUREMENT, syntheticFrontend, callBusinessTool, actualToolReceipt } from './pi-workspace-agent-faux.mjs';

const isolated = process.env.PI_AGENT_TEST_DIRECTORY;
if (!isolated || !path.isAbsolute(isolated)) throw new Error('Explicit synthetic PTY directory required.');
const sessionDir = path.join(isolated, 'sessions');
const sessionManager = process.env.PI_AGENT_TEST_SESSION_FILE
  ? SessionManager.open(process.env.PI_AGENT_TEST_SESSION_FILE, sessionDir, isolated)
  : SessionManager.create(isolated, sessionDir);
const response = async (context, options) => {
  const last = context.messages.at(-1);
  if (last?.role === 'toolResult') return actualToolReceipt(context);
  const text = typeof last?.content === 'string' ? last.content : (last?.content || []).filter(row => row.type === 'text').map(row => row.text).join('\n');
  if (text.includes('Cancel this synthetic turn')) {
    await new Promise(resolve => options.signal.aborted ? resolve() : options.signal.addEventListener('abort', resolve, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  }
  if (text.startsWith('Read')) {
    let taskId;
    for (const message of context.messages.filter(row => row.role === 'toolResult')) {
      try { const value = JSON.parse(message.content.filter(row => row.type === 'text').map(row => row.text).join('\n')); taskId = value.task?.taskId || taskId; } catch {}
    }
    if (!taskId) throw new Error('No original taskId in the official persisted transcript.');
    return callBusinessTool('workspace_business_status', { taskId });
  }
  return callBusinessTool('workspace_business_task', { ...PUBLIC_PROCUREMENT, requestId: 'agent-pty-public-procurement' });
};
const frontend = await syntheticFrontend(Array.from({ length: 12 }, () => response));
const client = createWorkspaceClient({ baseURL: process.env.WS_AGENT_URL, token: process.env.WS_AGENT_TOKEN });
const { runtime, InteractiveMode } = await createWorkspaceAgentRuntime({ client, isolationDirectory: isolated, ...frontend, sessionManager });
try {
  const mode = new InteractiveMode(runtime, { startupDiagnostics: [{ type: 'info', message: 'Explicit synthetic agent PTY fixture · official Agent and session · no live model account' }] });
  await mode.run();
} finally { await runtime.dispose(); }
