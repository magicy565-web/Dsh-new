import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { museConversationFixture, actor } from './fixtures/muse-conversation.mjs';

// Load original plugin routing with explicitly synthetic Cordis/SDK dependencies.
// This checks the actual Host routing and real WorkerDesk delegate, not Harness boot.
function routing(service, { dot } = {}) {
  let source = fs.readFileSync(new URL('../deploy/muse-native-overlay/server/workspace-native-plugin.mjs', import.meta.url), 'utf8');
  if (!source.includes('export function createWorkspaceNativePlugin')) throw Error('Native routing anchor changed');
  source = source.replace(/^import .*;\r?$/gm, '')
    .replace(/^export \{.*;\r?$/gm, '')
    .replace(/^export const apply =.*;\r?$/gm, '')
    .replace('export function createWorkspaceNativePlugin', 'function createWorkspaceNativePlugin');
  const deps = {
    defineTool: () => {}, validateJsonSchemaValue: () => {},
    createNativeToolInstaller: () => () => () => {},
    createWorkspacePlugin: options => ({ inject: [], async apply(ctx, config) {
      if (dot) for (const item of config.operators) options.installAgentTools({ ctx, nativeAgentId: item.nativeAgentId, tools: [] });
      return { service };
    } }),
    openWorkspacePluginService: () => { throw Error('No original Harness boot in this fixture'); },
    createNativeDotBinding: () => dot,
    pluginFields: () => {}, pluginFail: (code, message) => { throw Object.assign(Error(message), { code }); },
    inspectReviewedDotHistory: () => { throw Error('No history authority in this fixture'); },
    resumeReviewedDotHistory: () => { throw Error('No recovery authority in this fixture'); },
    createMuseSessionRelay: () => { throw Error('Native result relay has its separate contract tests'); },
  };
  const factory = new Function(...Object.keys(deps), source + '\nreturn createWorkspaceNativePlugin;')(...Object.values(deps));
  const provided = new Map(), effects = [];
  const ctx = { provide: (name, value) => provided.set(name, value), effect: async (callback, label) => { effects.push(label); } };
  return { plugin: factory(dot ? { dot: { configuration: { enabled: true }, ownerSubject: actor.subject } } : {}), provided, effects, ctx };
}

test('original conversation Host prepares Muse with no Dot connection, without dispatch or starting a timer', async t => {
  const f = await museConversationFixture(t);
  const service = { dot: { enabled: false }, muse: { enabled: true, bindConversation: a => f.binding().bindConversation(a) } };
  const h = routing(service); await h.plugin.apply(h.ctx, { operators: [actor] });
  const host = h.provided.get('workspaceDotHost'); assert.ok(host);
  const input = f.input('muse-only-host');
  const made = await host.submitQuestion(actor, input);
  const duplicate = await host.submitQuestion(actor, input);
  assert.equal(made.delegation.orderId, duplicate.delegation.orderId);
  assert.equal(made.delegation.phase, 'review_required');
  assert.equal(f.store.read().workerOrders.length, 1); assert.equal(f.store.read().museTasks?.length ?? 0, 0);
  assert.deepEqual(h.effects, []);
  assert.throws(() => host.submitQuestion({ ...actor, nativeAgentId: 'foreign-session' }, input));
  assert.throws(() => host.submitQuestion(actor, { content: 'Natural text without provider' }));
});

test('original Dot submissions retain their binding and cannot fall through to a Muse order', async t => {
  const f = await museConversationFixture(t), seen = [];
  const dot = { tools: [], submitQuestion: body => { seen.push(body); return { legacy: true }; } };
  const service = { dot: { enabled: true }, muse: { enabled: true, bindConversation: a => f.binding().bindConversation(a) } };
  const h = routing(service, { dot }); await h.plugin.apply(h.ctx, { operators: [actor] });
  const host = h.provided.get('workspaceDotHost'), body = { requestId: 'legacy-dot', content: 'Legacy Dot request' };
  assert.deepEqual(host.submitQuestion(actor, body), { legacy: true }); assert.deepEqual(seen, [body]);
  assert.equal(f.store.read().workerOrders.length, 0);
  await host.submitQuestion(actor, f.input('explicit-muse'));
  assert.equal(seen.length, 1); assert.equal(f.store.read().workerOrders.length, 1);
});