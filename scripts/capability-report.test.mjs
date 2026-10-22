import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCoverage, buildReport, classify, collectPlugins, collectSmokes, parseComposition, routeKeys } from './capability-report.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1');

test('composition parsing maps package names and notices enabled: false', () => {
  const text = [
    'plugins:',
    '  - id: quotes',
    '    name: workspace-quotes',
    '    config: { workspaceId: local }',
    '  - id: bridge',
    '    name: workspace-llm-bridge',
    '    config: { enabled: false }',
    '  - id: storage',
    '    name: @workspace-harness/seams/storage',
  ].join('\n');
  const rows = parseComposition(text);
  assert.equal(rows.get('workspace-quotes').enabled, true);
  assert.equal(rows.get('workspace-quotes').rowId, 'quotes');
  assert.equal(rows.get('workspace-llm-bridge').enabled, false);
  assert.equal(rows.has('@workspace-harness/seams/storage'), false);
});

test('classification separates gaps from documented exceptions', () => {
  const composition = new Map([
    ['workspace-covered', { rowId: 'c', enabled: true }],
    ['workspace-gap', { rowId: 'g', enabled: true }],
    ['workspace-off', { rowId: 'o', enabled: false }],
  ]);
  const plugins = [
    { id: 'workspace-covered', directory: 'p', routes: [], tools: [], tests: [], hasPage: false, smokes: ['s.mjs'] },
    { id: 'workspace-gap', directory: 'q', routes: [], tools: [], tests: [], hasPage: false, smokes: [] },
    { id: 'workspace-off', directory: 'r', routes: [], tools: [], tests: [], hasPage: false, smokes: [] },
    { id: 'workspace-runner', directory: 's', routes: [], tools: [], tests: [], hasPage: false, smokes: [] },
    { id: 'workspace-unmounted', directory: 't', routes: [], tools: [], tests: [], hasPage: false, smokes: [] },
  ];
  const byId = Object.fromEntries(classify(plugins, composition).map(plugin => [plugin.id, plugin]));
  assert.equal(byId['workspace-covered'].bucket, 'covered');
  assert.equal(byId['workspace-gap'].bucket, 'gap');
  assert.equal(byId['workspace-off'].bucket, 'disabled');
  assert.equal(byId['workspace-runner'].bucket, 'indirect');
  assert.equal(byId['workspace-unmounted'].bucket, 'unmounted');
});

test('route keys keep api prefixes and plain page routes', () => {
  const keys = routeKeys({
    routes: [
      'GET /api/quotes/status', 'POST /api/quotes', 'GET /api/quotes/:id',
      'GET /quotes', 'POST /api/goals/:id/status',
    ],
  });
  assert.deepEqual(keys.sort(), ['/api/goals', '/api/quotes', '/quotes']);
});

test('coverage matches by plugin id, api prefix, or tool name', () => {
  const plugins = [
    { id: 'workspace-quotes', directory: 'plugins/workspace-quotes', routes: ['GET /api/quotes'], tools: ['quote_create'] },
    { id: 'workspace-silent', directory: 'plugins/workspace-silent', routes: ['GET /api/silent'], tools: ['silent_tool'] },
  ];
  const smokes = [
    { file: 'scripts/a-smoke.mjs', text: 'fetch("/api/quotes")' },
    { file: 'scripts/b-smoke.mjs', text: 'quote_create' },
    { file: 'scripts/c-smoke.mjs', text: 'nothing relevant' },
  ];
  const covered = attachCoverage(plugins, smokes);
  assert.deepEqual(covered[0].smokes, ['scripts/a-smoke.mjs', 'scripts/b-smoke.mjs']);
  assert.deepEqual(covered[1].smokes, []);
});

test('report totals describe what was collected', () => {
  const report = buildReport([
    { id: 'a', directory: 'plugins/a', routes: ['GET /api/a', 'GET /a'], tools: ['t1'], tests: ['a.test.mjs'], hasPage: true },
    { id: 'b', directory: 'plugins/b', routes: ['GET /api/b'], tools: [], tests: [], hasPage: false },
  ], [{ file: 'scripts/x-smoke.mjs', text: '/api/a' }]);
  assert.equal(report.totals.plugins, 2);
  assert.equal(report.totals.routes, 3);
  assert.equal(report.totals.tools, 1);
  assert.equal(report.totals.withTests, 1);
  assert.equal(report.totals.withSmoke, 1);
  assert.equal(report.totals.withPage, 1);
});

test('the real repository is collected without guessing', async () => {
  const plugins = await collectPlugins(root);
  assert.ok(plugins.length >= 15, `expected the plugin packages, saw ${plugins.length}`);
  for (const plugin of plugins) {
    assert.match(plugin.directory, /^plugins\//u);
    assert.ok(Array.isArray(plugin.routes));
    assert.ok(Array.isArray(plugin.tools));
  }
  const ids = plugins.map(plugin => plugin.id);
  assert.ok(ids.includes('workspace-quotes'));
  assert.ok(ids.includes('workspace-purchases'));
  assert.equal(new Set(ids).size, ids.length, 'plugin ids are unique');
  const smokes = await collectSmokes(root);
  assert.ok(smokes.length >= 10, `expected smoke scripts, saw ${smokes.length}`);
});
