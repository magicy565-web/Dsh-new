import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, ROUTES } from '../src/index.mjs';

async function mounted() {
  const routes = new Map();
  const health = new Map();
  const ctx = {
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    health: { register: (name, fn) => health.set(name, fn) },
  };
  await apply(ctx, {});
  return { routes, health };
}

test('home serves one self-contained page at /home', async () => {
  const { routes, health } = await mounted();
  assert.equal(routes.size, ROUTES.length);
  const response = await routes.get('GET /home').handler({}, {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/u);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/u);

  const html = await response.text();
  for (const href of ['/chat', '/goals', '/schedules', '/ops']) assert.ok(html.includes(`href="${href}"`), href);
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)[1];
  assert.doesNotThrow(() => new Function(script), 'the inline page script parses');
  assert.equal(health.get('home')().status, 'ok');
});

test('the plugin refuses an unknown config field', async () => {
  await assert.rejects(apply({ http: { route() {} } }, { extra: true }), error => error.code === 'HARNESS_MANIFEST_INVALID');
});
