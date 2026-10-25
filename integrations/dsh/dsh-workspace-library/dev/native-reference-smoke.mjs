// Optional acceptance against an installed official DSH runtime. No model or user data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Library, { LibraryStore, createLibraryService } from '../index.js';

if (!process.env.DSH_RUNTIME_DIR) throw new Error('Set DSH_RUNTIME_DIR to the directory containing the official DSH node_modules.');
const require = createRequire(join(resolve(process.env.DSH_RUNTIME_DIR), 'package.json'));
const native = name => import(require.resolve(`@deepseek-ai/${name}`));
const { Context } = await native('cordis');
const { default: SystemPrompt } = await native('dsh-system-prompt');
const { default: Tools } = await native('dsh-tools');
const { default: Attachments } = await native('dsh-attachment-local');
const root = await mkdtemp(join(tmpdir(), 'dsh-native-reference-'));
const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(Tools);
  await ctx.plugin(Attachments, { dshHome: join(root, 'home') });
  const dir = join(root, 'library');
  await ctx.plugin(Library, { dataDir: dir });
  const service = createLibraryService(new LibraryStore({ dir }), { attachments: ctx.attachments });
  const doc = await service.addDocument({ title: 'Native acceptance', fileName: 'policy.csv', mimeType: 'text/csv', data: Buffer.from('SKU,MOQ\nA,300\n') });
  const pin = { documentId: doc.id, version: 1, sha256: doc.versions[0].sha256 };
  await service.addDocumentVersion(doc.id, { fileName: 'policy.csv', mimeType: 'text/csv', data: Buffer.from('SKU,MOQ\nA,900\n') });
  const run = (references, signal = new AbortController().signal) => ctx.tools.execute({
    callId: 'reference-acceptance', name: 'workspace_library_references', arguments: { references }, signal,
  });
  const result = await run([pin]);
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.value.items[0].content, 'SKU,MOQ\nA,300\n');
  assert.equal(result.value.items[0].source.currentVersion, 2);
  assert.equal(result.value.items[0].source.sha256, pin.sha256);
  assert.match(result.content[0].text, /300/u);
  assert.equal((await run([{ ...pin, sha256: '0'.repeat(64) }])).isError, true);
  assert.equal((await run([pin], AbortSignal.abort())).isError, true);
  console.log('OK: official Cordis + ToolRuntime + LocalAttachmentStore; old bytes/SHA, rendered result, mismatch and cancellation; zero model calls.');
} finally {
  await ctx.fiber.dispose();
  await rm(root, { recursive: true, force: true });
}
