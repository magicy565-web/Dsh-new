// Test-only Session bridge. Actual official Agent/InteractiveMode and tools.
import path from 'node:path';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createWorkspaceAgentRuntime } from '../../scripts/pi-workspace-agent.mjs';
import { createWorkspaceClient } from '../../pi/extensions/workspace.mjs';
import { createWorkspaceLibraryClient } from '../../pi/extensions/workspace-library-client.mjs';
import { request } from '../agent-service.helpers.mjs';
import { syntheticFrontend, callBusinessTool, actualToolReceipt } from './pi-workspace-agent-faux.mjs';
const recipient = { kind: 'pi-coding-agent', provider: 'workspace-agent-test-faux', model: 'workspace-agent-test', destination: 'faux://keyless-synthetic' };
const isolated = process.env.PI_LIBRARY_TEST_DIRECTORY;
if (!isolated || !path.isAbsolute(isolated)) throw new Error('Explicit isolated synthetic Library PTY directory required.');
const response = context => {
  const last = context.messages.at(-1);
  if (last?.role === 'toolResult') {
    const value = JSON.parse(last.content.filter(row => row.type === 'text').map(row => row.text).join('\n'));
    return fauxAssistantMessage(actualToolReceipt(context).content.filter(row => row.type === 'text').map(row => row.text).join('\n')
      + `\nLIBRARY_STATUS ${last.toolName} ${value.status}`
      + (value.sources || []).map(row => `\nLIBRARY_SOURCE ${row.recordId} ${row.revision} ${row.projectionSha256}`).join('')
      + `\nLIBRARY_REPLY_END ${last.toolName}`);
  }
  const text = typeof last?.content === 'string' ? last.content : (last?.content || []).filter(row => row.type === 'text').map(row => row.text).join('\n');
  if (text.includes('公司资料')) return callBusinessTool('workspace_company_profile', {});
  if (text.includes('产品详情')) return callBusinessTool('workspace_product', { productId: text.match(/[0-9a-f-]{36}/u)?.[0] });
  if (text.includes('有哪些产品')) return callBusinessTool('workspace_products', {});
  if (text.includes('任务进度')) return callBusinessTool('workspace_business_tasks', {});
  throw new Error('Finite explicit faux fixture has no matching question; no live fallback.');
};
const frontend = await syntheticFrontend(Array.from({ length: 12 }, () => response));
const libraryClient = createWorkspaceLibraryClient({ recipient, request: (route, options) => fetch(process.env.PI_LIBRARY_SESSION_BRIDGE + route, options) });
const client = createWorkspaceClient({ baseURL: process.env.WS_AGENT_URL, token: process.env.WS_AGENT_TOKEN, libraryClient,
  fetchImpl: async (url, options) => {
    const route = new URL(url).pathname + new URL(url).search;
    const value = await request(process.env.WS_AGENT_URL, route, { method: options.method, rawBody: options.body, headers: { ...options.headers, Host: 'workspace.example' } });
    return new Response(value.bytes, { status: value.status, headers: { 'content-type': value.headers['content-type'] } });
  } });
const { runtime, InteractiveMode } = await createWorkspaceAgentRuntime({ client, isolationDirectory: isolated, ...frontend });
try {
  await new InteractiveMode(runtime, { startupDiagnostics: [{ type: 'info', message: 'Explicit synthetic Library-read PTY fixture · official Agent · zero live model calls' }] }).run();
} finally { await runtime.dispose(); }
