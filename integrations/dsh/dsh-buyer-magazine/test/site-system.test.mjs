import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFile(path.join(root, p), 'utf8');
test('site schemas are valid JSON and define required publication contracts', async () => {
  const manifest = JSON.parse(await read('schemas/site-manifest.schema.json'));
  const page = JSON.parse(await read('schemas/magazine-page.schema.json'));
  const evidence = JSON.parse(await read('schemas/site-evidence.schema.json'));
  const hosting = JSON.parse(await read('site-starter/.openai/hosting.json'));
  assert.equal(manifest.title, 'Buyer Magazine Site Manifest');
  assert.ok(manifest.required.includes('routes'));
  assert.ok(page.required.includes('evidence_refs'));
  assert.ok(page.required.includes('primary_cta'));
  assert.ok(evidence.required.includes('publication_permission'));
  assert.equal(hosting.d1, null);
  assert.equal(hosting.r2, null);
  assert.equal(Object.hasOwn(hosting, 'project_id'), false);
});
test('site skill pack registers all new publishing capabilities', async () => {
  const pack = JSON.parse(await read('skill-pack.json'));
  const names = new Set(pack.skills.map(x => x.name));
  for (const name of ['buyer-magazine-site','site-seo-geo','editorial-commerce-design','buyer-ai-assistant','site-release-qa']) assert.ok(names.has(name), name);
});
test('starter includes crawlable text, metadata and assistant UI without client secrets', async () => {
  const html = await read('site-starter/index.html');
  const js = await read('site-starter/assets/assistant.js');
  assert.match(html, /<title>/);
  assert.match(html, /name="description"/);
  assert.match(html, /<h1/);
  assert.match(html, /id="buyer-assistant"/);
  assert.match(js, /\/sessions/);
  assert.match(js, /\/chat/);
  assert.doesNotMatch(js, /(sk-[A-Za-z0-9]{12,}|APIFY_TOKEN|SHOPIFY_ADMIN_ACCESS_TOKEN)/);
});
