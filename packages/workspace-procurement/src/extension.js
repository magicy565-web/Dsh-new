import { createWorkspaceClient } from './workspace.mjs';
import { registerWorkspaceReadTools } from './workspace-read.mjs';
import { registerFactoryTools, FACTORY_GUIDANCE } from './factory.mjs';

export const ORDINARY_FACTORY_TOOLS = Object.freeze(['workspace_business_tasks', 'workspace_business_result',
  'workspace_factory_capabilities', 'workspace_factory_rfq_requirements', 'workspace_factory_match_prepare']);
// Name retained for existing consumers; its value is the corrected default set.
export const ORDINARY_PROCUREMENT_TOOLS = ORDINARY_FACTORY_TOOLS;

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

export function factoryExtension({ client, configuration = 'configured_unverified' }) {
  return pi => {
    registerWorkspaceReadTools(pi, client, { library: false });
    registerFactoryTools(pi, client, configuration);
    // Append instructions through the official hook. Leave the ordinary host's
    // tools, commands, terminal, model and session operations untouched.
    pi.on('before_agent_start', event => ({ systemPrompt: event.systemPrompt + '\n\n' + FACTORY_GUIDANCE }));
  };
}
export const procurementExtension = factoryExtension;

// Official Pi package/extension entry. Controlled workspaceExtension is a
// separate explicit host choice, exported by ./client using the SAME tools.
export default function extension(pi) {
  return factoryExtension(existingBinding(process.env))(pi);
}
