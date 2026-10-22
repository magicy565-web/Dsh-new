import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHarness } from '../../../packages/harness-kernel/src/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const admin = { subject: 'local-operator', role: 'admin' };
const viewer = { subject: 'viewer-1', role: 'viewer' };

const reviewDocument = (overrides = {}) => ({
  generatedAt: new Date().toISOString(),
  composition: { name: 'review-fixture', file: 'harness.yml', digest: 'a'.repeat(64) },
  summary: { rows: 2, enabled: 2, disabled: 0, services: ['storage'] },
  verdict: 'ready',
  blockers: [],
  ...overrides,
});

async function fixture(t, { reviewFile = true, config = {}, document = reviewDocument() } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-review-plugin-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const reviewPath = path.join(directory, 'review.json');
  if (reviewFile) await fs.writeFile(reviewPath, JSON.stringify(document), 'utf8');
  const composition = path.join(directory, 'harness.yml');
  await fs.writeFile(composition, [
    'version: 1', 'name: review-plugin', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: review', '    name: workspace-harness-review',
    `    config: ${JSON.stringify({ reviewFile: reviewPath, ...config })}`,
    '',
  ].join('\n'), 'utf8');
  const harness = await createHarness({ compositionPath: composition, root: ROOT });
  const started = await harness.start();
  t.after(async () => { await harness.stop(); });
  const request = async (asActor = admin) => {
    const response = await fetch(`${started.address.url}/api/harness/review`, {
      headers: { 'x-harness-actor': asActor.subject, 'x-harness-role': asActor.role },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return { harness, request, reviewPath, directory };
}

test('an admin reads the review snapshot through the harness route', async t => {
  const { harness, request } = await fixture(t);
  const response = await request(admin);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.state, 'ok');
  assert.equal(response.body.review.verdict, 'ready');
  assert.match(response.body.review.composition.digest, /^a{64}$/u);
  assert.match(response.body.generatedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.ok(response.body.file.endsWith('review.json'));

  const health = harness.healthz();
  const check = health.checks.find(item => item.name === 'harness-review');
  assert.equal(check.status, 'ok');
  assert.equal(check.detail.verdict, 'ready');
  assert.equal(health.status, 'ok');
});

test('a non-admin is refused with 403 and never sees the document', async t => {
  const { request } = await fixture(t);
  const response = await request(viewer);
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'HARNESS_TOOL_REFUSED');
  assert.equal(response.body.review, undefined);
});

test('a missing review file degrades health and answers 503 honestly', async t => {
  const { harness, request } = await fixture(t, { reviewFile: false });
  const response = await request(admin);
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'HARNESS_REVIEW_UNAVAILABLE');
  assert.equal(response.body.state, 'missing');
  assert.match(response.body.error.message, /not found/u);
  const check = harness.healthz().checks.find(item => item.name === 'harness-review');
  assert.equal(check.status, 'degraded');
  assert.equal(check.detail.state, 'missing');
  assert.equal(harness.healthz().status, 'degraded');
});

test('a stale or malformed review file is reported, not served as fresh', async t => {
  const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const stale = await fixture(t, { config: { maxAgeHours: 1 }, document: reviewDocument({ generatedAt: old }) });
  const staleResponse = await stale.request(admin);
  assert.equal(staleResponse.status, 503);
  assert.equal(staleResponse.body.state, 'stale');
  assert.match(staleResponse.body.error.message, /older than 1h/u);

  const broken = await fixture(t, { document: reviewDocument() });
  await fs.writeFile(broken.reviewPath, '{not json', 'utf8');
  const brokenResponse = await broken.request(admin);
  assert.equal(brokenResponse.status, 503);
  assert.equal(brokenResponse.body.state, 'invalid');
  assert.match(brokenResponse.body.error.message, /not valid JSON/u);
});

test('the plugin validates its configuration instead of guessing a file', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-review-badcfg-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const composition = path.join(directory, 'harness.yml');
  await fs.writeFile(composition, [
    'version: 1', 'name: bad-config', 'server: { host: 127.0.0.1, port: 0 }', 'plugins:',
    '  - id: review', '    name: workspace-harness-review', '    config: { maxAgeHours: 2 }',
    '',
  ].join('\n'), 'utf8');
  await assert.rejects(createHarness({ compositionPath: composition, root: ROOT }), error => error.code === 'HARNESS_MANIFEST_INVALID');
});
