import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileDraft, validateIssueJson } from '../compiler.js';
import { normalizeModuleIssue } from '../adapters.js';
import { renderIssue } from '../cli.js';
import { issueFixture, now } from './fixture.mjs';
const fixture = JSON.parse(await readFile(new URL('../skills/buyer-magazine/templates/layout-preview.json', import.meta.url), 'utf8'));

test('both former input paths use the same canonical compiler, themes and native draft boundary', () => {
  const canonical = normalizeModuleIssue(fixture);
  assert.equal(canonical.composition, 'modules');
  assert.deepEqual(canonical.products, []); assert.deepEqual(canonical.sources, []);
  for (const theme of ['porcelain', 'atelier', 'foundry', 'fieldnotes']) {
    const legacy = { ...fixture, theme }, normalized = normalizeModuleIssue(legacy);
    const a = compileDraft(JSON.stringify(legacy)), b = compileDraft(JSON.stringify(normalized));
    assert.deepEqual(a, b);
    assert.equal(a.data.toString(), renderIssue(legacy));
    assert.match(a.data.toString(), new RegExp(`data-theme="${theme}"`));
    assert.match(a.data.toString(), /DRAFT FOR REVIEW|审阅稿/);
    assert.equal(a.externalImageCount, 0);
  }
  assert.equal(validateIssueJson(JSON.stringify(issueFixture()), { now }).valid, true);
});

test('module input retains ordering and evidence but cannot bypass native public URL and image rules', () => {
  for (const url of ['http://example.com/p.jpg', 'https://127.0.0.1/p.jpg', 'https://example.com/p.jpg?token=secret']) {
    const issue = structuredClone(fixture); issue.blocks[0].data.imageUrl = url;
    assert.throws(() => compileDraft(JSON.stringify(issue)), { code: 'MAGAZINE_ISSUE_INVALID' });
  }
  const issue = structuredClone(fixture);
  issue.blocks[0].data.imageUrl = 'https://example.com/p.jpg'; issue.blocks[0].data.imageAlt = 'Synthetic product image';
  assert.throws(() => renderIssue(issue), /reuse rights/);
  issue.blocks[0].data.imageRights = 'permission'; issue.blocks[0].data.imageGenerated = false;
  assert.equal(compileDraft(JSON.stringify(issue)).externalImageCount, 1);
  const canonical = normalizeModuleIssue(issue); canonical.blocks[0].data.imageRights = 'unknown';
  assert.equal(validateIssueJson(JSON.stringify(canonical)).valid, false);
  canonical.blocks[0].data.imageRights = 'permission'; canonical.blocks[0].evidence[0].date = '2099-01-01';
  assert.equal(validateIssueJson(JSON.stringify(canonical)).valid, false);
});

test('missing metadata stays unknown and adapters reject accidentally included internal provenance', () => {
  const issue = { title: 'A selected note', audience: 'A stated reader', language: 'en', blocks: [{ id: 'note', type: 'opportunity', data: { signals: ['A supplied observation'], interpretation: 'Editorial inference', uncertainties: ['Source requires follow-up'] } }] };
  const canonical = normalizeModuleIssue(issue);
  assert.equal(canonical.date, ''); assert.equal(canonical.provenance.collectedAt, '');
  assert.doesNotMatch(renderIssue(issue), /1970|Invalid Date|undefined/);
  assert.throws(() => renderIssue({ ...issue, provenance: { path: '/private/source' } }), /unrecognized/);
});

test('standalone bundle owns its preset, Skill, tools and assets without business-plugin dependencies', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(manifest.dependencies), ['playwright-core']);
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.match(patch, /name: 网站转杂志/); assert.match(patch, /name: dsh-buyer-magazine/);
  assert.match(patch, /customSkillDirs:/); assert.match(patch, /dsh-tool-web/); assert.match(patch, /dsh-tool-present/);
  assert.doesNotMatch(patch, /dsh-sourcing-agent|dsh-mini-erp|dsh-tool-bash|dsh-tool-pwsh|disabled: true/);
  const skill = await readFile(new URL('../skills/buyer-magazine/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /name: buyer-magazine\n/); assert.match(skill, /buyer_magazine_generate/);
});

test('self-repair diagnostics identify known fields without reflecting input keys or source secrets', () => {
  const issue = issueFixture(); issue.products[0].moq.value = 100;
  const report = validateIssueJson(JSON.stringify(issue), { now });
  assert.equal(report.valid, false);
  assert(report.issues.some(error => error.path === 'products.0.moq.value'));
  issue['PRIVATE_SECRET_FIELD'] = 'private-secret-value';
  issue.products[0].sourceIds = ['SECRET_SOURCE_IDENTIFIER'];
  const publicReport = JSON.stringify(validateIssueJson(JSON.stringify(issue), { now }));
  assert.doesNotMatch(publicReport, /PRIVATE_SECRET_FIELD|private-secret-value|SECRET_SOURCE_IDENTIFIER/);
});
