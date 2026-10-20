import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';

const row = (overrides = {}) => ({
  leadId: 'lead-alpha', sourceId: 'canton-fair-2024', revision: 1,
  companyName: 'Alpha Trading LLC', companyUrl: 'https://alpha.example.com', contactEmail: 'buyer@alpha.example.com',
  customerName: 'Sam', productId: 'prod-1', product: 'Hydraulic cylinder', quantity: 500, unit: 'pcs',
  lastContactAt: '2026-09-10', status: 'active',
  history: [{ id: 'm1', direction: 'inbound', sentAt: '2026-09-01', body: 'Please quote 500 pcs hydraulic cylinder.' }],
  facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'Please quote 500 pcs hydraulic cylinder', occurredAt: '2026-09-01' }],
  ...overrides,
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'workspace-inquiry-http-'));
  const options = {
    dataDirectory: directory,
    provider: { kind: 'test-provider', configured: false, complete: async () => { throw Error('Model must not be called'); } },
    capabilityEnvironment: {},
  };
  let app = await createApp(options), address = await app.listen(0);
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const restart = async () => { await app.close(); app = await createApp(options); address = await app.listen(0); };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { request, restart, get app() { return app; } };
}

const envelope = inquiries => JSON.stringify({ schema: 'historical-inquiry.input.v1', synthetic: false, inquiries });

test('historical inquiry recovery is reachable through the real application HTTP surface', async t => {
  const f = await fixture(t);

  const empty = await f.request('/api/inquiry-recovery/status');
  assert.equal(empty.status, 200, JSON.stringify(empty.body));
  assert.equal(empty.body.counts.leads, 0);

  const imported = await f.request('/api/inquiry-recovery/import', 'POST', {
    format: 'json', requestId: randomUUID(), sourceName: 'canton-2024.csv', content: envelope([row()]),
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.inserted, 1);

  const listed = await f.request('/api/inquiry-recovery/opportunities?asOf=2026-10-21');
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const card = listed.body.cards.find(item => item.leadId === 'lead-alpha');
  assert.equal(card.decision, 'need_evidence');
  assert.deepEqual(card.reasons, ['IDENTITY_UNCONFIRMED']);

  const reviewed = await f.request('/api/inquiry-recovery/leads/lead-alpha/identity', 'POST', {
    requestId: randomUUID(), sourceHash: card.sourceHash, status: 'confirmed',
    basis: [{ sourceId: 'canton-fair-2024', quote: 'Please quote 500 pcs hydraulic cylinder', officialUrl: 'https://alpha.example.com' }],
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));

  const ready = await f.request('/api/inquiry-recovery/opportunities?asOf=2026-10-21');
  const stale = ready.body.cards.find(item => item.leadId === 'lead-alpha');
  assert.equal(stale.decision, 'follow_up');
  assert.equal(stale.daysStale, 41);

  const selected = await f.request('/api/inquiry-recovery/leads/lead-alpha/select', 'POST', {
    requestId: randomUUID(), expectedRevision: stale.revision, sourceHash: stale.sourceHash, asOf: '2026-10-21',
  });
  assert.equal(selected.status, 201, JSON.stringify(selected.body));
  assert.equal(selected.body.draft.sent, false);
  assert.equal(selected.body.goalDraft.enabled, false);
  assert.equal(selected.body.goalDraft.notWritten, true);
  assert.ok(selected.body.artifact?.artifactId, 'the draft must be a real artifact');
  const artifacts = await f.request('/api/artifacts');
  assert.ok(artifacts.body.artifacts.some(item => item.id === selected.body.artifact.artifactId));

  await f.restart();
  const restored = await f.request('/api/inquiry-recovery/opportunities?asOf=2026-10-21');
  assert.equal(restored.status, 200);
  assert.equal(restored.body.cards.length, 1);
  const selections = await f.request('/api/inquiry-recovery/selections');
  assert.equal(selections.body.selections.length, 1);
  assert.equal(selections.body.selections[0].leadId, 'lead-alpha');
  assert.equal(selections.body.selections[0].artifact.artifactId, selected.body.artifact.artifactId);
});

test('the recovery HTTP surface refuses malformed imports and unknown routes without touching data', async t => {
  const f = await fixture(t);
  const bad = await f.request('/api/inquiry-recovery/import', 'POST', { format: 'json', requestId: randomUUID(), content: '{"schema":"wrong"}' });
  assert.equal(bad.status, 400);
  const rejected = await f.request('/api/inquiry-recovery/import', 'POST', {
    format: 'json', requestId: randomUUID(),
    content: envelope([row({ facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'not in history', occurredAt: null }] })]),
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, 'INQUIRY_IMPORT_REJECTED');
  assert.equal(rejected.body.error.rejected[0].row, 1);
  assert.equal(rejected.body.error.rejected[0].code, 'INQUIRY_FACT_UNSUPPORTED');
  const missingRequest = await f.request('/api/inquiry-recovery/import', 'POST', { format: 'json', content: envelope([row()]) });
  assert.equal(missingRequest.status, 400);
  const notFound = await f.request('/api/inquiry-recovery/leads/nope');
  assert.equal(notFound.status, 404);
  const unknown = await f.request('/api/inquiry-recovery/unknown');
  assert.equal(unknown.status, 404);
  const status = await f.request('/api/inquiry-recovery/status');
  assert.equal(status.body.counts.leads, 0);
});
