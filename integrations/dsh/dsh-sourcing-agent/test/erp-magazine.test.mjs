import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { ErpStore } from '../../dsh-mini-erp/store.js';
import { blocksFromErp } from '../skills/buyer-magazine/scripts/from-erp.mjs';
import { renderIssue } from '../skills/buyer-magazine/scripts/render.mjs';
const now = Date.parse('2026-10-26T08:00:00Z');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'erp-magazine-')), store = new ErpStore(join(dir, 'erp.sqlite'), { clock: () => now });
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const write = b => store.write('workspace-test', b);
  write({ action: 'add_product', requestId: 'p', id: 'sku.one', name: 'Synthetic product <test>', currency: 'USD', unitPriceMinor: 1234, stockTotal: 10, source: '/private/company/price.xlsx?token=INTERNAL_ONLY' });
  write({ action: 'add_offer', requestId: 'o', id: 'offer', productId: 'sku.one', territory: 'US', channel: 'gift-retail', term: 'Synthetic term', conditions: 'Synthetic terms, no real business rights', capacity: 1, validUntil: '2026-10-27T08:00:00Z', source: '/private/supplier/agreement.pdf' });
  const supply = () => store.read('workspace-test', { entity: 'supply', id: 'sku.one', offerId: 'offer' });
  return { dir, store, write, supply };
}
const issue = blocks => ({ title: 'Synthetic integration check', audience: 'Test only', language: 'zh', preview: true, blocks });

test('real ledger snapshots assemble only selected modules in requested order, convert minor units and keep private provenance out of HTML', async t => {
  const f = await fixture(t), snapshot = f.supply();
  const result = blocksFromErp(snapshot, { modules: ['exclusive', 'procurement', 'product'] });
  assert.deepEqual(result.blocks.map(b => b.type), ['exclusive', 'procurement', 'product']);
  assert.equal(result.blocks[0].data.status, 'recorded'); assert.equal(result.blocks[0].data.slots, 1);
  assert.equal(result.provenance.productRevision, 1); assert.match(result.provenance.productSource, /INTERNAL_ONLY/);
  const html = renderIssue(issue(result.blocks)), doc = new JSDOM(html).window.document;
  assert.match(doc.body.textContent, /USD 12\.34/); assert.match(doc.body.textContent, /ERP 已登记/);
  assert.doesNotMatch(html, /INTERNAL_ONLY|\/private\/|供应商已确认以下权益条件/);
  assert.equal(doc.querySelectorAll('.action').length, 0); assert.equal(doc.querySelectorAll('test').length, 0);
  assert.equal(f.store.read('workspace-test', { entity: 'order' }).items.length, 0);
  assert.equal(f.supply().offer.availableSlots, 1);
  const single = blocksFromErp({ ...snapshot, offer: null }, { modules: ['product'] });
  assert.equal(single.blocks.length, 1); assert.equal(single.provenance.offerSource, undefined);
});

test('new snapshots reflect reservations and price revisions while old drafts stay snapshots, never live reservations', async t => {
  const f = await fixture(t), old = blocksFromErp(f.supply(), { modules: ['exclusive', 'procurement'], language: 'en' });
  f.write({ action: 'add_buyer', requestId: 'b', id: 'buyer', name: 'Synthetic buyer', contact: 'buyer@example.test' });
  const held = f.write({ action: 'reserve', requestId: 'r', productId: 'sku.one', buyerId: 'buyer', expectedRevision: 1, quantity: 2, offerId: 'offer' });
  f.write({ action: 'update_product', requestId: 'u', id: 'sku.one', expectedRevision: 1, unitPriceMinor: 2000, stockTotal: 10, source: 'Revised private source' });
  const fresh = blocksFromErp(f.supply(), { modules: ['exclusive', 'procurement'], language: 'en' });
  assert.equal(old.blocks[0].data.slots, 1); assert.equal(fresh.blocks[0].data.slots, 0);
  assert.match(fresh.blocks[1].data.terms[0], /USD 20\.00/); assert.equal(fresh.provenance.productRevision, 2);
  assert.match(fresh.blocks[1].data.terms[1], /8 units/);
  f.write({ action: 'cancel', requestId: 'c', orderId: held.id });
  assert.equal(blocksFromErp(f.supply(), { modules: ['exclusive'] }).blocks[0].data.slots, 1);
});

test('missing sources, unsupported modules, mixed snapshots, mismatched offers and impossible counts fail explicitly', async t => {
  const f = await fixture(t), s = f.supply(), pick = { modules: ['exclusive'] };
  for (const modules of [[], ['margin'], ['product', 'product']]) assert.throws(() => blocksFromErp(s, { modules }), /Select unique/);
  assert.throws(() => blocksFromErp({ ...s, offer: null }, pick), /requires an explicit/);
  assert.throws(() => blocksFromErp({ ...s, offer: { ...s.offer, productId: 'wrong' } }, pick), /must match/);
  assert.throws(() => blocksFromErp({ ...s, product: { ...s.product, asOf: 'other' } }, pick), /same supply snapshot/);
  assert.throws(() => blocksFromErp({ ...s, product: { ...s.product, source: '' } }, pick), /text required/);
  assert.throws(() => blocksFromErp({ ...s, offer: { ...s.offer, availableSlots: 2 } }, pick), /Invalid offer/);
  assert.throws(() => blocksFromErp({ ...s, offer: { ...s.offer, validUntil: '2026-10-25T00:00:00Z' } }, pick), /Expired offer/);
  assert.throws(() => blocksFromErp(s, { ...pick, blockPrefix: '<script>' }), /HTML-safe/);
});

test('file adapter produces renderable blocks without overwriting a previous delivery', async t => {
  const f = await fixture(t), snapshot = join(f.dir, 'snapshot.json'), selection = join(f.dir, 'selection.json'), output = join(f.dir, 'blocks.json');
  await writeFile(snapshot, JSON.stringify(f.supply())); await writeFile(selection, JSON.stringify({ modules: ['procurement'] }));
  const script = fileURLToPath(new URL('../skills/buyer-magazine/scripts/from-erp.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [script, snapshot, selection, output], { encoding: 'utf8' });
  const first = run(); assert.equal(first.status, 0, first.stderr);
  const bytes = await readFile(output, 'utf8'); assert.ok(renderIssue(issue(JSON.parse(bytes).blocks)).includes('12.34'));
  assert.notEqual(run().status, 0); assert.equal(await readFile(output, 'utf8'), bytes);
});
