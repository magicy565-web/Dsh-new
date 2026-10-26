import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderIssue } from '../skills/buyer-magazine/scripts/render.mjs';
import { economics } from '../skills/buyer-magazine/scripts/modules.mjs';
const fixture = JSON.parse(await readFile(new URL('../skills/buyer-magazine/templates/layout-preview.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(fixture);
const doc = issue => new JSDOM(renderIssue(issue)).window.document;
const block = (issue, type) => issue.blocks.find(b => b.type === type);

test('ten modules work alone; an issue includes only selected blocks in author order and supports repeated product modules', () => {
  for (const b of fixture.blocks) assert.equal(doc({ ...fresh(), blocks: [b] }).querySelectorAll('section').length, 1);
  const issue = fresh(); issue.blocks = [block(issue, 'sample'), block(issue, 'buyer-fit')];
  issue.blocks.push({ ...structuredClone(issue.blocks[0]), id: 'second-product-sample', product: 'Another product' });
  const d = doc(issue);
  assert.deepEqual([...d.querySelectorAll('section')].map(n => n.dataset.module), ['sample', 'buyer-fit', 'sample']);
  assert.equal(d.querySelectorAll('nav a').length, 3); assert.ok(!d.querySelector('[data-module="product"]'));
  issue.blocks[2].id = issue.blocks[0].id; assert.throws(() => renderIssue(issue), /duplicate/);
  assert.throws(() => renderIssue({ ...fresh(), blocks: [] }), /Select/);
  assert.throws(() => renderIssue({ ...fresh(), blocks: [{ id: 'a', type: 'unknown', data: {} }] }), /Unknown/);
});

test('profit uses selling price denominator, preserves losses and rejects missing, invalid or overflowed numeric inputs', () => {
  const d = block(fresh(), 'margin').data;
  assert.deepEqual(economics(d), { fee: 5, cost: 32, contribution: 18, contributionRate: 0.36 });
  assert.ok(economics({ ...d, purchaseCost: 60 }).contribution < 0);
  for (const patch of [{ freight: null }, { salePrice: 0 }, { duty: -1 }, { channelFeeRate: 10 }, { purchaseCost: Infinity }, { purchaseCost: Number.MAX_VALUE, freight: Number.MAX_VALUE }]) assert.throws(() => economics({ ...d, ...patch }));
  assert.match(renderIssue(fresh()), /36\.0%/);
});

test('historical sales bind each row to an accessible source and preserve estimate labels', () => {
  const issue = fresh(), b = block(issue, 'sales-history'), d = doc(issue);
  const sourceLink = d.querySelector(`#${b.id} .comparable a`);
  assert.ok(d.querySelector(sourceLink.getAttribute('href'))); assert.match(d.querySelector(`#${b.id}`).textContent, /估算销售额/);
  b.data.comparables[0].source = 42; assert.throws(() => renderIssue(issue), /evidence index/);
  b.data.comparables[0].source = 0; b.evidence[0].kind = 'estimated'; b.data.comparables[0].measurement = 'reported';
  assert.throws(() => renderIssue(issue), /Estimated evidence/);
  issue.preview = false; assert.throws(() => renderIssue(issue), /Illustrative/);
});

test('exclusive rights cannot imply local reservation; proposed, unavailable and preview actions differ', () => {
  const issue = fresh(); issue.preview = false;
  issue.blocks = [block(issue, 'exclusive')]; const b = issue.blocks[0]; b.evidence = [];
  b.data.actionUrl = 'https://supplier.example/reserve';
  assert.match(doc(issue).querySelector('.action').textContent, /洽谈/);
  b.data.status = 'confirmed'; assert.throws(() => renderIssue(issue), /supplier evidence/);
  b.evidence = [{ label: 'Fixture agreement', reference: 'Test fixture only', date: '2026-10-26', kind: 'provided' }];
  b.data.slots = 2; assert.throws(() => renderIssue(issue), /asOf/);
  b.data.asOf = '2026-10-26 10:00 UTC'; assert.match(doc(issue).querySelector('.action').textContent, /供应方/);
  b.data.slots = 0; assert.equal(doc(issue).querySelector('.action'), null);
  b.data.slots = 2; issue.preview = true; assert.equal(doc(issue).querySelector('.action'), null);
  assert.equal(doc(issue).querySelectorAll('script').length, 0);
});

test('untrusted text is escaped and executable or credentialed URLs are rejected', () => {
  const issue = fresh(); issue.title = '<script>alert(1)</script>';
  block(issue, 'product').data.summary = '<img src=x onerror=alert(1)>';
  const d = doc(issue); assert.equal(d.querySelectorAll('script,img').length, 0);
  assert.equal(d.querySelector('h1').textContent, issue.title);
  for (const href of ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.com']) {
    block(issue, 'sample').data.actionUrl = href; assert.throws(() => renderIssue(issue), /HTTP/);
  }
});

test('English issue uses localized module labels; comparison widths are checked', () => {
  const issue = fresh(); issue.language = 'en'; const d = doc(issue);
  assert.equal(d.documentElement.lang, 'en'); assert.match(d.querySelector('[data-module="margin"]').textContent, /Unit contribution/);
  block(issue, 'comparison').data.rows[0].pop(); assert.throws(() => renderIssue(issue), /widths differ/);
});

test('CLI delivers a real file and refuses to overwrite it on repeated creation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'magazine-render-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../skills/buyer-magazine/scripts/render.mjs', import.meta.url));
  const input = fileURLToPath(new URL('../skills/buyer-magazine/templates/layout-preview.json', import.meta.url));
  const output = join(dir, 'issue.html');
  const first = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' }); assert.equal(first.status, 0, first.stderr);
  const before = await readFile(output, 'utf8');
  const second = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' }); assert.notEqual(second.status, 0); assert.match(second.stderr, /EEXIST/);
  assert.equal(await readFile(output, 'utf8'), before);
});
