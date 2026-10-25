// Optional official-runtime acceptance, with synthetic data and no model call.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Library from '../index.js';

if (!process.env.DSH_RUNTIME_DIR) throw new Error('Set DSH_RUNTIME_DIR to the official DSH installation.');
const require = createRequire(join(resolve(process.env.DSH_RUNTIME_DIR), 'package.json'));
const native = name => import(require.resolve(`@deepseek-ai/${name}`));
const { Context } = await native('cordis');
const { default: SystemPrompt } = await native('dsh-system-prompt');
const { default: Tools } = await native('dsh-tools');
const { default: Attachments } = await native('dsh-attachment-local');
const root = await mkdtemp(join(tmpdir(), 'dsh-native-product-context-'));
const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(Tools);
  await ctx.plugin(Attachments, { dshHome: join(root, 'home') });
  await ctx.plugin(Library, { dataDir: join(root, 'library') });
  const service = ctx.workspaceLibrary;
  const doc = await service.addDocument({ title: 'Supply policy', fileName: 'policy.txt', data: Buffer.from('MOQ 370; 17 days after sample confirmation') });
  await service.addDocumentVersion(doc.id, { content: 'MOQ 940; 31 days after sample confirmation' });
  const product = await service.saveProduct({ name: 'Synthetic linen', documents: [{ documentId: doc.id, documentVersion: 1, purpose: 'Supply terms' }] });
  const run = (name, args, signal = new AbortController().signal) => ctx.tools.execute({ callId: 'product-context-acceptance', name, arguments: args, signal });
  const context = await run('workspace_library_product_context', { productId: product.id, expectedRevision: 1 });
  assert.equal(context.isError, false, JSON.stringify(context));
  const selected = context.value.documents[0];
  assert.equal(selected.isCurrentVersion, false);
  assert.equal(selected.contentRead, false);
  assert.equal(context.value.source.reviewState, 'unreviewed');
  assert.ok(context.value.gaps.some(gap => gap.code === 'MISSING_SKUS'));
  assert.equal(JSON.stringify(context.content).includes('MOQ 370'), false);
  const bytes = await run('workspace_library_references', { references: [selected.reference] });
  assert.equal(bytes.isError, false);
  assert.equal(bytes.value.items[0].content, 'MOQ 370; 17 days after sample confirmation');
  assert.equal(bytes.value.items[0].source.sha256, selected.sha256);
  await service.updateDocument(doc.id, { expectedRevision: 2, changes: { status: 'archived' } });
  const archived = await run('workspace_library_product_context', { productId: product.id });
  assert.equal(archived.value.documents[0].availability, 'archived');
  assert.equal((await run('workspace_library_references', { references: [selected.reference] })).isError, true);
  await service.saveProduct({ productId: product.id, expectedRevision: 1, changes: { description: 'new revision' } });
  assert.equal((await run('workspace_library_product_context', { productId: product.id, expectedRevision: 1 })).isError, true);
  assert.equal((await run('workspace_library_product_context', { productId: product.id }, AbortSignal.abort())).isError, true);
  console.log('OK: official ToolRuntime + attachments; product snapshot, exact historical bytes, gaps, archive rejection, revision guard and cancellation. No model calls.');
} finally {
  await ctx.fiber.dispose();
  await rm(root, { recursive: true, force: true });
}
