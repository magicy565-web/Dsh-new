import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, ROUTES, TOOLS } from '../src/index.mjs';
import { createQuoteService } from '../src/domain.mjs';

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
    snapshot: () => structuredClone(state),
  };
}

const ADMIN = { subject: 'local-operator', role: 'admin', workspaceId: 'local' };
const VIEWER = { subject: 'viewer-1', role: 'viewer', workspaceId: 'local' };
const requestId = () => crypto.randomUUID();

function service() {
  return createQuoteService({ storage: fakeStorage() });
}

const validQuote = () => ({
  requestId: requestId(),
  customer: '海祺贸易',
  currency: 'CNY',
  lines: [
    { description: '不锈钢法兰 DN50', quantity: 500, unitPriceMinor: 1250 },
    { description: '运费', quantity: 1, unitPriceMinor: 30000 },
  ],
});

test('the server computes the total in minor units and formats it', async () => {
  const quotes = service();
  const { quote } = await quotes.create({ actor: ADMIN }, validQuote());
  assert.equal(quote.totalMinor, 500 * 1250 + 30000); // 655000 分
  assert.equal(quote.total, '6550.00');
  assert.equal(quote.status, 'draft');
  assert.match(quote.number, /^Q-\d{8}-\d{3}$/u);
  assert.equal(quote.lines[0].amount, '6250.00');
});

test('a client-supplied total is refused', async () => {
  const quotes = service();
  await assert.rejects(
    quotes.create({ actor: ADMIN }, { ...validQuote(), total: '0.01' }),
    error => error.code === 'QUOTE_INPUT',
  );
});

test('bad lines and currencies are refused', async () => {
  const quotes = service();
  await assert.rejects(quotes.create({ actor: ADMIN }, { ...validQuote(), currency: 'cny' }), error => error.code === 'QUOTE_INPUT');
  await assert.rejects(quotes.create({ actor: ADMIN }, { ...validQuote(), lines: [] }), error => error.code === 'QUOTE_INPUT');
  await assert.rejects(quotes.create({ actor: ADMIN }, { ...validQuote(), lines: [{ description: 'x', quantity: 0, unitPriceMinor: 1 }] }), error => error.code === 'QUOTE_INPUT');
  await assert.rejects(quotes.create({ actor: ADMIN }, { ...validQuote(), lines: [{ description: '', quantity: 1, unitPriceMinor: 1 }] }), error => error.code === 'QUOTE_INPUT');
});

test('creation is idempotent by requestId', async () => {
  const quotes = service();
  const body = validQuote();
  const first = await quotes.create({ actor: ADMIN }, body);
  const again = await quotes.create({ actor: ADMIN }, body);
  assert.equal(again.replayed, true);
  assert.equal(again.quote.id, first.quote.id);
  assert.equal(quotes.list({ actor: ADMIN }).total, 1);
});

test('the status machine is explicit and terminal states stay closed', async () => {
  const quotes = service();
  const { quote } = await quotes.create({ actor: ADMIN }, validQuote());
  await quotes.setStatus({ actor: ADMIN }, quote.id, { status: 'sent' });
  await quotes.setStatus({ actor: ADMIN }, quote.id, { status: 'accepted' });
  await assert.rejects(quotes.setStatus({ actor: ADMIN }, quote.id, { status: 'sent' }), error => error.code === 'QUOTE_TRANSITION' && error.status === 409);
  await assert.rejects(quotes.setStatus({ actor: ADMIN }, quote.id, { status: 'lost' }), error => error.code === 'QUOTE_INPUT');
});

test('a viewer can read but not create or move', async () => {
  const quotes = service();
  const { quote } = await quotes.create({ actor: ADMIN }, validQuote());
  assert.equal(quotes.read({ actor: VIEWER }, quote.id).quote.id, quote.id);
  await assert.rejects(quotes.create({ actor: VIEWER }, validQuote()), error => error.code === 'QUOTE_FORBIDDEN');
  await assert.rejects(quotes.setStatus({ actor: VIEWER }, quote.id, { status: 'sent' }), error => error.code === 'QUOTE_FORBIDDEN');
});

test('the HTTP surface creates, lists, reads and moves a quote, and the page parses', async () => {
  const routes = new Map();
  const tools = new Map();
  await apply({
    storage: fakeStorage(),
    http: { route: definition => { routes.set(`${definition.method} ${definition.path}`, definition); } },
    tools: { register: definition => { tools.set(definition.name, definition); return () => {}; } },
    health: { register: () => {} },
  }, {});
  assert.equal(routes.size, ROUTES.length);
  assert.deepEqual([...tools.keys()].sort(), [...TOOLS].sort());

  const page = await routes.get('GET /quotes').handler({}, {}, {});
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /新建报价/u);
  assert.doesNotThrow(() => new Function(html.match(/<script>([\s\S]*?)<\/script>/u)[1]), 'the inline page script parses');

  const call = async (key, { params = {}, body = {}, query = {}, actor = ADMIN } = {}) => {
    const [method, pathname] = key.split(' ');
    return routes.get(key).handler({}, {}, { method, pathname, params, body, query, actor });
  };

  const created = await call('POST /api/quotes', { body: validQuote() });
  assert.equal(created.status, 201);
  const id = created.body.quote.id;

  const listed = await call('GET /api/quotes', { query: { status: 'all' } });
  assert.equal(listed.body.total, 1);

  const read = await call('GET /api/quotes/:id', { params: { id } });
  assert.equal(read.body.quote.total, '6550.00');

  const moved = await call('POST /api/quotes/:id/status', { params: { id }, body: { status: 'sent' } });
  assert.equal(moved.body.quote.status, 'sent');

  assert.equal(tools.get('quote_create').approval, 'always');
  assert.equal(tools.get('quote_create').readOnly, false);
  assert.equal(tools.get('quote_list').approval, 'never');
  assert.equal(tools.get('quote_list').readOnly, true);
});

test('the internal lookup finds a quote without an actor', async () => {
  const quotes = service();
  const { quote } = await quotes.create({ actor: ADMIN }, validQuote());
  assert.equal(quotes.lookup(quote.id).id, quote.id);
  assert.equal(quotes.lookup('not-a-uuid'), null);
  assert.equal(quotes.lookup(crypto.randomUUID()), null);
});