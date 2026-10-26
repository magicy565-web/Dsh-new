import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as compiler from 'dsh-buyer-magazine/compiler';
import { issueFixture, json, now } from './fixture.mjs';

test('package exports a bounded pure compiler surface without a storage seam', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.exports['./compiler'], './compiler.js');
  assert.ok(manifest.files.includes('compiler.js'));
  assert.deepEqual(Object.keys(compiler).sort(), ['MAX_HTML_BYTES', 'MAX_INPUT_BYTES', 'compileDraft', 'validateIssueJson'].sort());
  for (const hidden of ['compileAndStoreDraft', 'inspectIssue', 'requireNativeDelivery', 'failure']) assert.equal(compiler[hidden], undefined);
});
test('public package self-reference compiles without importing the native SDK', () => {
  const result = compiler.compileDraft(json(issueFixture()), { now });
  assert.ok(Buffer.isBuffer(result.data));
  assert.ok(result.data.length > 0 && result.data.length <= compiler.MAX_HTML_BYTES);
  assert.match(result.name, /^buyer-magazine-[a-zA-Z0-9_-]+-[a-f0-9]{12}\.html$/);
  assert.equal(result.draftOnly, true); assert.equal(result.externalImageCount, 0);
  assert.deepEqual(result, compiler.compileDraft(json(issueFixture()), { now }));
  const later = compiler.compileDraft(json(issueFixture()), { now: new Date('2026-11-26T00:00:00Z') });
  assert.deepEqual(later.data, result.data); assert.equal(later.sha256, result.sha256); assert.equal(later.name, result.name);
  assert.ok(later.warningCount > result.warningCount, 'validation-time freshness warnings may change without changing the HTML or filename');
  assert.match(result.data.toString('utf8'), /DRAFT FOR REVIEW/);
  assert.equal(result.attachment, undefined); assert.equal(result.nativePath, undefined);
});
test('public validation returns report metadata, not issue contents or delivery claims', () => {
  const result = compiler.validateIssueJson(json(issueFixture()), { now });
  assert.deepEqual(Object.keys(result), ['valid', 'errorCount', 'warningCount', 'issues', 'stats']);
  assert.equal(result.valid, true); assert.equal(result.errorCount, 0);
  const invalid = issueFixture(); invalid.products[0].moq.value = 100;
  assert.equal(compiler.validateIssueJson(json(invalid), { now }).valid, false);
  assert.throws(() => compiler.compileDraft(json(invalid), { now }), { code: 'MAGAZINE_ISSUE_INVALID' });
});
test('package resolver refuses private storage and tool module paths', async () => {
  for (const specifier of ['dsh-buyer-magazine/src/core.js', 'dsh-buyer-magazine/src/tools.js', 'dsh-buyer-magazine/compiler.js']) {
    await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  }
});

test('package manifest anchor resolves for the official Skill root expression', async () => {
  const target = import.meta.resolve('dsh-buyer-magazine/package.json');
  assert.equal(target, new URL('../package.json', import.meta.url).href);
  const manifest = JSON.parse(await readFile(new URL(target), 'utf8'));
  assert.equal(manifest.name, 'dsh-buyer-magazine');
  assert.equal(manifest.exports['./package.json'], './package.json');
  assert.ok(manifest.files.includes('skills/'));
});
test('official Skill discovery remains explicitly opt-in and skips without SDK', () => {
  const script = fileURLToPath(new URL('./skill-discovery-sdk.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], {encoding: 'utf8', timeout: 10000});
  assert.equal(result.status, 0);
  assert.match(result.stdout, /SKIP:.*no SDK was imported/);
  const rejected = spawnSync(process.execPath, [script, 'relative-runtime'], {encoding: 'utf8', timeout: 10000});
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /explicit and absolute/);
});
