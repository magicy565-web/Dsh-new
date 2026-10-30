import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutSaver } from '../src/canvas/layout-saver.mjs';

// Browsers throw "Illegal invocation" when setTimeout is called with any `this` but the window.
// This scheduler reproduces that rule so the saver is exercised under real-browser constraints.
function browserTimers() {
  const tasks = new Map();
  let next = 1;
  return {
    schedule: function schedule(run, wait) { assert.equal(this, undefined, 'scheduler must be invoked detached'); const id = next++; tasks.set(id, { run, wait }); return id; },
    cancel: function cancel(id) { assert.equal(this, undefined, 'cancel must be invoked detached'); tasks.delete(id); },
    fire() { const due = [...tasks.values()]; tasks.clear(); for (const task of due) task.run(); },
    get size() { return tasks.size; },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const point = (x, y) => ({ id: 'product:a', position: { x, y } });

function build(overrides = {}) {
  const timers = browserTimers();
  const events = [];
  const saves = [];
  const saver = new LayoutSaver({
    projectId: 'p1', revision: 1, delay: 400, schedule: timers.schedule, cancel: timers.cancel, onChange: (state) => events.push(state.status),
    save: async (patch) => { saves.push(patch); return { layoutRevision: saver.revision + 1 }; }, ...overrides,
  });
  return { saver, timers, events, saves };
}

test('a move is pending, saved once after the debounce, and acknowledged by a higher revision', async () => {
  const { saver, timers, events, saves } = build();
  saver.queue([point(8, 16)]);
  assert.equal(saver.status, 'pending');
  assert.equal(saves.length, 0);
  timers.fire();
  await settle();
  assert.deepEqual(events, ['pending', 'saving', 'saved']);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0], { projectId: 'p1', expectedLayoutRevision: 1, nodes: [{ id: 'product:a', position: { x: 8, y: 16 } }] });
  assert.equal(saver.revision, 2);
});

test('repeated moves collapse into one write that carries the newest position', async () => {
  const { saver, timers, saves } = build();
  saver.queue([point(8, 8)]);
  saver.queue([point(16, 24)]);
  assert.equal(timers.size, 1, 'the debounce timer is re-armed, not duplicated');
  timers.fire();
  await settle();
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].nodes[0].position, { x: 16, y: 24 });
});

test('a move made while a save is in flight is sent afterwards, never lost', async () => {
  let release;
  const { saver, timers, saves } = build({ save: (patch) => new Promise((resolve) => { saves.push(patch); release = () => resolve({ layoutRevision: saver.revision + 1 }); }) });
  saver.queue([point(8, 8)]);
  timers.fire();
  await settle();
  saver.queue([point(32, 32)]);
  release();
  await settle();
  assert.equal(saver.status, 'pending');
  timers.fire();
  await settle();
  release();
  await settle();
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[1].nodes[0].position, { x: 32, y: 32 });
  assert.equal(saver.status, 'saved');
});

test('a receipt without a newer revision is not accepted as proof of saving', async () => {
  const { saver, timers } = build({ save: async () => ({ layoutRevision: 1 }) });
  saver.queue([point(8, 8)]);
  timers.fire();
  await settle();
  assert.equal(saver.status, 'error');
  assert.equal(saver.pendingCount, 1, 'the unsaved position is kept for retry');
});

test('a revision conflict stops writing until the user chooses', async () => {
  const conflict = Object.assign(new Error('conflict'), { status: 409 });
  let attempts = 0;
  const { saver, timers } = build({ save: async () => { attempts += 1; throw conflict; } });
  saver.queue([point(8, 8)]);
  timers.fire();
  await settle();
  assert.equal(saver.status, 'conflict');
  saver.queue([point(16, 16)]);
  timers.fire();
  await settle();
  assert.equal(attempts, 1, 'no further writes while in conflict');
  await saver.resolveConflict('latest', async () => {});
  assert.equal(saver.status, 'saved');
  assert.equal(saver.pendingCount, 0);
});

test('offline keeps the change and retry sends it', async () => {
  let online = false;
  const { saver, timers, saves } = build({ online: () => online });
  saver.queue([point(8, 8)]);
  timers.fire();
  await settle();
  assert.equal(saver.status, 'offline');
  assert.equal(saves.length, 0);
  online = true;
  await saver.retry();
  assert.equal(saves.length, 1);
  assert.equal(saver.status, 'saved');
});

test('a read-only service never queues or writes', async () => {
  const { saver, timers, saves } = build();
  saver.setWritable(false);
  assert.equal(saver.status, 'readonly');
  saver.queue([point(8, 8)]);
  assert.equal(timers.size, 0);
  assert.equal(saves.length, 0);
  saver.setWritable(true);
  assert.equal(saver.status, 'idle');
});

test('dispose cancels the timer and ignores later moves', () => {
  const { saver, timers } = build();
  saver.queue([point(8, 8)]);
  saver.dispose();
  assert.equal(timers.size, 0);
  saver.queue([point(16, 16)]);
  assert.equal(timers.size, 0);
});

test('the default timers are browser-safe wrappers', async () => {
  const saved = [];
  const saver = new LayoutSaver({ projectId: 'p1', revision: 0, delay: 1, save: async (patch) => { saved.push(patch); return { layoutRevision: 1 }; } });
  saver.queue([point(8, 8)]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(saved.length, 1);
  assert.equal(saver.status, 'saved');
  saver.dispose();
});
