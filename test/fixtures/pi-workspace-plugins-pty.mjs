// Explicit test-only finite frontend. The official Agent/InteractiveMode and
// original authenticated business HTTP paths run unchanged; no live account.
import path from 'node:path';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceClient } from '../../pi/extensions/workspace.mjs';
import { createWorkspaceAgentRuntime } from '../../scripts/pi-workspace-agent.mjs';
import { syntheticFrontend, callBusinessTool, actualToolReceipt } from './pi-workspace-agent-faux.mjs';

const isolated = process.env.PI_PLUGIN_TEST_DIRECTORY;
if (!isolated || !path.isAbsolute(isolated)) throw new Error('Explicit synthetic plugin PTY directory required.');
const response = context => {
  const last = context.messages.at(-1);
  if (last?.role === 'toolResult') {
    const original = actualToolReceipt(context);
    const value = JSON.parse(last.content.filter(row => row.type === 'text').map(row => row.text).join('\n'));
    // Compact original fields survive a terminal's visual line wrapping. They
    // are derived only from the real tool receipt, never fixture expectations.
    const facts = `PLUGIN_STATUS ${last.toolName} ${value.status}${value.reason ? ' reason=' + value.reason : ''}`;
    const record = value.task?.taskId ? `\nPLUGIN_RECORD ${value.task.taskId}` : '';
    return fauxAssistantMessage(original.content.filter(row => row.type === 'text').map(row => row.text).join('\n') + '\n' + facts + record + `\nPLUGIN_REPLY_END ${last.toolName}`);
  }
  const text = typeof last?.content === 'string' ? last.content : (last?.content || []).filter(row => row.type === 'text').map(row => row.text).join('\n');
  if (text.includes('产品详情')) {
    const productId = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu)?.[0];
    if (!productId) throw new Error('Explicit synthetic product ID required.');
    return callBusinessTool('workspace_product', { productId });
  }
  if (text.includes('有哪些产品')) return callBusinessTool('workspace_products', {});
  if (text.includes('公司资料')) return callBusinessTool('workspace_company_profile', {});
  if (text.includes('任务进度')) return callBusinessTool('workspace_business_tasks', {});
  if (text.includes('上次成果')) return callBusinessTool('workspace_business_result', {});
  throw new Error('Finite synthetic fixture has no matching question; no live fallback.');
};
const frontend = await syntheticFrontend(Array.from({ length: 12 }, () => response));
const client = createWorkspaceClient({ baseURL: process.env.WS_AGENT_URL, token: process.env.WS_AGENT_TOKEN });
const { runtime, InteractiveMode } = await createWorkspaceAgentRuntime({ client, isolationDirectory: isolated, ...frontend });
try {
  await new InteractiveMode(runtime, { startupDiagnostics: [{ type: 'info', message: 'Explicit synthetic built-in plugin PTY fixture · official Agent · zero live model calls' }] }).run();
} finally { await runtime.dispose(); }
