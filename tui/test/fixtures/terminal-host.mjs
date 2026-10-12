// Disposable loopback fixture only. No production data or credentials loaded.
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import readline from 'node:readline';
import { openStore } from '../../../server/store.mjs';
import { createApp } from '../../../server/index.mjs';

const directory = await mkdtemp('/tmp/workspace-real-pi-terminal-');
const actor = { subject: 'local-operator', nativeAgentId: 'original:terminal-fixture' };
const original = await openStore(directory);
await original.update(state => state.conversations.push({ id: actor.nativeAgentId, ...actor, title: 'Terminal fixture', status: 'idle', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
await original.close();
const app = await createApp({ dataDirectory: directory,
  provider: { kind: 'fixture', configured: false, complete() { throw new Error('MODEL_EXECUTION_FORBIDDEN'); } },
  museWorkerConfig: { workerId: 'cf4a108c-8051-48bb-9bd2-b8e5a10a1db1', ownerId: 'fixture-muse', tokenDigest: createHash('sha256').update('disposable-offline-muse-protocol-fixture').digest('hex'), enabled: true, scopeReviewed: true, externalBudgetVerified: true },
  museOriginalBinding: { actor, operators: [actor], expectedHost: 'fixture.test' } });
const address = await app.listen(0);
console.log(JSON.stringify({ port: address.port, directory }));
const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  if (line === 'close') break;
  if (line !== 'state') throw new Error('FIXTURE_COMMAND_INVALID');
  const state = app.store.read();
  console.log(JSON.stringify({ orders: (state.workerOrders || []).map(row => ({ id: row.id, status: row.status, requestId: row.requestId })), tasks: state.museTasks || [], messages: state.messages.filter(row => row.role === 'assistant').map(row => ({ conversationId: row.conversationId, content: row.content })), modelRuns: state.runs.length }));
}
lines.close();
process.stdin.destroy();
await app.close();
await rm(directory, { recursive: true, force: true });
