// Optional: installed official Cordis, Tools and durable StorageDomain/JSON. No model call.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Memory from '../index.js';
import Library from '../../dsh-workspace-library/index.js';
import Inquiry from '../../dsh-inquiry-recovery/index.js';
import { row, toCsv } from '../../dsh-inquiry-recovery/dev/fixture.mjs';

if (!process.env.DSH_RUNTIME_DIR) throw new Error('Set DSH_RUNTIME_DIR to the official runtime directory.');
const require = createRequire(join(resolve(process.env.DSH_RUNTIME_DIR), 'package.json'));
const load = name => import(require.resolve(`@deepseek-ai/${name}`));
const { Context } = await load('cordis');
const { default: SystemPrompt } = await load('dsh-system-prompt');
const { default: Tools } = await load('dsh-tools');
const { default: Storage } = await load('dsh-storage');
const { default: Attachments } = await load('dsh-attachment-local');
const StorageJSON = await load('dsh-storage-json');
const StorageDomain = await load('dsh-storage-domain');
const root = await mkdtemp(join(tmpdir(), 'native-business-memory-'));
const workspace = { id: randomUUID(), title: 'Native fixture', sessionIds: ['session-native-memory'] };
async function boot() {
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(Tools);
    await ctx.plugin(Storage);
    await ctx.plugin(StorageJSON, { root });
    await ctx.plugin(StorageDomain, { backend: 'json' });
    await ctx.plugin(Attachments, { dshHome: join(root, 'home') });
    await ctx.plugin(Library, { dataDir: join(root, 'library') });
    await ctx.plugin({ apply(scope) { scope.provide('workspaceRegistry', { get: id => id === workspace.id ? workspace : undefined, list: () => [workspace] }); } });
    await ctx.plugin(Memory);
    await ctx.plugin(Inquiry);
    return ctx;
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
let ctx;
try {
  ctx = await boot();
  const agent = { session: { id: workspace.sessionIds[0] } };
  const execute = (name, args) => ctx.tools.execute({ name, arguments: args, agent, callId: 'native-memory-1', signal: new AbortController().signal });
  const candidate = await execute('business_memory_propose', { requestId: randomUUID(), subjectType: 'company', subjectId: 'company', factKey: 'moq', statement: 'Demo MOQ is 300.' });
  assert.equal(candidate.isError, false, JSON.stringify(candidate));
  assert.equal(candidate.value.record.status, 'proposed');
  const memory = ctx.get('workspaceMemory');
  const before = await execute('business_memory_recall', {});
  assert.equal(before.isError, false, JSON.stringify(before));
  assert.equal(before.value.items.length, 0);
  await memory.review(workspace.id, candidate.value.record.id, { requestId: randomUUID(), expectedRevision: 1, decision: 'approve' });
  const recalled = await execute('business_memory_recall', {});
  assert.equal(recalled.value.items[0].statement, 'Demo MOQ is 300.');
  assert.match(recalled.content[0].text, /300/u);
  const library = ctx.get('workspaceLibrary');
  const doc = await library.addDocument({ title: 'Native source fixture', fileName: 'lead-time.csv', data: Buffer.from('days\n20\n') });
  const source = { kind: 'document', documentId: doc.id, version: 1, sha256: doc.versions[0].sha256 };
  const sourced = await execute('business_memory_propose', { requestId: randomUUID(), subjectType: 'company', subjectId: 'company', factKey: 'lead-time', statement: 'Demo lead time is 20 days.', source });
  assert.equal(sourced.isError, false, JSON.stringify(sourced));
  await memory.review(workspace.id, sourced.value.record.id, { requestId: randomUUID(), expectedRevision: 3, decision: 'approve' });
  await library.addDocumentVersion(doc.id, { fileName: 'lead-time.csv', data: Buffer.from('days\n40\n') });
  const oldPin = await execute('business_memory_recall', {});
  assert.equal(oldPin.isError, false, JSON.stringify(oldPin));
  assert.equal(oldPin.value.items.find(item => item.id === sourced.value.record.id).source.sha256, source.sha256);
  await library.updateDocument(doc.id, { expectedRevision: 2, changes: { status: 'archived' } });
  const archived = await execute('business_memory_recall', {});
  assert.equal(archived.value.items.some(item => item.id === sourced.value.record.id), false);
  assert.equal(archived.value.excluded[0].code, 'REFERENCE_ARCHIVED');
  await library.saveProduct({ name: 'Demo linen' });
  const discoveryDoc = await library.addDocument({ title: 'Demo policy', content: 'Original policy must not enter discovery.' });
  const inquiry = ctx.get('inquiryRecovery');
  await inquiry.import(workspace.id, { requestId: randomUUID(), sourceName: 'demo.csv', format: 'csv', authorized: true,
    dataBase64: Buffer.from(toCsv([row({ companyName: 'Demo buyer' })])).toString('base64') });
  const found = await execute('workspace_context_search', { q: 'Demo' });
  assert.equal(found.isError, false, JSON.stringify(found));
  assert.equal(found.value.discoveryOnly, true);
  assert.ok(found.value.groups.every(group => group.status === 'available'));
  assert.equal(found.value.groups.find(group => group.name === 'memory').items.length, 1);
  const hit = found.value.groups.find(group => group.name === 'library').items.find(item => item.id === discoveryDoc.id);
  assert.equal(hit.reader.arguments.references[0].sha256, discoveryDoc.versions[0].sha256);
  assert.equal(JSON.stringify(found.value).includes('Original policy must not enter'), false);
  const inquiryHit = found.value.groups.find(group => group.name === 'inquiries').items[0];
  const opened = await execute(inquiryHit.reader.name, inquiryHit.reader.arguments);
  assert.equal(opened.value.source.rawBytesVerified, true);
  const docRead = await execute(hit.reader.name, hit.reader.arguments);
  assert.equal(docRead.value.items[0].content, 'Original policy must not enter discovery.');
  await ctx.fiber.dispose(); ctx = undefined;
  ctx = await boot();
  const reopened = await ctx.get('workspaceMemory').read(workspace.id, candidate.value.record.id);
  assert.equal(reopened.record.status, 'active');
  assert.equal(reopened.record.history.length, 2);
  assert.equal(ctx.tools.get('business_memory_review'), undefined);
  console.log('OK: official ToolRuntime + StorageDomain/JSON + attachments; scoped discovery across library, approved memory and inquiries, reader round trips, source exclusions and restart persistence. Agent identity is a fixture; no model calls.');
} finally { await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
