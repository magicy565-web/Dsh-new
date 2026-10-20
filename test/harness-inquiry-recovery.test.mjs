import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';
import { createEchoProvider } from '../packages/harness-seams/src/llm.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'));
const actor = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };

const row = (overrides = {}) => ({
  leadId: 'lead-alpha', sourceId: 'canton-2024', revision: 1,
  companyName: 'Alpha Trading LLC', companyUrl: 'https://alpha.example.com', contactEmail: 'buyer@alpha.example.com',
  customerName: 'Sam', productId: 'prod-1', product: 'Hydraulic cylinder', quantity: 500, unit: 'pcs',
  lastContactAt: '2026-09-10', status: 'active',
  history: [{ id: 'm1', direction: 'inbound', sentAt: '2026-09-01', body: 'Please quote 500 pcs hydraulic cylinder.' }],
  facts: [{ kind: 'rfq', sourceMessageId: 'm1', quote: 'Please quote 500 pcs hydraulic cylinder', occurredAt: '2026-09-01' }],
  ...overrides,
});
const envelope = inquiries => JSON.stringify({ schema: 'historical-inquiry.input.v1', synthetic: false, inquiries });

async function fixture(t, { includePlugin = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-inquiry-'));
  const storage = path.join(directory, 'data').replace(/\\/gu, '/');
  const composition = [
    'version: 1',
    `name: ${includePlugin ? 'integration' : 'without-inquiries'}`,
    'server: { host: 127.0.0.1, port: 0 }',
    'plugins:',
    '  - id: storage',
    "    name: '@workspace-harness/seams/storage'",
    `    config: { directory: '${storage}' }`,
    '  - id: artifacts',
    "    name: '@workspace-harness/seams/artifacts'",
    '  - id: approval',
    "    name: '@workspace-harness/seams/approval'",
    '  - id: tools',
    "    name: '@workspace-harness/seams/tools'",
    '  - id: llm',
    "    name: '@workspace-harness/seams/llm'",
    '  - id: skills',
    "    name: '@workspace-harness/seams/skills'",
    '    config: { scanOnMount: true }',
    ...(includePlugin ? ['  - id: inquiries', '    name: workspace-inquiry-recovery', '    config: {}'] : []),
    '',
  ].join('\n');
  const file = path.join(directory, 'harness.test.yml');
  await fs.writeFile(file, composition, 'utf8');
  const harness = await createHarness({ compositionPath: file, root: ROOT });
  const started = await harness.start();
  const base = started.address.url;
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-harness-actor': actor.subject, 'x-harness-role': actor.role },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  t.after(async () => { await harness.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return { harness, request, base, directory };
}

test('the harness runs the inquiry plugin over the real seams end to end', async t => {
  const { harness, request } = await fixture(t);
  assert.deepEqual(harness.healthz().plugins.map(plugin => plugin.id).sort(), ['approval', 'artifacts', 'inquiries', 'llm', 'skills', 'storage', 'tools']);

  const health = await request('/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');

  const imported = await request('/api/inquiry-recovery/import', 'POST', { format: 'json', requestId: randomUUID(), content: envelope([row()]) });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.inserted, 1);

  const listed = await request('/api/inquiry-recovery/opportunities?asOf=2026-10-21');
  assert.equal(listed.status, 200);
  const card = listed.body.cards[0];
  assert.equal(card.decision, 'need_evidence');

  const reviewed = await request('/api/inquiry-recovery/leads/lead-alpha/identity', 'POST', {
    requestId: randomUUID(), sourceHash: card.sourceHash, status: 'confirmed',
    basis: [{ sourceId: 'canton-2024', quote: 'Please quote 500 pcs hydraulic cylinder' }],
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));

  const ready = await request('/api/inquiry-recovery/opportunities?asOf=2026-10-21');
  const stale = ready.body.cards[0];
  assert.equal(stale.decision, 'follow_up');

  const selected = await request('/api/inquiry-recovery/leads/lead-alpha/select', 'POST', {
    requestId: randomUUID(), expectedRevision: stale.revision, sourceHash: stale.sourceHash, asOf: '2026-10-21',
  });
  assert.equal(selected.status, 201, JSON.stringify(selected.body));
  assert.equal(selected.body.draft.sent, false);
  assert.equal(selected.body.goalDraft.enabled, false);

  const tools = harness.ctx.reflect.get('tools', false);
  const status = await tools.execute('inquiry_recovery_status', {}, { actor });
  assert.equal(status.counts.leads, 1);
  const opportunities = await tools.execute('inquiry_recovery_opportunities', { asOf: '2026-10-21', limit: 5 }, { actor });
  assert.equal(opportunities.cards.length, 1);
  assert.equal(opportunities.cards[0].decision, 'follow_up');
  assert.equal(opportunities.cards[0].draftReady, true);

  await assert.rejects(tools.execute('inquiry_recovery_opportunities', { asOf: 'not-a-date' }, { actor }),
    error => error.code === 'HARNESS_TOOL_INVALID');
  await assert.rejects(tools.execute('not_a_tool', {}, { actor }), error => error.code === 'HARNESS_TOOL_REFUSED');

  // The model seam is mounted but unconfigured until a real provider is registered.
  const llm = harness.ctx.reflect.get('llm', false);
  assert.deepEqual(llm.providers(), []);
  llm.register(createEchoProvider());
  const echo = await llm.complete({ messages: [{ role: 'user', content: 'harness llm online' }] });
  assert.equal(echo.text, 'harness llm online');

  // Skills discovered from plugins/*/skills/* at mount; the body is data, never executed.
  const skills = harness.ctx.reflect.get('skills', false);
  const discovered = skills.list();
  assert.ok(discovered.some(skill => skill.name === 'historical-inquiry-recovery'), JSON.stringify(discovered));
  const skill = skills.load('historical-inquiry-recovery');
  assert.ok(skill.body.includes('历史询盘捞回'));
  assert.equal(skill.source.endsWith('SKILL.md'), true);

  // The write tool is gated by a one-shot approval ticket issued through the plugin's own HTTP surface.
  const selectArgs = { leadId: 'lead-alpha', expectedRevision: stale.revision, sourceHash: stale.sourceHash, asOf: '2026-10-21' };
  await assert.rejects(tools.execute('inquiry_recovery_select', selectArgs, { actor }),
    error => error.code === 'HARNESS_APPROVAL_REQUIRED');

  const requested = await request('/api/inquiry-recovery/approvals', 'POST', { tool: 'inquiry_recovery_select', args: selectArgs, reason: 'operator asked for a follow-up draft' });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const approved = await request(`/api/inquiry-recovery/approvals/${requested.body.id}/decide`, 'POST', { decision: 'approve' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, 'approved');

  const selectedByTool = await tools.execute('inquiry_recovery_select', { ...selectArgs, approvalId: requested.body.id }, { actor });
  assert.equal(selectedByTool.decision, 'follow_up');
  assert.equal(selectedByTool.draft.sent, false);
  assert.equal(selectedByTool.goalDraft.enabled, false);
  assert.ok(selectedByTool.selectionId);
  assert.ok(selectedByTool.artifact?.artifactId, 'the harness path must persist a real artifact');
  const artifacts = harness.ctx.reflect.get('artifacts', false);
  const stored = await artifacts.read(selectedByTool.artifact.artifactId);
  assert.ok(stored.content.includes('未发送'));
  assert.equal(stored.artifact.metadata.inquiryRecovery.sent, false);
  assert.equal(stored.artifact.metadata.inquiryRecovery.independentlyVerified, false);
  assert.ok(stored.artifact.metadata.inquiryRecovery.sourceHash);

  // Tickets are one-shot: the same id cannot authorise a second execution.
  await assert.rejects(tools.execute('inquiry_recovery_select', { ...selectArgs, approvalId: requested.body.id }, { actor }),
    error => error.code === 'HARNESS_APPROVAL_REQUIRED');
});

test('disabling the inquiry row removes both its routes and its tools', async t => {
  const { harness, request } = await fixture(t, { includePlugin: false });
  assert.deepEqual(harness.healthz().plugins.map(plugin => plugin.id).sort(), ['approval', 'artifacts', 'llm', 'skills', 'storage', 'tools']);
  const missing = await request('/api/inquiry-recovery/status');
  assert.equal(missing.status, 404);
  const tools = harness.ctx.reflect.get('tools', false);
  const names = tools.list({ actor }).map(tool => tool.name);
  assert.deepEqual(names, []);
});
