import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { registerWorkspaceMuse } from '../extensions/workspace-muse.mjs';
import { MODEL_TOOL_NAMES } from '../extensions/workspace-agent.mjs';
import { createRequestJournal } from '../request-journal.mjs';
import { supplierFixture, facts, publicFields } from './fixtures/supplier-owner.mjs';

async function nativeTools(t) {
  const f = await supplierFixture(); t.after(() => f.close());
  const tools = new Map(), events = new Map(), commands = new Map(), prompts = [];
  let active = [], answer = true;
  const ctx = { mode: 'tui', hasUI: true, model: { provider: 'synthetic-only', id: 'no-network' }, sessionManager: { getSessionId: () => 'synthetic-native-pi-session' },
    ui: { confirm: async (...args) => { prompts.push(args); return typeof answer === 'function' ? answer() : answer; }, notify() {}, setStatus() {} } };
  registerWorkspaceMuse({ on(name, handler) { events.set(name, [...(events.get(name) || []), handler]); }, registerCommand: (name, def) => commands.set(name, def),
    registerTool: def => tools.set(def.name, def), setActiveTools: names => { active = names; } }, {
    agentMode: true, transport: async () => f.transport(), journal: createRequestJournal(path.join(f.directory, 'muse-requests')),
    supplierJournal: createRequestJournal(path.join(f.directory, 'supplier-requests')),
  });
  for (const fn of events.get('session_start')) await fn({}, ctx);
  return { f, tools, events, commands, ctx, prompts, get active() { return active; }, answer: value => { answer = value; },
    call(name, args, callId = 'native-' + name, context = ctx, signal) { return tools.get(name).execute(callId, args, signal, undefined, context); } };
}

test('native Pi proposal definitions reuse original supplier services and prepare only a separately reviewed Muse draft', async t => {
  const ui = await nativeTools(t);
  assert.deepEqual(ui.active, MODEL_TOOL_NAMES); assert.deepEqual([...ui.tools.keys()], MODEL_TOOL_NAMES);
  for (const tool of ui.tools.values()) {
    assert.equal(tool.executionMode, 'sequential');
    assert.equal(tool.parameters.additionalProperties, false);
    for (const denied of ['confirmed', 'approved', 'dispatch', 'requestId', 'publication_execute']) assert.equal(Object.hasOwn(tool.parameters.properties, denied), false);
  }
  const saved = (await ui.call('workspace_supplier_owner_intake', { facts })).details;
  const replay = (await ui.call('workspace_supplier_owner_intake', { facts })).details;
  assert.equal(replay.duplicate, true); assert.equal(replay.serviceId, saved.serviceId);
  await assert.rejects(ui.call('workspace_supplier_owner_intake', { facts: { ...facts, name: 'Changed same native call' } }), { code: 'IDEMPOTENCY_CONFLICT' });
  const read = (await ui.call('workspace_supplier_owner_get', { serviceId: saved.serviceId })).details;
  assert.equal(read.profile.supplierMoq, 500);
  const preview = (await ui.call('workspace_supplier_owner_preview', { serviceId: saved.serviceId, expectedRevision: 1, publicFields })).details;
  assert.equal(preview.preview.saleUnit.unitsPerPack, 2);
  assert.equal(JSON.stringify(preview.preview).includes('wholesaleUnitPrice'), false);
  await ui.call('workspace_supplier_owner_profile', { serviceId: saved.serviceId, expectedRevision: 2, facts: { description: 'Confirmed model-proposed edit' } });
  const draft = (await ui.call('workspace_muse_draft', { serviceId: 'channel-validation', product: 'Synthetic public shirt', market: 'US', objective: 'Synthetic original Muse task only', budgetCredits: 5, deadlineAt: new Date(Date.now() + 86400000).toISOString() })).details;
  assert.equal(draft.delegation.phase, 'review_required'); assert.match(draft.delegation.reviewHash, /^[a-f0-9]{64}$/);
  assert.equal(ui.f.snapshot().orders[0].status, 'draft'); assert.equal((ui.f.app.store.read().museTasks || []).length, 0);
  assert.equal(ui.f.snapshot().modelRuns, 0);
  assert.equal(ui.prompts.length, 7); // Includes replay/conflict confirmation, never persisted approval.
});

test('model arguments do not approve: No/nonboolean/no-UI/RPC/cancel/stale revision all fail closed', async t => {
  const ui = await nativeTools(t);
  for (const answer of [false, undefined, 'true']) {
    ui.answer(answer);
    await assert.rejects(ui.call('workspace_supplier_owner_intake', { facts }), { code: 'USER_CONFIRMATION_DECLINED' });
  }
  assert.equal(ui.f.snapshot().services.length, 0);
  for (const context of [{ ...ui.ctx, mode: 'rpc', hasUI: true }, { ...ui.ctx, mode: 'json', hasUI: false }, { ...ui.ctx, hasUI: false }]) {
    for (const name of MODEL_TOOL_NAMES) await assert.rejects(ui.call(name, { confirmed: true, approved: true }, 'unattended', context), { code: 'INTERACTIVE_TUI_REQUIRED' });
  }
  const controller = new AbortController(); ui.answer(() => { controller.abort(); return true; });
  await assert.rejects(ui.call('workspace_supplier_owner_intake', { facts }, 'cancelled', ui.ctx, controller.signal), { code: 'MODEL_TOOL_CANCELLED' });
  assert.equal(ui.f.snapshot().services.length, 0);
  ui.answer(true);
  const saved = (await ui.call('workspace_supplier_owner_intake', { facts }, 'fresh')).details;
  const promptCount = ui.prompts.length;
  await assert.rejects(ui.call('workspace_supplier_owner_preview', { serviceId: saved.serviceId, expectedRevision: 99, publicFields }), { code: 'SUPPLIER_REVISION_CONFLICT' });
  assert.equal(ui.prompts.length, promptCount);
  await assert.rejects(ui.call('workspace_muse_draft', { serviceId: 'channel-validation', product: 'Public', market: 'US', objective: 'Do not approve', budgetCredits: 5,
    deadlineAt: new Date(Date.now() + 86400000).toISOString(), confirmed: true }), { code: 'MUSE_DRAFT_FIELDS_INVALID' });
  assert.equal(ui.f.snapshot().orders.length, 0);
  for (const name of ['workspace_muse_dispatch', 'workspace_muse_approve', 'workspace_supplier_owner_publication_execute', 'schedule_activate']) {
    assert.equal(ui.tools.has(name), false);
    const denied = await ui.events.get('tool_call')[0]({ toolName: name, input: { confirmed: true } }, ui.ctx);
    assert.equal(denied.block, true);
  }
});
