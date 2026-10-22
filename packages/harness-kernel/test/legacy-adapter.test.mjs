import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../src/app.mjs';
import { createLegacyInquiryRecovery, createLegacyServices, resolveService } from '../src/legacy-adapter.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')), '..', '..', '..');
const actor = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };

const envelope = inquiries => JSON.stringify({ schema: 'historical-inquiry.input.v1', synthetic: false, inquiries });
const row = (overrides = {}) => ({
  leadId: 'lead-legacy', sourceId: 'canton-2024', revision: 1,
  companyName: 'Legacy Trading LLC', companyUrl: 'https://legacy.example.com', contactEmail: 'buyer@legacy.example.com',
  customerName: 'Sam', productId: 'prod-1', product: 'Hydraulic cylinder', quantity: 500, unit: 'pcs',
  destination: 'US', lastContactAt: '2026-09-10', status: 'active',
  history: [{ id: 'm1', direction: 'inbound', sentAt: '2026-09-01', body: 'Please quote 500 pcs hydraulic cylinder.' }],
  facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'Please quote 500 pcs hydraulic cylinder', occurredAt: '2026-09-01' }],
  ...overrides,
});

async function boot(t, { services = ['storage', 'artifacts', 'approval', 'tools'] } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-adapter-'));
  const storage = path.join(directory, 'data').replace(/\\/gu, '/');
  const rows = services.map(id => {
    if (id === 'storage') return [`  - id: storage`, `    name: '@workspace-harness/seams/storage'`, `    config: { directory: '${storage}' }`];
    return [`  - id: ${id}`, `    name: '@workspace-harness/seams/${id}'`];
  }).flat();
  const file = path.join(directory, 'harness.yml');
  await fs.writeFile(file, [
    'version: 1', 'name: legacy-adapter', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:', ...rows, '',
  ].join('\n'), 'utf8');
  const harness = await createHarness({ compositionPath: file, root: ROOT });
  t.after(async () => { await harness.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return harness;
}

test('legacy services are the live harness services, not copies', async t => {
  const harness = await boot(t, { services: ['storage', 'artifacts', 'approval', 'tools'] });
  const services = createLegacyServices(harness);
  assert.equal(services.store, resolveService(harness, 'storage'));
  assert.equal(services.artifacts, resolveService(harness, 'artifacts'));
  assert.equal(services.approval, resolveService(harness, 'approval'));
  assert.equal(services.tools, resolveService(harness, 'tools'));
  assert.equal(services.audit, null, 'an unmounted optional seam is null, not an error');
  assert.equal(services.workspace, null);

  await services.store.update(state => { state.legacyProbe = { ok: true }; });
  assert.deepEqual(services.store.read().legacyProbe, { ok: true });
  assert.deepEqual(harness.ctx.reflect.get('storage', false).read().legacyProbe, { ok: true }, 'one durable store, no copy');
});

test('the real inquiry domain service runs unchanged on harness seams', async t => {
  const harness = await boot(t);
  const recovery = await createLegacyInquiryRecovery(harness, { staleDays: 7 });
  const imported = await recovery.importInquiries({ format: 'json', requestId: randomUUID(), content: envelope([row()]) }, actor);
  assert.equal(imported.inserted, 1);
  const status = recovery.status(actor);
  assert.equal(status.counts.leads, 1);
  assert.equal(status.counts.need_evidence, 1);
  const listing = recovery.opportunities({ asOfDate: '2026-10-21' }, actor);
  assert.equal(listing.cards.length, 1);
  assert.equal(listing.cards[0].leadId, 'lead-legacy');

  // The same data is visible through the harness storage seam.
  const state = harness.ctx.reflect.get('storage', false).read();
  assert.equal(state.inquiryRecovery.leads[0].leadId, 'lead-legacy');
});

test('the adapter also serves approvals and tools for legacy call paths', async t => {
  const harness = await boot(t);
  const services = createLegacyServices(harness);
  const ticket = await services.approval.request({ actor, tool: 'inquiry_recovery_select', args: { leadId: 'lead-legacy' }, reason: 'legacy path' });
  assert.equal(ticket.status, 'pending');
  const decided = await services.approval.decide(ticket.id, 'approve', actor);
  assert.equal(decided.status, 'approved');
  assert.ok(services.tools.register({
    name: 'legacy_probe', description: 'probe', parameters: { type: 'object', properties: {}, additionalProperties: false },
    approval: 'never', readOnly: true, handler: async () => ({ ok: true }),
  }));
  assert.deepEqual(await services.tools.execute('legacy_probe', {}, { actor }), { ok: true });
});

test('a composition without storage is refused instead of silently degrading', async t => {
  // `approval` has no dependencies, so it mounts without a storage seam.
  const harness = await boot(t, { services: ['approval'] });
  assert.throws(() => createLegacyServices(harness), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
  const optional = createLegacyServices(harness, { requireStorage: false });
  assert.equal(optional.store, null);
  assert.equal(optional.artifacts, null);
  assert.equal(optional.approval, resolveService(harness, 'approval'));
  await assert.rejects(createLegacyInquiryRecovery(harness), error => error.code === 'HARNESS_PLUGIN_MISSING_DEPENDENCY');
  assert.throws(() => createLegacyServices(null), TypeError);
});
