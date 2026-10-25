import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Inquiry from '../index.js';
import { row, toCsv } from './fixture.mjs';

if (!process.env.DSH_RUNTIME_DIR) throw new Error('Set DSH_RUNTIME_DIR to the official runtime directory.');
const require = createRequire(join(resolve(process.env.DSH_RUNTIME_DIR), 'package.json'));
const load = name => import(require.resolve(`@deepseek-ai/${name}`));
const { Context } = await load('cordis');
const { default: SystemPrompt } = await load('dsh-system-prompt');
const { default: Tools } = await load('dsh-tools');
const { default: Storage } = await load('dsh-storage');
const { default: Attachments } = await load('dsh-attachment-local');
const StorageJSON = await load('dsh-storage-json'), StorageDomain = await load('dsh-storage-domain');
const root = await mkdtemp(join(tmpdir(), 'native-inquiry-recovery-'));
const workspace = { id: randomUUID(), title: 'Native fixture', sessionIds: ['session-native-inquiry'] };
async function boot() {
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools); await ctx.plugin(Storage);
    await ctx.plugin(StorageJSON, { root }); await ctx.plugin(StorageDomain, { backend: 'json' });
    await ctx.plugin(Attachments, { dshHome: join(root, 'home') });
    await ctx.plugin({ apply(scope) { scope.provide('workspaceRegistry', { get: id => id === workspace.id ? workspace : undefined, list: () => [workspace] }); } });
    await ctx.plugin(Inquiry); return ctx;
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
let ctx;
try {
  ctx = await boot();
  let service = ctx.get('inquiryRecovery');
  const source = toCsv([row()]);
  await service.import(workspace.id, { requestId: randomUUID(), sourceName: 'synthetic-inquiries.csv', format: 'csv', authorized: true, dataBase64: Buffer.from(source).toString('base64') });
  const execute = (name, args) => ctx.tools.execute({ name, arguments: args, agent: { session: { id: workspace.sessionIds[0] } }, callId: 'native-inquiry-call', signal: new AbortController().signal });
  let read = await execute('inquiry_recovery_read', { action: 'read', leadId: 'linen-buyer' });
  assert.equal(read.isError, false, JSON.stringify(read)); assert.equal(read.value.source.rawBytesVerified, true);
  const command = { requestId: randomUUID(), leadId: 'linen-buyer', expectedRevision: 1, sourceHash: read.value.card.sourceHash, content: 'Sam, is the linen project you mentioned in m1 still being evaluated? Unsent synthetic draft.' };
  assert.equal((await execute('inquiry_recovery_propose_draft', command)).isError, true);
  await service.review(workspace.id, 'linen-buyer', { requestId: randomUUID(), sourceHash: command.sourceHash, expectedReviewRevision: 0, status: 'confirmed', basis: [{ sourceId: 'synthetic-operator', quote: 'Operator fixture identity check' }] });
  const draft = await execute('inquiry_recovery_propose_draft', command);
  assert.equal(draft.isError, false, JSON.stringify(draft)); assert.equal(draft.value.draft.sent, false);
  assert.equal(draft.value.attachmentBytesVerified, true); assert.equal(draft.value.nativeOrigin.sessionId, workspace.sessionIds[0]);
  const file = await service.draftFile(workspace.id, draft.value.id); assert.equal(file.data.toString(), command.content);
  await service.reviewDraft(workspace.id, draft.value.id, { requestId: randomUUID(), expectedReviewRevision: 0, draftSha256: draft.value.draft.sha256, sourceHash: command.sourceHash, decision: 'approved', note: 'Operator reviewed synthetic content.' });
  await ctx.fiber.dispose(); ctx = await boot(); service = ctx.get('inquiryRecovery');
  assert.equal(service.drafts(workspace.id).items[0].id, draft.value.id);
  assert.equal(service.drafts(workspace.id).items[0].contentReview.state, 'approved');
  await service.import(workspace.id, { requestId: randomUUID(), sourceName: 'updated.csv', format: 'csv', authorized: true, dataBase64: Buffer.from(toCsv([row({ revision: 2, status: 'opted_out' })])).toString('base64') });
  read = await execute('inquiry_recovery_read', { action: 'read', leadId: 'linen-buyer' });
  assert.equal(read.value.card.decision, 'hold'); assert.equal(read.value.identity.status, 'unknown');
  assert.equal((await execute('inquiry_recovery_propose_draft', command)).isError, true);
  assert.equal(service.drafts(workspace.id).items[0].sourceRevisionMatches, false);
  assert.equal(service.drafts(workspace.id).items[0].contentReview.state, 'stale');
  assert.equal(ctx.tools.get('inquiry_recovery_send'), undefined); assert.equal(ctx.tools.get('inquiry_recovery_review'), undefined);
  console.log('OK: official ToolRuntime + StorageDomain/JSON + native attachments; source bytes, operator review, proposed text, unsent draft, restart and updated opt-out. Fixture Agent identity; no model calls.');
} finally { await ctx?.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
