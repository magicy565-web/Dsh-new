import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../src/app.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';
import {
  REPO_ROOT,
  assertHarnessError,
  fixtureComposition,
  silentLogger,
  withTrace,
} from './helpers.mjs';

test('boot: plugins are mounted in dependency order regardless of composition order', async () => {
  const trace = await withTrace(async () => {
    const harness = await createHarness({
      compositionPath: fixtureComposition('order.composition.yml'),
      root: REPO_ROOT,
      logger: silentLogger,
    });
    try {
      const health = harness.healthz();
      assert.equal(health.status, 'ok');
      // Mount order is the topological order, not the file order.
      assert.deepEqual(
        health.plugins.map(plugin => plugin.id),
        ['provider', 'consumer'],
      );
      assert.deepEqual([...harness.plugins.keys()], ['provider', 'consumer']);
    } finally {
      await harness.stop();
    }
  });
  const applied = trace.filter(line => line.event === 'apply').map(line => line.id);
  assert.deepEqual(applied, ['trace-provider', 'trace-consumer']);
  const disposed = trace.filter(line => line.event === 'dispose').map(line => line.id);
  assert.deepEqual(disposed, ['trace-consumer', 'trace-provider']);
});

test('boot: missing dependency fails closed before anything is mounted', async () => {
  const trace = await withTrace(async () => {
    await assert.rejects(
      createHarness({
        compositionPath: fixtureComposition('missing-dep.composition.yml'),
        root: REPO_ROOT,
        logger: silentLogger,
      }),
      error => {
        assertHarnessError(error, ERROR.pluginMissingDependency);
        assert.match(error.message, /consumer/u);
        assert.match(error.message, /alpha/u);
        return true;
      },
    );
  });
  assert.deepEqual(trace, []);
});

test('boot: apply failure rolls back already-mounted plugins in reverse order', async () => {
  const trace = await withTrace(async () => {
    await assert.rejects(
      createHarness({
        compositionPath: fixtureComposition('rollback.composition.yml'),
        root: REPO_ROOT,
        logger: silentLogger,
      }),
      error => {
        assertHarnessError(error, ERROR.pluginFailed);
        assert.match(error.message, /failing/u);
        assert.match(error.message, /boom from failing-plugin/u);
        return true;
      },
    );
  });
  const events = trace.map(line => `${line.event}:${line.id}`);
  assert.deepEqual(events, ['apply:trace-provider', 'apply:failing-plugin', 'dispose:trace-provider']);
});

test('boot: two providers for the same service fail closed with HARNESS_PLUGIN_DUPLICATE', async () => {
  await assert.rejects(
    createHarness({
      compositionPath: fixtureComposition('duplicate-provides.composition.yml'),
      root: REPO_ROOT,
      logger: silentLogger,
    }),
    error => {
      assertHarnessError(error, ERROR.pluginDuplicate);
      assert.match(error.message, /alpha/u);
      assert.match(error.message, /first/u);
      assert.match(error.message, /second/u);
      return true;
    },
  );
});

test('boot: disabled row is never imported or mounted', async () => {
  const harness = await createHarness({
    compositionPath: fixtureComposition('disabled.composition.yml'),
    root: REPO_ROOT,
    logger: silentLogger,
  });
  try {
    // boom-import throws at module top-level, so a successful boot proves it was not imported.
    assert.equal(harness.healthz().status, 'ok');
    assert.deepEqual([...harness.plugins.keys()], ['routes-ok']);
    assert.deepEqual(
      harness.healthz().plugins.map(plugin => plugin.id),
      ['routes-ok'],
    );
  } finally {
    await harness.stop();
  }
});

test('boot: stop is idempotent and disposes plugins', async () => {
  const trace = await withTrace(async () => {
    const harness = await createHarness({
      compositionPath: fixtureComposition('order.composition.yml'),
      root: REPO_ROOT,
      logger: silentLogger,
    });
    await harness.stop();
    await harness.stop();
  });
  assert.deepEqual(
    trace.filter(line => line.event === 'dispose').map(line => line.id),
    ['trace-consumer', 'trace-provider'],
  );
});

test('boot: healthz aggregates plugin state and health checks', async () => {
  const harness = await createHarness({
    compositionPath: fixtureComposition('degraded.composition.yml'),
    root: REPO_ROOT,
    logger: silentLogger,
  });
  try {
    const health = harness.healthz();
    assert.equal(health.status, 'degraded');
    assert.deepEqual(health.plugins, [{ id: 'degraded-health', status: 'ok' }]);
    assert.equal(health.checks.length, 1);
    assert.equal(health.checks[0].name, 'degraded-health');
    assert.equal(health.checks[0].status, 'degraded');
    assert.equal(health.checks[0].detail, 'fixture wants attention');
  } finally {
    await harness.stop();
  }
});

test('boot: single plugin dispose removes its routes', async () => {
  const harness = await createHarness({
    compositionPath: fixtureComposition('http.composition.yml'),
    root: REPO_ROOT,
    logger: silentLogger,
  });
  try {
    const { address } = await harness.start();
    const before = await fetch(`${address.url}/api/fixture/hello`);
    assert.equal(before.status, 200);
    await harness.plugins.get('routes-ok').dispose();
    const after = await fetch(`${address.url}/api/fixture/hello`);
    assert.equal(after.status, 404);
  } finally {
    await harness.stop();
  }
});
