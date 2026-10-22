import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessService, SESSION_TTL_MS } from '../src/domain.mjs';

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

const member = subject => ({ workspaceId: 'local', subject, role: subject === 'local-operator' ? 'admin' : 'viewer' });

function service(overrides = {}) {
  let now = Date.parse('2026-10-23T00:00:00.000Z');
  const access = createAccessService({
    storage: fakeStorage(),
    resolveWorkspace: actor => (actor.subject === 'stranger' ? null : member(actor.subject)),
    clock: () => now,
    ...overrides,
  });
  return { access, advance: ms => { now += ms; } };
}

test('a member signs in and the session resolves to the authoritative role', async () => {
  const { access } = service();
  const { session } = await access.login({ subject: 'local-operator' });
  assert.match(session.id, /^[a-f0-9]{64}$/u);
  assert.equal(session.role, 'admin');
  const actor = await access.resolveSession(session.id);
  assert.deepEqual(actor, { workspaceId: 'local', subject: 'local-operator', role: 'admin' });
});

test('an unknown subject and a bad cookie do not produce an actor', async () => {
  const { access } = service();
  await assert.rejects(access.login({ subject: 'stranger' }), error => error.code === 'ACCESS_NOT_MEMBER' && error.status === 403);
  assert.equal(await access.resolveSession('nope'), null);
  assert.equal(await access.resolveSession('a'.repeat(64)), null);
});

test('expired and revoked sessions stop resolving', async () => {
  const { access, advance } = service();
  const first = await access.login({ subject: 'local-operator' });
  advance(SESSION_TTL_MS + 1_000);
  assert.equal(await access.resolveSession(first.session.id), null);

  const second = await access.login({ subject: 'local-operator' });
  await access.logout(second.session.id);
  assert.equal(await access.resolveSession(second.session.id), null);
});

test('only an administrator can list sessions', async () => {
  const { access } = service();
  await access.login({ subject: 'local-operator' });
  assert.equal(access.listSessions({ actor: { role: 'admin' } }).total, 1);
  assert.throws(() => access.listSessions({ actor: { role: 'viewer' } }), error => error.code === 'ACCESS_FORBIDDEN');
  assert.throws(() => access.listSessions({}), error => error.code === 'ACCESS_FORBIDDEN');
});

test('login input is bounded', async () => {
  const { access } = service();
  await assert.rejects(access.login({}), error => error.code === 'ACCESS_INPUT');
  await assert.rejects(access.login({ subject: '' }), error => error.code === 'ACCESS_INPUT');
  await assert.rejects(access.login({ subject: 'x', extra: 1 }), error => error.code === 'ACCESS_INPUT');
});
