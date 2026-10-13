// Disposable process-crash fixture. No real credentials, model or production.
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createPiProvider } from '../../server/pi-provider.mjs';
import { createApp } from '../../server/index.mjs';
const [directory, mode] = process.argv.slice(2);
const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
faux.setResponses([mode !== 'pending' ? fauxAssistantMessage('Durably cached crash fixture answer') : async (_request, options) => {
  await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
  return fauxAssistantMessage('', { stopReason: 'aborted' });
}]);
const provider = createPiProvider({ models, providerId: 'faux', model: 'faux-1' });
const complete = provider.complete.bind(provider);
let cached = false, cachedNativeTaskId;
if (mode !== 'pending') provider.complete = async options => { const result = await complete(mode === 'metadata-gap' ? { ...options, onEvent: undefined } : options); cachedNativeTaskId = result.runtime.nativeTaskId; cached = true; return new Promise(() => {}); };
const app = await createApp({ dataDirectory: directory, provider });
const conversation = (await app.runtime.createConversation({})).conversation;
const sent = await app.runtime.sendMessage(conversation.id, { content: 'Crash recovery fixture', requestId: 'same-original-crash-request' });
const timer = setInterval(() => {
  const run = app.runtime.getRun(sent.run.id).run;
  if ((run.piNativeTaskId || mode === 'metadata-gap' && cached) && faux.state.callCount === 1 && (mode === 'pending' || cached)) {
    clearInterval(timer);
    process.stdout.write(JSON.stringify({ runId: run.id, nativeTaskId: run.piNativeTaskId || cachedNativeTaskId, conversationId: conversation.id }) + '\n');
    setInterval(() => {}, 1000); // Parent kills this disposable process without close.
  }
}, 5);
