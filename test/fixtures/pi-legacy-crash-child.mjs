// Construct a real pre-upgrade Harness submission checkpoint. This does not
// relabel a native Agent task, invoke a model account or grant tool permission.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Harness, createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createPiProvider } from '../../server/pi-provider.mjs';
import { createApp } from '../../server/index.mjs';

const [directory] = process.argv.slice(2);
const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
faux.setResponses([fauxAssistantMessage('Real legacy submission answer')]);
const provider = createPiProvider({ models, providerId: 'faux', model: 'faux-1' });
let app;
provider.complete = async ({ runId, replyId, conversationId, maxTokens, onEvent }) => {
  const location = path.join(directory, 'pi', createHash('sha256').update(conversationId).digest('hex'));
  await fs.mkdir(location, { recursive: true, mode: 0o700 });
  const storage = await openNodeJsonlStorage(location, context, { fsync: true });
  const harness = await Harness.open(storage, { models, registry: createRegistry(), settings: { retry: { enabled: false, maxRetries: 0 }, compaction: { enabled: false } } }, context);
  const root = await harness.root(context);
  const RecordDoc = defineDoc({ kind: 'workspace.pi-invocations', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ records: {}, active: null }) });
  const requestId = `${runId}:${replyId}`;
  const run = app.store.read().runs.find(value => value.id === runId);
  await root.configure({ model: { provider: 'faux', modelId: 'faux-1' }, instructions: 'Legacy checkpoint fixture' }, context);
  await root.commit(async tx => { (await tx.doc(RecordDoc, root.id)).active = { runId, replyId, conversationId, executionHash: run.executionHash, maxTokens,
    structured: false, museDraft: false, supplierDraft: false, agentPreset: false, snapshot: null, requestId, messages: [], requests: [{ maxTokens: 400, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cacheReadTokens: 0, cacheWriteTokens: 0 } }] }; }, context);
  const submission = await root.submit({ type: 'input', content: 'Original legacy input', requestId, whenBusy: 'reject' }, context);
  await root.commit(async tx => { (await tx.doc(RecordDoc, root.id)).records[requestId] = { submissionId: submission.id }; }, context);
  await onEvent({ type: 'pi.submission', piConversationId: root.id, piSubmissionId: submission.id, piRequestId: requestId });
  const settled = await submission.wait(context);
  if (settled.status !== 'done') throw new Error('Legacy fixture did not answer');
  await harness.close(context);
  process.stdout.write(JSON.stringify({ runId, replyId, conversationId, submissionId: submission.id }) + '\n');
  return new Promise(() => {});
};
app = await createApp({ dataDirectory: directory, provider });
const conversation = (await app.runtime.createConversation({})).conversation;
await app.runtime.sendMessage(conversation.id, { content: 'Original legacy request', requestId: 'legacy-native-upgrade-fixture' });
setInterval(() => {}, 1000);
