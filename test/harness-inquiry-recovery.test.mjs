import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../packages/harness-kernel/src/app.mjs';
import { composePreset, loadPreset } from '../packages/harness-kernel/src/presets.mjs';
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

async function fixture(t, { includePlugin = true, patch = null, audit = false } = {}) {
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
    '  - id: audit',
    "    name: '@workspace-harness/seams/audit'",
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
  const patchPaths = [];
  if (patch) {
    const patchFile = path.join(directory, 'harness.test.patch.yml');
    await fs.writeFile(patchFile, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
    patchPaths.push(patchFile);
  }
  const harness = await createHarness({
    compositionPath: file, patchPaths, root: ROOT,
    ...(audit ? { auditPath: path.join(directory, 'harness.audit.jsonl') } : {}),
  });
  const started = await harness.start();
  const base = started.address.url;
  const request = async (route, method = 'GET', body, as = actor) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-harness-actor': as.subject, 'x-harness-role': as.role },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  t.after(async () => { await harness.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return { harness, request, base, directory, auditPath: path.join(directory, 'harness.audit.jsonl') };
}

test('the harness runs the inquiry plugin over the real seams end to end', async t => {
  const { harness, request } = await fixture(t);
  assert.deepEqual(harness.healthz().plugins.map(plugin => plugin.id).sort(), ['approval', 'artifacts', 'audit', 'inquiries', 'llm', 'skills', 'storage', 'tools']);

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

  // ctx.audit records the three business mutations as metadata-only events.
  const auditTrail = await request('/api/inquiry-recovery/audit');
  assert.equal(auditTrail.status, 200, JSON.stringify(auditTrail.body));
  assert.deepEqual(auditTrail.body.events.map(event => event.action).sort(), ['identity-review', 'import', 'select']);
  assert.equal(auditTrail.body.total, 3);
  const selectEvent = auditTrail.body.events.find(event => event.action === 'select');
  assert.equal(selectEvent.kind, 'inquiry');
  assert.deepEqual(selectEvent.actor, { subject: actor.subject, role: actor.role });
  assert.equal(selectEvent.detail.leadId, 'lead-alpha');
  assert.doesNotMatch(JSON.stringify(auditTrail.body), /buyer@alpha|Please quote|未发送/u, 'the audit trail carries metadata only');
  assert.equal((await request('/api/inquiry-recovery/audit', 'GET', undefined, { ...actor, role: 'viewer' })).status, 403);
  assert.equal((await request('/api/inquiry-recovery/audit?limit=1000')).status, 400);

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

  // ctx.audit exposes the tools seam's own entries through one unified stream.
  const audit = harness.ctx.reflect.get('audit', false);
  const toolEvents = audit.list({ kind: 'tool', limit: 100 });
  assert.ok(toolEvents.some(entry => entry.action === 'inquiry_recovery_opportunities' && entry.ok === true), JSON.stringify(toolEvents));
  assert.ok(toolEvents.some(entry => entry.action === 'not_a_tool' && entry.ok === false && entry.code === 'HARNESS_TOOL_REFUSED'));
  const recorded = await audit.record({ kind: 'harness', action: 'integration.probe', actor, ok: true, ref: 'probe-1' });
  assert.equal(recorded.kind, 'harness');
  assert.equal(audit.list({ kind: 'harness' })[0].action, 'integration.probe');
  assert.deepEqual(audit.list({ actor: actor.subject, kind: 'harness' }).map(entry => entry.action), ['integration.probe']);
  assert.ok(audit.summary().total >= 3);
  assert.doesNotMatch(JSON.stringify(audit.list({ limit: 100 })), /buyer@alpha|未发送/u, 'the audit stream carries metadata only');

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
  assert.deepEqual(harness.healthz().plugins.map(plugin => plugin.id).sort(), ['approval', 'artifacts', 'audit', 'llm', 'skills', 'storage', 'tools']);
  const missing = await request('/api/inquiry-recovery/status');
  assert.equal(missing.status, 404);
  const tools = harness.ctx.reflect.get('tools', false);
  const names = tools.list({ actor }).map(tool => tool.name);
  assert.deepEqual(names, []);
});

async function presetHarness(t, name, { patch = null } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `harness-preset-${name}-`));
  const preset = await loadPreset(name, { root: ROOT });
  const composed = await composePreset(preset, { root: ROOT });
  const storage = path.join(directory, 'data').replace(/\\/gu, '/');
  const plugins = composed.composition.rows.map(row => ({
    id: row.id,
    name: row.name,
    ...(row.id === 'storage' ? { config: { directory: storage } } : Object.keys(row.config ?? {}).length ? { config: row.config } : {}),
    ...(row.disabled ? { disabled: true } : {}),
  }));
  let patchPaths = [];
  if (patch) {
    const patchFile = path.join(directory, 'harness.patch.yml');
    await fs.writeFile(patchFile, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
    patchPaths = [patchFile];
  }
  const harness = await createHarness({
    composition: { version: 1, name: preset.name, server: { host: '127.0.0.1', port: 0 }, plugins },
    preset: { name: preset.name, title: preset.title, persona: preset.persona, tools: composed.tools, denyTools: composed.denyTools, skills: composed.skills, model: composed.model },
    patchPaths,
    root: ROOT,
  });
  await harness.start();
  t.after(async () => { await harness.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return { harness, preset };
}

test('an agent preset boots with its tool allow-list enforced', async t => {
  const { harness } = await presetHarness(t, 'inquiry-analyst');
  assert.equal(harness.healthz().status, 'ok');
  assert.equal(harness.preset.name, 'inquiry-analyst');
  assert.equal(harness.preset.title, '询盘捞回专员');
  const tools = harness.ctx.reflect.get('tools', false);
  const names = tools.list({ actor }).map(tool => tool.name);
  assert.deepEqual(names.sort(), ['inquiry_recovery_opportunities', 'inquiry_recovery_status']);
  await assert.rejects(
    tools.execute('inquiry_recovery_select', { leadId: 'lead-alpha', expectedRevision: 1, sourceHash: 'a'.repeat(64) }, { actor }),
    error => error.code === 'HARNESS_TOOL_REFUSED' && /not enabled for this preset/u.test(error.message),
  );
});

test('a preset that grants a write tool still requires a one-shot approval ticket', async t => {
  const { harness } = await presetHarness(t, 'growth-manager');
  const tools = harness.ctx.reflect.get('tools', false);
  const names = tools.list({ actor }).map(tool => tool.name).sort();
  assert.deepEqual(names, ['inquiry_recovery_opportunities', 'inquiry_recovery_select', 'inquiry_recovery_status']);
  await assert.rejects(
    tools.execute('inquiry_recovery_select', { leadId: 'lead-alpha', expectedRevision: 1, sourceHash: 'a'.repeat(64) }, { actor }),
    error => error.code === 'HARNESS_APPROVAL_REQUIRED',
  );
});

test('a patch layer can disable a mounted plugin at boot', async t => {
  const { harness, request } = await fixture(t, { patch: { version: 1, entries: [{ id: 'inquiries', disabled: true }] } });
  assert.deepEqual(harness.healthz().plugins.map(plugin => plugin.id).sort(), ['approval', 'artifacts', 'audit', 'llm', 'skills', 'storage', 'tools']);
  assert.equal(harness.patches.applied.length, 1);
  assert.equal(harness.patches.applied[0].action, 'disable');
  assert.equal((await request('/api/inquiry-recovery/status')).status, 404);
  const tools = harness.ctx.reflect.get('tools', false);
  assert.deepEqual(tools.list({ actor }), []);
});

test('a patch layer can insert a plugin the base composition omits', async t => {
  const { harness, request } = await fixture(t, {
    includePlugin: false,
    patch: { version: 1, insert: [{ id: 'inquiries', name: 'workspace-inquiry-recovery', config: {} }] },
  });
  assert.ok(harness.healthz().plugins.some(plugin => plugin.id === 'inquiries'));
  assert.equal(harness.patches.applied[0].action, 'insert');
  const status = await request('/api/inquiry-recovery/status');
  assert.equal(status.status, 200, JSON.stringify(status.body));
  const tools = harness.ctx.reflect.get('tools', false);
  assert.deepEqual(tools.list({ actor }).map(tool => tool.name).sort(), ['inquiry_recovery_opportunities', 'inquiry_recovery_select', 'inquiry_recovery_status']);
});

test('a patch layer overrides the preset tool allow-list at boot', async t => {
  // growth-manager allows three tools; the patch replaces the tools row config, so
  // only the intersection of "preset allows" and "patch allows" can be called.
  const { harness } = await presetHarness(t, 'growth-manager', {
    patch: { version: 1, entries: [{ id: 'tools', config: { allowedTools: ['inquiry_recovery_status'] } }] },
  });
  assert.equal(harness.preset.name, 'growth-manager');
  assert.deepEqual(harness.patches.applied.map(entry => entry.action), ['config']);
  const tools = harness.ctx.reflect.get('tools', false);
  assert.deepEqual(tools.list({ actor }).map(tool => tool.name), ['inquiry_recovery_status']);
  await assert.rejects(
    tools.execute('inquiry_recovery_select', { leadId: 'lead-alpha', expectedRevision: 1, sourceHash: 'a'.repeat(64) }, { actor }),
    error => error.code === 'HARNESS_TOOL_REFUSED',
  );
});

test('a patch layer that disables a row also removes it from a preset composition', async t => {
  const { harness } = await presetHarness(t, 'inquiry-analyst', {
    patch: { version: 1, entries: [{ id: 'inquiries', disabled: true }] },
  });
  assert.ok(!harness.healthz().plugins.some(plugin => plugin.id === 'inquiries'));
  assert.equal(harness.patches.applied[0].action, 'disable');
  const tools = harness.ctx.reflect.get('tools', false);
  assert.deepEqual(tools.list({ actor }), [], 'a disabled plugin cannot contribute tools even when the preset names them');
  assert.equal(harness.preset.tools.length, 2, 'preset metadata still describes its intent');
});

test('the harness records mount/start/stop audit lines with composition digests', async t => {
  const { harness, auditPath } = await fixture(t, { patch: { version: 1, entries: [{ id: 'tools', config: { allowedTools: ['inquiry_recovery_status'] } }] }, audit: true });
  await harness.stop();
  const lines = (await fs.readFile(auditPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.deepEqual(lines.map(line => line.event), ['harness.mount', 'harness.start', 'harness.stop']);
  const mount = lines[0];
  assert.equal(mount.composition.name, 'integration');
  assert.match(mount.composition.digest, /^[a-f0-9]{64}$/u);
  assert.match(mount.patches.digest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(mount.patches.applied.map(entry => entry.action), ['config']);
  assert.ok(mount.plugins.includes('inquiries'));
  assert.equal(mount.preset, null);
  assert.match(lines[1].address, /^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.doesNotMatch(JSON.stringify(lines), /未发送|buyer@alpha/u);
});

