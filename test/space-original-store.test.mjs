import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../server/store.mjs';
import { createSpaceService } from '../server/space-core.mjs';

// Requires the FULL original checkout and its pinned dependencies. No substitute
// Store import, native-lock bypass, skipped test or external model is used here.
// Only enterprise identities are explicit fixtures: this is not signed-Host proof.
test('original Store saves, closes, cold-opens and preserves original Library', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'space-original-store-'));
  let store;
  const actor = { subject: 'space-acceptance-owner', role: 'admin', session: { id: 'fixture-session' } };
  const members = new Map([[actor.subject, actor.role]]);
  const access = { nativeSessionById: id => id === actor.session.id ? { id, subject: actor.subject, role: actor.role, workspaceId: 'space-acceptance', expiresAt: Date.now() + 60000 } : null };
  const bind = store => createSpaceService({ store, access, members, workspaceId: 'space-acceptance', enabled: true });
  try {
    store = await openStore(directory); const originalLibrary = structuredClone(store.read().businessLibrary);
    const service = bind(store);
    const created = await service.create(actor, { requestId: randomUUID(), name: '验收 Space' });
    const spaceId = created.body.operation.receipt.entityId;
    const page = await service.createNode(actor, spaceId, { requestId: randomUUID(), kind: 'page', parentId: null, title: '验收页面', content: '真实原 Store 持久保存。' });
    const pageId = page.body.operation.receipt.entityId;
    assert.deepEqual(store.read().businessLibrary, originalLibrary);
    await store.close(); store = await openStore(directory);
    const restored = bind(store).page(actor, spaceId, pageId); restored.assertCurrent();
    assert.equal(restored.body.page.selected.content, '真实原 Store 持久保存。');
    assert.deepEqual(store.read().businessLibrary, originalLibrary);
    assert.equal(store.diagnostics().durability, 'confirmed');
  } finally { await store?.close(); await rm(directory, { recursive: true, force: true }); }
});
