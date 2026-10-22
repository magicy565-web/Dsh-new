import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, TOOLS } from '../src/index.mjs';
import { compareQuotes } from '../src/domain.mjs';

test('quotes with one basis are aligned and never ranked', () => {
  const result = compareQuotes({
    quotes: [
      { supplier: 'A', spec: 'DN50', currency: 'CNY', trade_term: 'FOB', unit_price: 12.5 },
      { supplier: 'B', spec: 'DN50', currency: 'CNY', trade_term: 'FOB', unit_price: 13 },
    ],
  });
  assert.equal(result.status, 'draft');
  assert.equal(result.alignment, 'same-supplied-basis-unverified');
  assert.equal(result.ranked, false);
  assert.equal(result.priceConversion, false);
  assert.equal(result.independentVerification, false);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].provenance, 'user_provided_unverified');
  assert.equal(result.rows[0].cells.unit_price.value, 12.5);
  assert.equal(result.rows[0].cells.moq.status, 'pending');
  assert.match(result.suppliedSha256, /^[a-f0-9]{64}$/u);
  assert.match(result.notice, /not verified comparability/u);
});

test('a missing alignment key blocks the basis claim', () => {
  const result = compareQuotes({ quotes: [{ supplier: 'A', spec: 'DN50' }, { supplier: 'B', spec: 'DN50', currency: 'CNY', trade_term: 'FOB' }] });
  assert.equal(result.alignment, 'pending');
});

test('different supplied bases are reported, not reconciled', () => {
  const result = compareQuotes({
    quotes: [
      { supplier: 'A', spec: 'DN50', currency: 'CNY', trade_term: 'FOB' },
      { supplier: 'B', spec: 'DN80', currency: 'CNY', trade_term: 'CIF' },
    ],
  });
  assert.equal(result.alignment, 'different-supplied-basis');
});

test('an empty comparison is empty rather than invented', () => {
  const result = compareQuotes({ quotes: [] });
  assert.equal(result.status, 'empty');
  assert.equal(result.alignment, 'no-supplied-quotes');
  assert.deepEqual(result.rows, []);
});

test('only canonical scalar fields are accepted', () => {
  assert.throws(() => compareQuotes({ quotes: [{ supplier: 'A', price: 1 }] }), error => error.code === 'PROCUREMENT_INPUT');
  assert.throws(() => compareQuotes({ quotes: [{ supplier: { nested: true } }] }), error => error.code === 'PROCUREMENT_INPUT');
  assert.throws(() => compareQuotes({ quotes: 'nope' }), error => error.code === 'PROCUREMENT_INPUT');
  assert.throws(() => compareQuotes({ quotes: [], extra: 1 }), error => error.code === 'PROCUREMENT_INPUT');
  assert.throws(() => compareQuotes({ quotes: Array.from({ length: 21 }, () => ({ supplier: 'A' })) }), error => error.code === 'PROCUREMENT_INPUT');
});

test('the plugin registers one read-only tool and a capabilities route', async () => {
  const routes = new Map();
  const tools = new Map();
  await apply({
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    tools: { register: definition => { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    health: { register: () => {} },
  }, {});
  assert.deepEqual([...tools.keys()], [...TOOLS]);
  const tool = tools.get('procurement_compare');
  assert.equal(tool.readOnly, true);
  assert.equal(tool.approval, 'never');

  const capabilities = await routes.get('GET /api/procurement/capabilities').handler({}, {}, {});
  assert.equal(capabilities.body.ranked, false);
  assert.equal(capabilities.body.storesAnything, false);

  const result = await tool.handler({ quotes: [{ supplier: 'A', spec: 'DN50', currency: 'CNY', trade_term: 'FOB' }] }, {});
  assert.equal(result.rows.length, 1);
});
