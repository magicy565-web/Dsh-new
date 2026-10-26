import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { apply, loadSkills, parseSkill } from '../index.js';
const root = fileURLToPath(new URL('../', import.meta.url));

test('all seven methods load independently with valid resource bases and usable template references', () => {
  const warnings = [], skills = loadSkills(join(root, 'skills'), { warn: text => warnings.push(text) });
  assert.equal(skills.length, 7); assert.deepEqual(warnings, []);
  for (const skill of skills) {
    assert.match(skill.name, /^[a-z]+(?:-[a-z]+)*$/u);
    assert.ok(skill.description && skill.whenToUse && skill.content);
    assert.equal(parseSkill(readFileSync(join(skill.resourceBase.path, 'SKILL.md'), 'utf8')).fields.name, skill.name);
    for (const match of skill.content.matchAll(/templates\/[a-z0-9-]+\.(?:md|csv)/gu)) assert.ok(existsSync(join(skill.resourceBase.path, match[0])), match[0]);
    assert.doesNotMatch(skill.content, /sourcing_\w+|sourcing\/<slug>/u);
  }
});
test('provider contributes skills without invoking data, tool or model services and disposes them', () => {
  const registered = new Map();
  const dispose = apply({ skills: { register(skill) { registered.set(skill.name, skill); return () => registered.delete(skill.name); } },
    tools: { register() { assert.fail('Skill provider must not register business tools'); } }, logger: { info() {}, warn() {} } });
  assert.equal(registered.size, 7); dispose(); assert.equal(registered.size, 0);
});
test('bad instruction files are diagnosed without discarding other usable methods; public bundle remains installable', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sourcing-skills-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'sourcing')); writeFileSync(join(dir, 'sourcing/SKILL.md'), '---\nname: sourcing\ndescription: valid\n---\nBody');
  mkdirSync(join(dir, 'dtc-brand')); writeFileSync(join(dir, 'dtc-brand/SKILL.md'), 'invalid');
  const warnings = []; assert.equal(loadSkills(dir, { warn: value => warnings.push(value) }).length, 1); assert.equal(warnings.length, 6);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const target of Object.values(manifest.exports)) if (!target.includes('*')) assert.ok(existsSync(join(root, target)));
  const patch = readFileSync(join(root, manifest.dsh.bundle.patch), 'utf8');
  assert.doesNotMatch(patch, /@local\/dsh-sourcing-agent\/tools|sourcing_project|sourcing_stage/u);
  assert.ok(patch.includes("name: '@local/dsh-sourcing-agent'"));
});
