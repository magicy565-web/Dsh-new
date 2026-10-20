import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHarness } from '../src/app.mjs';
import { resolveRows } from '../src/resolve.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';
import {
  REPO_ROOT,
  assertHarnessError,
  cleanupRoot,
  fixture,
  fixtureComposition,
  makeRoot,
  silentLogger,
} from './helpers.mjs';

test('composition: missing file fails closed with HARNESS_COMPOSITION_INVALID', async () => {
  await assert.rejects(
    createHarness({ compositionPath: fixture('does-not-exist.yml'), root: REPO_ROOT, logger: silentLogger }),
    error => {
      assertHarnessError(error, ERROR.compositionInvalid);
      assert.match(error.message, /not found/u);
      return true;
    },
  );
});

test('composition: invalid YAML fails closed', async () => {
  await assert.rejects(
    createHarness({ compositionPath: fixture('bad-yaml.yml'), root: REPO_ROOT, logger: silentLogger }),
    error => {
      assertHarnessError(error, ERROR.compositionInvalid);
      assert.match(error.message, /YAML/u);
      return true;
    },
  );
});

test('composition: wrong version fails closed', async () => {
  await assert.rejects(
    createHarness({ compositionPath: fixture('bad-composition-version.yml'), root: REPO_ROOT, logger: silentLogger }),
    error => {
      assertHarnessError(error, ERROR.compositionInvalid);
      assert.match(error.message, /version/u);
      return true;
    },
  );
});

test('composition: invalid row fails closed', async () => {
  await assert.rejects(
    createHarness({ compositionPath: fixture('bad-composition-row.yml'), root: REPO_ROOT, logger: silentLogger }),
    error => {
      assert.ok(error?.name === 'HarnessError');
      // The frozen contract validators use HARNESS_MANIFEST_INVALID for bad ids, even
      // for composition rows (assertId is shared); accept either vocabulary.
      assert.ok(
        [ERROR.compositionInvalid, ERROR.manifestInvalid].includes(error.code),
        `unexpected code ${error.code}`,
      );
      assert.match(error.message, /row 0\.id/u);
      return true;
    },
  );
});

test('composition: invalid plugin manifest fails closed with HARNESS_MANIFEST_INVALID', async () => {
  await assert.rejects(
    createHarness({ compositionPath: fixtureComposition('bad-manifest.composition.yml'), root: REPO_ROOT, logger: silentLogger }),
    error => {
      assertHarnessError(error, ERROR.manifestInvalid);
      assert.match(error.message, /bad-manifest/u);
      return true;
    },
  );
});

test('composition: rule 3 explicit relative path resolves against the composition dir and mounts', async () => {
  const harness = await createHarness({
    compositionPath: fixture('relative.composition.yml'),
    root: REPO_ROOT,
    logger: silentLogger,
  });
  try {
    const health = harness.healthz();
    assert.equal(health.status, 'ok');
    assert.deepEqual(
      health.plugins.map(plugin => plugin.id),
      ['provider'],
    );
    assert.equal(harness.ctx.alpha.label, 'relative');
  } finally {
    await harness.stop();
  }
});

test('composition: rule 1 @workspace-harness/<pkg>/<entry> resolves and a factory module mounts', async () => {
  const root = await makeRoot({
    'packages/harness-demo/src/hello.mjs': `export function createDemoProvider(config = {}) {
  return {
    async apply(ctx) {
      ctx.provide('demo', { label: config.label ?? null });
    },
  };
}
`,
    'demo.yml': `version: 1
name: rule-one
server: { host: 127.0.0.1, port: 0 }
plugins:
  - id: demo
    name: '@workspace-harness/demo/hello'
    config: { label: rule-one }
`,
  });
  try {
    const harness = await createHarness({
      compositionPath: join(root, 'demo.yml'),
      root,
      logger: silentLogger,
    });
    try {
      assert.equal(harness.healthz().status, 'ok');
      assert.equal(harness.ctx.demo.label, 'rule-one');
      assert.deepEqual([...harness.plugins.keys()], ['demo']);
    } finally {
      await harness.stop();
    }
  } finally {
    await cleanupRoot(root);
  }
});

test('composition: rule 2 plain name resolves plugins/<name>/harness.plugin.json', async () => {
  const root = await makeRoot({
    'plugins/local-demo/harness.plugin.json': JSON.stringify({
      id: 'local-demo',
      version: '0.1.0',
      kind: 'plugin',
      entry: './src/index.mjs',
    }),
    'plugins/local-demo/src/index.mjs': `export function apply(ctx) {
  ctx.provide('localDemo', { ok: true });
}
`,
    'local.yml': `version: 1
name: rule-two
server: { host: 127.0.0.1, port: 0 }
plugins:
  - id: local-demo
    name: local-demo
`,
  });
  try {
    const harness = await createHarness({
      compositionPath: join(root, 'local.yml'),
      root,
      logger: silentLogger,
    });
    try {
      assert.equal(harness.healthz().status, 'ok');
      assert.equal(harness.plugins.get('local-demo').manifest.id, 'local-demo');
      assert.equal(harness.ctx.localDemo.ok, true);
    } finally {
      await harness.stop();
    }
  } finally {
    await cleanupRoot(root);
  }
});

test('composition: missing rule-2 plugin is reported as missing by resolution and fails createHarness', async () => {
  const root = await makeRoot({
    'missing.yml': `version: 1
name: missing
plugins:
  - id: nope
    name: not-installed
`,
  });
  try {
    const resolved = await resolveRows(
      [
        {
          id: 'nope',
          name: 'not-installed',
          config: {},
          disabled: false,
          isolate: {},
        },
      ],
      { root, compositionFile: join(root, 'missing.yml') },
    );
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].status, 'missing');
    assert.equal(resolved[0].error.code, ERROR.pluginFailed);

    await assert.rejects(
      createHarness({ compositionPath: join(root, 'missing.yml'), root, logger: silentLogger }),
      error => {
        assertHarnessError(error, ERROR.pluginFailed);
        assert.match(error.message, /nope/u);
        assert.match(error.message, /not-installed/u);
        return true;
      },
    );
  } finally {
    await cleanupRoot(root);
  }
});

test('composition: duplicate row ids fail closed during validation', async () => {
  const root = await makeRoot({
    'duplicate.yml': `version: 1
name: duplicate
plugins:
  - id: same
    name: a
  - id: same
    name: b
`,
  });
  try {
    await assert.rejects(
      createHarness({ compositionPath: join(root, 'duplicate.yml'), root, logger: silentLogger }),
      error => {
        assertHarnessError(error, ERROR.pluginDuplicate);
        assert.match(error.message, /duplicated/u);
        return true;
      },
    );
  } finally {
    await cleanupRoot(root);
  }
});
