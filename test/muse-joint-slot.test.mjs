import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../server/store.mjs';
import { createDotWorkerBridge } from '../server/dot-worker-bridge.mjs';
import { assertMuseNativeSlot } from '../server/muse-worker-slot.mjs';

// Original registry record shape from PR24's verified contract. Its unavailable
// original register/admit implementation is not replaced or claimed as executed.
test('actual Store refuses REST admission while a native logical Worker is unfinished, including expiry/reopen', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-joint-slot-'));
  let store = await openStore(directory);
  t.after(async () => { await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const workerId = randomUUID();
  await store.update(state => { state.personalWorkers = { workers: [{ id: workerId, subject: 'original-publisher', connections: [{ provider: 'muse', transport: 'muse-native', agentId: 'original-agent' }] }], delegations: [{ id: 'original-job', workerId, state: 'queued', deadlineAt: Date.now() - 1 }] }; });
  const artifacts = { create() { assert.fail('No file execution.'); }, download() { assert.fail('No file read.'); } };
  const bridge = () => createDotWorkerBridge({ store, artifacts, workerId, ownerId: 'original-owner', agentKind: 'muse', enabled: true, scopeReviewed: true, externalBudgetVerified: true });
  const input = { orderId: 'original-rest-order', idempotencyKey: 'original-rest-order', serviceId: 'channel-validation', inputs: { product: 'Public fixture', market: 'US', objective: 'No execution.' }, acceptance: [], deadlineAt: new Date(Date.now() + 3600000).toISOString(), maxCredits: 1, dataScope: 'public' };
  const before = store.read();
  await assert.rejects(bridge().adapter.submit(input), { code: 'MW_NATIVE_SLOT_BUSY' });
  assert.deepEqual(store.read(), before);
  await store.close(); store = await openStore(directory);
  await assert.rejects(bridge().adapter.submit(input), { code: 'MW_NATIVE_SLOT_BUSY' });
  await store.update(state => { state.personalWorkers.delegations[0].state = 'succeeded'; });
  await bridge().adapter.submit(input);
  assert.throws(() => assertMuseNativeSlot(store.read(), workerId), { code: 'MW_REST_SLOT_BUSY' });
  const reserved = store.read();
  await assert.rejects(store.update(state => { state.personalWorkers.delegations[0].state = 'uncertain'; }), { code: 'MW_JOINT_SLOT_CONFLICT' });
  assert.deepEqual(store.read(), reserved);
  await bridge().adapter.cancel(input.orderId);
  assert.doesNotThrow(() => assertMuseNativeSlot(store.read(), workerId));
});
