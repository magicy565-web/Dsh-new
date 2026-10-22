import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxService } from '../src/domain.mjs';
import { apply, ROUTES } from '../src/index.mjs';

function fakeStorage() {
  let state = {};
  return {
    read: () => structuredClone(state),
    update: async mutator => {
      const draft = structuredClone(state);
      const result = mutator(draft);
      state = draft;
      return structuredClone(result);
    },
  };
}

const ADMIN = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
const PRODUCER = { actor: { subject: 'service:test', role: 'operator', workspaceId: 'local' }, trustedService: true };

function service(overrides = {}) {
  return createInboxService({ storage: fakeStorage(), ...overrides });
}

test('only an internal producer can push and only members can read', async () => {
  const inbox = service();
  await assert.rejects(
    inbox.push({ actor: ADMIN }, { kind: 'approval.pending', title: 'x' }),
    error => error.code === 'INBOX_PRODUCER_ONLY' && error.status === 403,
  );
  const pushed = await inbox.push(PRODUCER, {
    kind: 'approval.pending', title: '待批准：artifact_write', body: 'tool:artifact_write',
    refs: { approvalId: crypto.randomUUID() },
  });
  assert.equal(pushed.created, true);
  assert.equal(pushed.item.status, 'unread');
  assert.equal(inbox.list({ actor: ADMIN }).unread, 1);
});

test('the same dedupe key does not create a second unread item', async () => {
  const inbox = service();
  const body = { kind: 'schedule.dispatched', title: '计划已触发', dedupeKey: 'schedule:1:2026-10-23T00:00:00.000Z' };
  assert.equal((await inbox.push(PRODUCER, body)).created, true);
  assert.equal((await inbox.push(PRODUCER, body)).created, false);
  assert.equal(inbox.list({ actor: ADMIN }).total, 1);
});

test('reading one item and reading all items are recorded', async () => {
  const inbox = service();
  const first = await inbox.push(PRODUCER, { kind: 'schedule.dispatched', title: '一' });
  await inbox.push(PRODUCER, { kind: 'schedule.dispatched', title: '二' });
  assert.equal(inbox.list({ actor: ADMIN }).unread, 2);

  const read = await inbox.markRead({ actor: ADMIN }, first.item.id);
  assert.equal(read.item.status, 'read');
  assert.equal(inbox.list({ actor: ADMIN }).unread, 1);

  const all = await inbox.markAllRead({ actor: ADMIN });
  assert.equal(all.changed, 1);
  assert.equal(inbox.list({ actor: ADMIN }).unread, 0);
  assert.equal(inbox.list({ actor: ADMIN }, { status: 'all' }).total, 2);
});

test('a producer bound to another workspace is refused', async () => {
  const inbox = service();
  await assert.rejects(
    inbox.push({ actor: { subject: 'service:x', role: 'operator', workspaceId: 'other' }, trustedService: true }, { kind: 'schedule.dispatched', title: '别处' }),
    error => error.code === 'INBOX_FORBIDDEN' && error.status === 403,
  );
  assert.equal(inbox.list({ actor: ADMIN }).total, 0);
});

test('bad items are refused instead of stored', async () => {
  const inbox = service();
  await assert.rejects(inbox.push(PRODUCER, { kind: 'Bad Kind', title: 'x' }), error => error.code === 'INBOX_INPUT');
  await assert.rejects(inbox.push(PRODUCER, { kind: 'ok', title: '' }), error => error.code === 'INBOX_INPUT');
  await assert.rejects(inbox.push(PRODUCER, { kind: 'ok', title: 'x', refs: { a: 1 } }), error => error.code === 'INBOX_INPUT');
  await assert.rejects(inbox.push(PRODUCER, { kind: 'ok', title: 'x', extra: true }), error => error.code === 'INBOX_INPUT');
});

test('a damaged inbox fails closed', async () => {
  const storage = fakeStorage();
  const inbox = createInboxService({ storage });
  await inbox.push({ actor: { subject: 's', role: 'operator', workspaceId: 'local' }, trustedService: true }, { kind: 'ok', title: 'x' });
  const state = storage.read();
  state.workspaces.local.harnessInbox.items[0].status = 'unknown';
  storage.update(draft => { Object.assign(draft, state); return null; });
  assert.throws(() => inbox.status({ actor: ADMIN }), error => error.code === 'INBOX_INVALID');
});

test('the inbox page is self-contained and its script parses', async () => {
  const routes = new Map();
  await apply({
    storage: fakeStorage(),
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    health: { register: () => {} },
    provide: () => () => {},
  }, {});
  assert.equal(routes.size, ROUTES.length);
  const response = await routes.get('GET /inbox').handler({}, {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/u);
  const html = await response.text();
  assert.match(html, /收件箱/u);
  assert.match(html, /id="read-all"/u);
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)[1];
  assert.doesNotThrow(() => new Function(script), 'the inline page script parses');
});