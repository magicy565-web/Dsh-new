import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compileDraft, failure, inspectIssue, MAX_INPUT_BYTES, MAX_HTML_BYTES } from '../src/core.js';
import { magazineTools } from '../src/tools.js';
import { generateInSession } from '../src/native-files.js';
import { memoryHost } from './native-fixture.mjs';
import { issueFixture, json, now } from './fixture.mjs';
const options = { now };
async function rejectedBeforeWrite(issue, code) {
  const host = memoryHost();
  await assert.rejects(generateInSession(host.ctx, typeof issue === 'string' ? issue : json(issue), host.exec), error => failure(error).code === code);
  assert.equal(host.state.writes, 0);
}

test('no-image draft is deterministic and retains full templates/evidence/draft restrictions', () => {
  const a = compileDraft(json(issueFixture()), options), b = compileDraft(json(issueFixture()), options);
  assert.deepEqual(a, b); assert.ok(a.data.length < MAX_HTML_BYTES); assert.match(a.name, /^buyer-magazine-[A-Za-z0-9_-]+-[a-f0-9]{12}\.html$/);
  const html = a.data.toString();
  for (const text of ['DRAFT FOR REVIEW', 'DEMONSTRATION', 'Retail reference · not wholesale', 'Not disclosed', 'Synthetic product evidence', 'comparison-dialog', 'source-record', 'localStorage', 'Download request brief']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<img\b|<script[^>]+src=|<link[^>]+stylesheet|@import|fetch\(|XMLHttpRequest|WebSocket/);
  assert.equal(a.externalImageCount, 0);
});
test('four existing archetypes are preserved', () => {
  for (const theme of ['porcelain', 'atelier', 'foundry', 'fieldnotes']) {
    const issue = issueFixture(); issue.theme = theme;
    assert.ok(compileDraft(json(issue), options).data.toString().includes(`data-theme="${theme}"`));
  }
});
test('upstream bytes match originals or explicitly recorded composition/price patches', async () => {
  const manifest = JSON.parse(await readFile(new URL('../docs/upstream-provenance.json', import.meta.url), 'utf8'));
  assert.equal(manifest.files.length, 7);
  assert.equal(manifest.files.filter(file => file.patch).length, 4);
  for (const file of manifest.files) {
    const data = await readFile(new URL('../' + file.target, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), file.patch?.sha256 || file.sha256);
    assert.equal(data.length, file.patch?.bytes || file.bytes);
    if (file.patch) { assert.match(file.patch.reason, /price/); assert.notEqual(file.patch.sha256, file.sha256); }
  }
});
test('explicitly permission-declared HTTPS image is retained, never fetched', () => {
  const issue = issueFixture(); issue.products[0].image = { src: 'https://example.com/product.jpg', alt: 'Synthetic fixture', rights: 'permission', generated: false, role: 'product', sourceId: 's1' };
  const result = compileDraft(json(issue), options); assert.equal(result.externalImageCount, 1);
  assert.ok(result.data.toString().includes('src="https://example.com/product.jpg"'));
});
for (const src of ['assets/photo.jpg', '/etc/passwd', '../photo.png', 'file:///tmp/photo.jpg', 'data:image/png;base64,AAAA', 'http://example.com/photo.jpg', 'https://127.0.0.1/photo.jpg', 'https://example.com/photo.jpg?token=secret']) {
  test(`non-supported image input is explicitly refused: ${src.split('?')[0]}`, async () => {
    const issue = issueFixture(); issue.cover.image = { src, alt: 'Synthetic', rights: 'permission', generated: false, role: 'editorial' };
    await rejectedBeforeWrite(issue, 'MAGAZINE_LOCAL_ASSET_UNSUPPORTED');
  });
}
for (const [label, mutate] of [
  ['unresolved rights', i => { i.products[0].image = { src: 'https://example.com/p.jpg', alt: 'Test', rights: 'unknown', generated: false, role: 'product', sourceId: 's1' }; }],
  ['generated product evidence', i => { i.products[0].image = { src: 'https://example.com/p.jpg', alt: 'Test', rights: 'owned', generated: true, role: 'product', sourceId: 's1' }; }],
  ['unknown term asserted as a number', i => { i.products[0].moq.value = 100; }],
  ['wholesale without minimum quantity', i => { i.products[0].price.kind = 'wholesale'; }],
  ['unknown price with amount', i => { i.products[0].price.kind = 'unknown'; }],
  ['restricted specification', i => { i.products[0].specs[0].visibility = 'restricted'; }],
  ['internal evidence', i => { i.sources[0].kind = 'internal'; }],
  ['missing source reference', i => { i.products[0].sourceIds = ['missing']; }],
  ['demo mismatch', i => { i.provenance.mode = 'live'; }],
  ['invalid calendar date', i => { i.date = '2026-99-99'; }],
  ['future source timestamp', i => { i.sources[0].accessedAt = '2099-01-01T00:00:00Z'; }],
  ['future collection timestamp', i => { i.provenance.collectedAt = '2099-01-01T00:00:00Z'; }],
  ['unrecognized input key', i => { i.secretNativePath = '/private-synthetic-path'; }],
]) test(`${label}: validation failure writes zero files`, async () => { const issue = issueFixture(); mutate(issue); await rejectedBeforeWrite(issue, 'MAGAZINE_ISSUE_INVALID'); });
test('invalid JSON and UTF-8 byte overflow are bounded before write', async () => {
  await rejectedBeforeWrite('{', 'MAGAZINE_INPUT_INVALID');
  await rejectedBeforeWrite('"' + '界'.repeat(Math.ceil(MAX_INPUT_BYTES / 3)) + '"', 'MAGAZINE_INPUT_INVALID');
  await rejectedBeforeWrite('[]', 'MAGAZINE_INPUT_INVALID');
});
test('malicious issue text stays inert in HTML and client JSON', () => {
  const issue = issueFixture(); issue.products[0].name = '</script><script>globalThis.secret=1</script>';
  const html = compileDraft(json(issue), options).data.toString();
  assert.doesNotMatch(html, /<script>globalThis\.secret/); assert.match(html, /&lt;\/script&gt;/); assert.match(html, /\\u003c\/script>/);
});
test('cancelled generation makes zero write calls', async () => {
  const host = memoryHost(); host.controller.abort(new Error('/synthetic-secret'));
  await assert.rejects(generateInSession(host.ctx, json(issueFixture()), host.exec), e => failure(e).code === 'MAGAZINE_CANCELLED');
  assert.equal(host.state.writes, 0);
});
test('native tool contract generates a file and leaves official present separate', async () => {
  const host = memoryHost(); const [validate, generate] = magazineTools(host.ctx);
  const result = await validate.execute({ issueJson: json(issueFixture()) }); assert.equal(result.valid, true);
  assert.deepEqual(Object.keys(result), ['valid', 'errorCount', 'warningCount', 'issues']);
  const generated = await generate.execute({ issueJson: json(issueFixture()) }, host.exec);
  assert.equal(generated.status, 'generated'); assert.equal(generated.presentation, 'pending-official-present');
  assert.equal(host.state.writes, 1); assert.equal(generate.timeoutMs, undefined);
  assert.deepEqual(generate.output.render({}, generated).map(b => b.type), ['text']);
  assert.equal(inspectIssue(json(issueFixture()), options).valid, true);
});
