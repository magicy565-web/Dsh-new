// Explicit public synthetic development fixture, never a production credential
// or model account. The original local-operator identity and original Store,
// Runtime, approval bridge and Pi tasks execute unchanged.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createApp } from './index.mjs';
import { createPiProvider } from './pi-provider.mjs';

export const PI_DEVELOPMENT_TOKEN = 'workspace-pi-public-synthetic-fixture';
const textOf = message => typeof message?.content === 'string' ? message.content
  : (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');

export async function startPiDevelopment({ dataDirectory, responses, seedApprovalConnector = true, port = 0, timeoutMs = 60_000 } = {}) {
  const temporary = !dataDirectory;
  const directory = dataDirectory || await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-pi-development-'));
  const faux = fauxProvider({ api: 'faux' }), models = createModels(); models.setProvider(faux.provider);
  let app, connector;
  const respond = async (request, options) => {
    const last = request.messages.at(-1), input = textOf(last);
    const system = request.messages.filter(message => message.role === 'system');
    const available = system.flatMap(message => message.toolsAdded || []).map(tool => tool.name);
    if (last?.role === 'toolResult') {
      return fauxAssistantMessage('Controlled faux result; actual original tool receipt:\n' + input);
    }
    if (system.some(message => message.sections?.instructions?.includes('Answer only the explicitly delegated text task.'))) {
      return fauxAssistantMessage('Controlled faux child result from explicit public text: ' + input);
    }
    const admitted = request.messages.filter(message => message.role === 'user').map(textOf).join('\n');
    const receiptMessage = request.messages.find(message => message.role === 'user' && textOf(message).startsWith('Verified application connector receipt ('));
    if (receiptMessage) {
      let receipt;
      try { receipt = JSON.parse(textOf(receiptMessage).split('\n').slice(1).join('\n')).receipt; } catch { /* Only confirmed original receipts finish this fixture. */ }
      const confirmed = app.capabilities.listConnectorRuns().find(value => value.id === receipt?.id && value.status === 'succeeded');
      if (confirmed) return fauxAssistantMessage('Controlled faux continuation; actual approved original connector receipt:\n' + JSON.stringify(confirmed));
    }
    if (admitted.includes('WAIT_FOR_CANCEL')) {
      await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }); });
      return fauxAssistantMessage('', { stopReason: 'aborted' });
    }
    if (available.includes('workspace_delegate')) {
      return fauxAssistantMessage(fauxToolCall('workspace_delegate', { task: admitted.slice(-4000) }), { stopReason: 'toolUse' });
    }
    if (admitted.includes('LOCAL_APPROVAL_FIXTURE') && connector) {
      return fauxAssistantMessage(fauxToolCall('workspace_propose_action', { content: 'Review this exact synthetic local file. No action has run.',
        connectorId: connector.id, action: 'create_file', resource: 'library:new', payload: { filename: 'pi-tui-approved-synthetic.txt', content: 'Explicit synthetic approved output.' } }), { stopReason: 'toolUse' });
    }
    return fauxAssistantMessage('Controlled faux result from explicit public text: ' + admitted.slice(-4000));
  };
  // Hard finite fixture plan; it cannot silently fall through to a real model.
  faux.setResponses(responses || Array.from({ length: 128 }, () => respond));
  try {
    app = await createApp({ dataDirectory: directory, capabilityEnvironment: {},
      provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1', timeoutMs }),
      agentConfig: { env: {}, principals: [{ subject: 'local-operator', workspaceId: 'local',
        tokenSha256: createHash('sha256').update(PI_DEVELOPMENT_TOKEN).digest('hex'), scopes: ['agent:read', 'agent:submit'] }] } });
    if (seedApprovalConnector) {
      connector = app.capabilities.listConnectors().find(value => value.name === 'Public synthetic Pi TUI local file');
      if (!connector) connector = (await app.capabilities.createConnector({ name: 'Public synthetic Pi TUI local file', adapter: 'workspace-library', capabilities: ['create_file'] })).connector;
      if (!connector.enabled) connector = (await app.capabilities.updateConnector(connector.id, { enabled: true })).connector;
    }
    const address = await app.listen(port);
    let closed = false;
    return { app, faux, directory, baseURL: `http://127.0.0.1:${address.port}`, token: PI_DEVELOPMENT_TOKEN,
      approvalConnectorId: connector?.id || null, transport: 'public-synthetic-controlled-faux',
      async close() { if (closed) return; closed = true; await app.close(); if (temporary) await fs.rm(directory, { recursive: true, force: true }); } };
  } catch (error) { await app?.close(); if (temporary) await fs.rm(directory, { recursive: true, force: true }); throw error; }
}
