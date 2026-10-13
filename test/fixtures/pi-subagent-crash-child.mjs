// Official Pi execution and explicit public faux transport in disposable data.
// The parent kills this process only after a real durable checkpoint is flushed.
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { startPiDevelopment } from '../../server/pi-development.mjs';

const [directory, mode] = process.argv.slice(2);
let fixture;
const responses = [fauxAssistantMessage(fauxToolCall('workspace_delegate', { task: 'Explicit original child text' }, { id: 'original-delegate' }), { stopReason: 'toolUse' }),
  mode === 'pending-child' ? async (_request, options) => {
    const run = fixture.app.store.read().runs[0];
    process.stdout.write(JSON.stringify({ runId: run.id, nativeTaskId: run.piNativeTaskId, replyId: run.assistantId, conversationId: run.conversationId,
      requestId: run.piRequestId, childSessionId: options.sessionId, interruptedCeiling: options.maxTokens }) + '\n');
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    return fauxAssistantMessage('', { stopReason: 'aborted' });
  } : fauxAssistantMessage('Confirmed original child answer'),
  fauxAssistantMessage('Confirmed parent answer with original child receipt')];
fixture = await startPiDevelopment({ dataDirectory: directory, responses, seedApprovalConnector: false });
if (mode === 'cached-final') {
  const original = fixture.app.store.update.bind(fixture.app.store); let paused = false;
  fixture.app.store.update = async (...args) => {
    const result = await original(...args);
    const reply = fixture.app.store.read().messages.find(value => value.status === 'pending' && value.providerResultAccounted !== undefined);
    if (!paused && reply) {
      paused = true; const run = fixture.app.store.read().runs.find(value => value.id === reply.runId);
      process.stdout.write(JSON.stringify({ runId: run.id, nativeTaskId: run.piNativeTaskId, replyId: run.assistantId, conversationId: run.conversationId,
        requestId: run.piRequestId, outputTokens: run.outputTokens, usage: run.usage }) + '\n');
      return new Promise(() => {});
    }
    return result;
  };
}
const response = await fetch(fixture.baseURL + '/api/agent/v1/pi/tasks', { method: 'POST', headers: { authorization: 'Bearer ' + fixture.token, 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Original public child crash task', content: 'Explicit original parent text', requestId: 'original-child-crash', delegation: true }) });
if (response.status !== 201) throw new Error('Synthetic crash task was not admitted.');
setInterval(() => {}, 1000);
