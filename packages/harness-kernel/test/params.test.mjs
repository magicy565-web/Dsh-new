import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../src/app.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';
import { HTTP_ERROR } from '../src/http.mjs';
import {
  REPO_ROOT,
  assertHarnessError,
  fetchJson,
  fixtureComposition,
  silentLogger,
} from './helpers.mjs';

async function withParams(run) {
  const harness = await createHarness({
    compositionPath: fixtureComposition('params.composition.yml'),
    root: REPO_ROOT,
    logger: silentLogger,
  });
  try {
    const { address } = await harness.start();
    return await run(address);
  } finally {
    await harness.stop();
  }
}

test('params: one-segment :param matches and is percent-decoded', async () => {
  await withParams(async address => {
    const plain = await fetchJson(`${address.url}/api/param/leads/lead-7`);
    assert.equal(plain.status, 200);
    assert.deepEqual(plain.body, { kind: 'param', leadId: 'lead-7' });

    const encoded = await fetchJson(`${address.url}/api/param/leads/lead%20seven`);
    assert.deepEqual(encoded.body, { kind: 'param', leadId: 'lead seven' });

    const unicode = await fetchJson(`${address.url}/api/param/leads/%E4%B8%AD%E6%96%87`);
    assert.deepEqual(unicode.body, { kind: 'param', leadId: '中文' });
  });
});

test('params: static route wins over a parameterised pattern regardless of registration order', async () => {
  await withParams(async address => {
    // The fixture registers the parameterised route FIRST and the static one second.
    const { status, body } = await fetchJson(`${address.url}/api/param/leads/static`);
    assert.equal(status, 200);
    assert.deepEqual(body, { kind: 'static' });
  });
});

test('params: params decode on a multi-segment route and are exposed on context.params', async () => {
  await withParams(async address => {
    const { status, body } = await fetchJson(`${address.url}/api/param/leads/lead%201/identity`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'acme' }),
    });
    assert.equal(status, 200);
    assert.deepEqual(body.params, { leadId: 'lead 1' });
    assert.deepEqual(body.body, { name: 'acme' });
  });
});

test('params: malformed percent-encoding is 400 JSON, never 500', async () => {
  await withParams(async address => {
    const { status, body } = await fetchJson(`${address.url}/api/param/leads/%E0%A4%A`);
    assert.equal(status, 400);
    assert.equal(body.error.code, HTTP_ERROR.invalidPath);
  });
});

test('params: a parameter matches exactly one segment, with no trailing-slash tolerance', async () => {
  await withParams(async address => {
    assert.equal((await fetchJson(`${address.url}/api/param/leads/lead-1/extra`)).status, 404);
    assert.equal((await fetchJson(`${address.url}/api/param/leads/lead-1/`)).status, 404);
    assert.equal((await fetchJson(`${address.url}/api/param/leads/`)).status, 404);
  });
});

test('params: matching is case-sensitive', async () => {
  await withParams(async address => {
    // Static segments are case-sensitive: /LEADS does not match /leads.
    assert.equal((await fetchJson(`${address.url}/api/param/LEADS/lead-1`)).status, 404);
    // But a param segment happily carries any case: /Static is not the static route.
    const { body } = await fetchJson(`${address.url}/api/param/leads/Static`);
    assert.deepEqual(body, { kind: 'param', leadId: 'Static' });
  });
});

test('params: two parameterised patterns matching the same concrete path are a startup failure', async () => {
  await assert.rejects(
    createHarness({
      compositionPath: fixtureComposition('param-conflict.composition.yml'),
      root: REPO_ROOT,
      logger: silentLogger,
    }),
    error => {
      assertHarnessError(error, ERROR.pluginFailed);
      assert.match(error.message, /param-conflict/u);
      assert.match(error.message, /overlaps/u);
      return true;
    },
  );
});
