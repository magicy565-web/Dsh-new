// Compiled native Component callbacks; not an official WeChat engine run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
function fixture() {
  const file = new URL('../../release/miniprogram/components/muse-draft-review/index.js', import.meta.url); let options;
  vm.runInNewContext(readFileSync(file, 'utf8'), { exports: {}, require: createRequire(file), Component(value) { options = value; }, WeakMap, Error, JSON });
  const events = [], component = { data: { ...options.data, busy: false, uncertain: false }, setData(value) { Object.assign(this.data, structuredClone(value)); }, triggerEvent(name, value) { events.push({ name, value: value ? structuredClone(value) : null }); } };
  Object.assign(component, options.methods);
  return { component, events, load(value) { options.properties.draft.observer.call(component, value); } };
}
const draft = () => ({ id: 'component-dto-fixture', conversationId: 'original-fixture', scopeVersion: 2, scopeHash: 'b'.repeat(64), phase: 'ready_for_review', scope: { product: 'Received product', budgetCredits: 5, deadlineAt: '2026-11-12T00:00:00.000Z' }, questions: [], suggestions: ['Model suggestion, not authorization'] });
test('actual compiled review component emits no prepare without two explicit confirmations', () => {
  const f = fixture(); f.load(draft()); f.component.prepare(); assert.equal(f.events.length, 0);
  f.component.consent({ detail: { value: ['terms'] } }); f.component.prepare(); assert.equal(f.events.length, 0);
  f.component.consent({ detail: { value: ['terms', 'public'] } }); f.component.prepare(); assert.equal(f.events[0].name, 'prepare'); assert.equal(f.events[0].value.scopeHash, draft().scopeHash);
  assert.equal('order' in f.events[0].value, false); assert.equal('budgetCredits' in f.events[0].value, false);
});
test('unchanged authoritative polling preserves review checks, changed scopeVersion resets them; edit/return never submit', () => {
  const f = fixture(), value = draft(); f.load(value); f.component.consent({ detail: { value: ['terms', 'public'] } }); f.load(value); assert.equal(f.component.data.publicConfirmed, true);
  f.load({ ...value, scopeVersion: 3, scopeHash: 'c'.repeat(64) }); assert.equal(f.component.data.publicConfirmed, false); f.component.prepare(); assert.equal(f.events.length, 0);
  f.component.edit(); assert.equal(f.events[0].name, 'edit'); f.load(null); f.load(value); assert.equal(f.component.data.publicConfirmed, false);
  f.component.close(); assert.equal(f.events.at(-1).name, 'close'); assert.ok(f.events.every(event => event.name !== 'prepare'));
});
test('unknown operation disables all mutations and rejects missing scope despite received suggestions', () => {
  const f = fixture(); f.load({ ...draft(), phase: 'needs_information', scope: {}, questions: ['Actual required budget'], suggestions: ['Optional suggestion'] });
  f.component.consent({ detail: { value: ['terms', 'public'] } }); f.component.prepare(); assert.equal(f.events.length, 0);
  f.load(draft()); f.component.data.uncertain = true; f.component.consent({ detail: { value: ['terms', 'public'] } }); f.component.prepare(); f.component.edit(); f.component.reject(); assert.equal(f.events.length, 0);
});
