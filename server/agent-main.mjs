import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, startWorkspaceServer } from './index.mjs';
import { createPiProvider } from './pi-provider.mjs';
import { accessConfigFromEnvironment } from './access.mjs';
import { createBraveResearchAdapter } from './agent/research.mjs';

/** Backwards-compatible launcher name; starts the same unified Workspace app. */
export async function startAgentServer({ env = process.env, dataDirectory, provider, access, agentConfig = {}, ...options } = {}) {
  const port = Number(env.WS_AGENT_PORT || env.PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Agent port must be 0–65535.');
  const app = await createApp({ ...options,
    dataDirectory: dataDirectory || env.WORKSPACE_DATA_DIR,
    provider: provider || createPiProvider({ apiKey: env.FASTAITOKEN_API_KEY || '', model: env.PI_MODEL || env.FASTAITOKEN_MODEL || 'gpt-6-sol',
      baseUrl: env.PI_BASE_URL || 'https://www.fastaitoken.com/v1', researchAdapter: createBraveResearchAdapter({ environment: env }) }),
    access: access || await accessConfigFromEnvironment(env), capabilityEnvironment: env,
    agentConfig: { ...agentConfig, env: { ...env, WS_AGENT_ENABLED: '1' } } });
  try {
    const address = await app.listen(port, env.WS_AGENT_HOST || '127.0.0.1');
    return { ...app, service: app.builtinAgent, address };
  } catch (error) { await app.close(); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.env.WS_AGENT_ENABLED ??= '1';
  if (process.env.WS_AGENT_PORT && !process.env.PORT) process.env.PORT = process.env.WS_AGENT_PORT;
  startWorkspaceServer().catch(() => { console.error('Workspace startup failed; inspect host configuration and durable storage.'); process.exitCode = 1; });
}
