import { createWorkspaceClient, registerWorkspaceBusinessTools } from './workspace.mjs';
import { registerWorkspaceReadTools } from './workspace-read.mjs';
import { registerProcurementTools, PROCUREMENT_GUIDANCE } from './procurement.mjs';

export const ORDINARY_PROCUREMENT_TOOLS = Object.freeze(['workspace_business_presets', 'workspace_business_task', 'workspace_business_status',
  'workspace_business_tasks', 'workspace_business_result', 'workspace_procurement_capabilities', 'workspace_procurement_requirements', 'workspace_procurement_compare']);

// No credential creation, login or new persistence. The host supplies an
// EXISTING original member Bearer binding in memory; absence stays unconfigured.
function existingBinding(env) {
  let configuration = 'unconfigured', client;
  if (env.WS_AGENT_URL && env.WS_AGENT_TOKEN) {
    try { client = createWorkspaceClient({ baseURL: env.WS_AGENT_URL, token: env.WS_AGENT_TOKEN }); configuration = 'configured_unverified'; }
    catch { configuration = 'invalid_configuration'; }
  }
  const gap = async () => ({ plugin: 'workspace-procurement', status: 'unconfigured', reason: configuration === 'invalid_configuration'
    ? 'EXISTING_WORKSPACE_BINDING_INVALID' : 'EXISTING_WORKSPACE_BINDING_REQUIRED', sources: [],
    detail: 'Use an existing authorized original Workspace HTTP binding. No service, model, sample, task or credential was created.' });
  return { configuration, client: client || Object.freeze({ businessPresets: gap, businessSubmit: gap, businessStatus: gap, businessTasks: gap, businessResult: gap }) };
}

export function procurementExtension({ client, configuration = 'configured_unverified' }) {
  return pi => {
    registerWorkspaceBusinessTools(pi, client);
    registerWorkspaceReadTools(pi, client, { library: false });
    registerProcurementTools(pi, client, configuration);
    // Append instructions through the official hook. Leave the ordinary host's
    // tools, commands, terminal, model and session operations untouched.
    pi.on('before_agent_start', event => ({ systemPrompt: event.systemPrompt + '\n\n' + PROCUREMENT_GUIDANCE }));
  };
}

// Official Pi package/extension entry. Controlled workspaceExtension is a
// separate explicit host choice, exported by ./client using the SAME tools.
export default function extension(pi) {
  return procurementExtension(existingBinding(process.env))(pi);
}
