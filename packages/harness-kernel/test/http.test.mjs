import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../src/app.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';
import { ERROR_STATUS, HTTP_ERROR, statusForError } from '../src/http.mjs';
import {
  REPO_ROOT,
  assertHarnessError,
  fetchJson,
  fixtureComposition,
  silentLogger,
} from './helpers.mjs';

async function withServing(composition, run) {
  const harness = await createHarness({ compositionPath: composition, root: REPO_ROOT, logger: silentLogger });
  try {
    const { address } = await harness.start();
    return await run(harness, address);
  } finally {
    await harness.stop();
  }
}

test('http: GET /healthz returns 200 JSON with the frozen shape', async () => {
  await withServing(fixtureComposition('http.composition.yml'), async (harness, address) => {
    const { response, status, headers, body } = await fetchJson(`${address.url}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(status, 200);
    assert.match(headers.get('content-type'), /application\/json/u);
    assert.equal(body.status, 'ok');
    assert.deepEqual(body.plugins, [{ id: 'routes-ok', status: 'ok' }]);
    assert.equal(body.checks.length, 1);
    assert.equal(body.checks[0].name, 'routes-ok');
    assert.equal(body.checks[0].status, 'ok');
    assert.equal(address.host, '127.0.0.1');
    assert.ok(Number.isInteger(address.port) && address.port > 0);
    assert.equal(harness.http.address.port, address.port);
  });
});

test('http: unknown route returns 404 JSON', async () => {
  await withServing(fixtureComposition('http.composition.yml'), async (harness, address) => {
    const { status, body, headers } = await fetchJson(`${address.url}/api/does-not-exist`);
    assert.equal(status, 404);
    assert.match(headers.get('content-type'), /application\/json/u);
    assert.equal(body.error.code, HTTP_ERROR.routeNotFound);
  });
});

test('http: fixture route returns JSON and actor defaults to local-operator/admin/local', async () => {
  await withServing(fixtureComposition('http.composition.yml'), async (harness, address) => {
    assert.deepEqual((await fetchJson(`${address.url}/api/fixture/hello`)).body, { hello: 'world' });
    const whoami = await fetchJson(`${address.url}/api/fixture/whoami`);
    assert.equal(whoami.status, 200);
    assert.deepEqual(whoami.body, { subject: 'local-operator', role: 'admin', workspaceId: 'local' });
  });
});

test('http: actor is derived from x-harness-* headers', async () => {
  await withServing(fixtureComposition('http.composition.yml'), async (harness, address) => {
    const { body } = await fetchJson(`${address.url}/api/fixture/whoami`, {
      headers: {
        'x-harness-actor': 'alice',
        'x-harness-role': 'viewer',
        'x-harness-workspace': 'ws-42',
      },
    });
    assert.deepEqual(body, { subject: 'alice', role: 'viewer', workspaceId: 'ws-42' });
  });
});

test('http: POST body + query are passed through the request context', async () => {
  await withServing(fixtureComposition('http.composition.yml'), async (harness, address) => {
    const { status, body } = await fetchJson(`${address.url}/api/fixture/echo?tag=a&tag=b`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 3 }),
    });
    assert.equal(status, 201);
    assert.equal(body.method, 'POST');
    assert.deepEqual(body.query, { tag: ['a', 'b'] });
    assert.deepEqual(body.params, {});
    assert.deepEqual(body.body, { n: 3 });
  });
});

test('http: invalid JSON body is a 400 JSON error', async () => {
  await withServing(fixtureComposition('http.composition.yml'), async (harness, address) => {
    const { status, body } = await fetchJson(`${address.url}/api/fixture/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, HTTP_ERROR.invalidBody);
  });
});

test('http: HarnessError maps to its frozen HTTP status and code', async () => {
  await withServing(fixtureComposition('http.composition.yml'), async (harness, address) => {
    const { status, body } = await fetchJson(`${address.url}/api/fixture/boom`);
    assert.equal(status, 403);
    assert.equal(body.error.code, ERROR.approvalRequired);
    assert.match(body.error.message, /fixture approval required/u);
    assert.equal(ERROR_STATUS[ERROR.approvalRequired], 403);
  });
});

test('http: unexpected exceptions become 500 without leaking stack or message', async () => {
  await withServing(fixtureComposition('http.composition.yml'), async (harness, address) => {
    const { status, body, text } = await fetchJson(`${address.url}/api/fixture/crash`);
    assert.equal(status, 500);
    assert.equal(body.error.code, HTTP_ERROR.internal);
    assert.equal(body.error.message, 'Internal server error');
    assert.doesNotMatch(text, /secret internal detail/u);
    assert.doesNotMatch(text, /at .*index\.mjs/u);
  });
});

test('http: duplicate route inside a plugin is a startup failure mentioning the plugin id', async () => {
  await assert.rejects(
    createHarness({
      compositionPath: fixtureComposition('route-conflict.composition.yml'),
      root: REPO_ROOT,
      logger: silentLogger,
    }),
    error => {
      assertHarnessError(error, ERROR.pluginFailed);
      assert.match(error.message, /routes-conflict/u);
      assert.match(error.message, /route conflict/u);
      return true;
    },
  );
});

test('http: duplicate route across two plugin rows is a startup failure', async () => {
  await assert.rejects(
    createHarness({
      compositionPath: fixtureComposition('duplicate-route.composition.yml'),
      root: REPO_ROOT,
      logger: silentLogger,
    }),
    error => {
      assertHarnessError(error, ERROR.pluginFailed);
      assert.match(error.message, /"second"/u);
      assert.match(error.message, /route conflict/u);
      assert.match(error.message, /\/api\/fixture\/hello/u);
      return true;
    },
  );
});

test('http: plugin cannot override the built-in GET /healthz', async () => {
  await assert.rejects(
    createHarness({
      compositionPath: fixtureComposition('healthz-conflict.composition.yml'),
      root: REPO_ROOT,
      logger: silentLogger,
    }),
    error => {
      assertHarnessError(error, ERROR.pluginFailed);
      assert.match(error.message, /healthz-conflict/u);
      assert.match(error.message, /route conflict/u);
      return true;
    },
  );
});

test('http: stop closes the listening socket and start-after-stop fails', async () => {
  const harness = await createHarness({
    compositionPath: fixtureComposition('http.composition.yml'),
    root: REPO_ROOT,
    logger: silentLogger,
  });
  const { address } = await harness.start();
  assert.equal((await fetch(`${address.url}/healthz`)).status, 200);
  await harness.stop();
  await assert.rejects(fetch(`${address.url}/healthz`));
  await assert.rejects(harness.start(), error => {
    assertHarnessError(error, ERROR.pluginFailed);
    return true;
  });
});

test('http: ERROR_STATUS exposes deterministic status mapping', () => {
  assert.equal(statusForError({ code: ERROR.approvalRequired }), 403);
  assert.equal(statusForError({ code: ERROR.toolInvalid }), 400);
  assert.equal(statusForError({ code: ERROR.toolDuplicate }), 409);
  assert.equal(statusForError({ code: 'HARNESS_UNKNOWN' }), 500);
  assert.equal(statusForError({ code: ERROR.toolRefused, status: 451 }), 451);
});
