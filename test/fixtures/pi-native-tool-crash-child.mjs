// Real Pi packages, faux transport, disposable directory; parent uses SIGKILL.
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createPiProvider } from '../../server/pi-provider.mjs';
import { createApp } from '../../server/index.mjs';

const [directory] = process.argv.slice(2);
const faux = fauxProvider({ api: 'faux' }), models = createModels(); models.setProvider(faux.provider);
const app = await createApp({ dataDirectory: directory, provider: createPiProvider({ models, providerId: 'faux', model: 'faux-1' }) });
const artifact = (await app.artifacts.create({ filename: 'crash-selected.txt', content: 'Original selected crash bytes', mimeType: 'text/plain' })).artifact;
const conversation = (await app.runtime.createConversation({})).conversation;
let sent;
faux.setResponses([
  fauxAssistantMessage(fauxToolCall('workspace_input', { kind: 'artifact', id: artifact.id }, { id: 'original-selected-read-call' }), { stopReason: 'toolUse' }),
  async (request, options) => {
    const selected = JSON.parse(request.messages.at(-1).content[0].text);
    const run = app.runtime.getRun(sent.run.id).run;
    process.stdout.write(JSON.stringify({ runId: run.id, nativeTaskId: run.piNativeTaskId, replyId: run.assistantId, conversationId: conversation.id,
      requestId: run.piRequestId, selected, sessionId: options.sessionId, interruptedCeiling: options.maxTokens }) + '\n');
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  },
]);
sent = await app.runtime.sendMessage(conversation.id, { content: 'Read only original selected bytes', requestId: 'original-native-tool-crash',
  workspaceExecution: true, inputContext: { artifacts: [{ id: artifact.id, version: artifact.currentVersion }], skills: [], memoryIds: [], connectorActions: [] } });
setInterval(() => {}, 1000);
