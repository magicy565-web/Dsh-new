// Skills seam tests: validated registration, bounded bodies, strict SKILL.md
// discovery, symlink refusal, deterministic lists, close semantics and a real
// kernel mount with a temp composition containing only the skills row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_SKILLS,
  SKILL_ERROR,
  createSkills,
  createSkillsProvider,
  parseSkillDocument,
} from '../src/skills.mjs';
import { ERROR } from '../../harness-contracts/src/index.mjs';
import { createHarness } from '../../harness-kernel/src/app.mjs';
import { harnessError, makeTempDirectory, removeDirectory } from './helpers.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SILENT_LOGGER = Object.freeze({ error() {}, warn() {}, info() {}, debug() {} });

const skill = (overrides = {}) => ({
  name: 'demo-skill',
  description: 'A demo skill',
  body: '# Demo\n\nUse the demo safely.\n',
  source: 'test:demo-skill',
  ...overrides,
});

const frontmatter = ({ name, description }) => `---\nname: ${name}\ndescription: ${description}\n---`;

/** Write `<root>/<directory>/SKILL.md` and return the skill directory. */
async function writeSkill(root, directory, { name, description }, body = '# Body\n') {
  const target = path.join(root, directory);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'SKILL.md'), `${frontmatter({ name, description })}\n${body}`, 'utf8');
  return target;
}

test('register validates skills and list returns bounded detached summaries', () => {
  const skills = createSkills();
  const record = skills.register(skill());
  assert.equal(record.name, 'demo-skill');
  assert.equal(record.pluginId, null);
  assert.equal(record.bytes, Buffer.byteLength(skill().body, 'utf8'));

  const listed = skills.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(Object.keys(listed[0]).sort(), ['bytes', 'description', 'name', 'pluginId', 'source']);
  assert.deepEqual(listed[0], {
    name: 'demo-skill',
    description: 'A demo skill',
    source: 'test:demo-skill',
    pluginId: null,
    bytes: record.bytes,
  });
  // Summaries are detached records, not the registry entries.
  assert.equal(listed[0].body, undefined);
  assert.equal(listed[0].handler, undefined);

  // Invalid registration payloads all fail closed with HARNESS_SKILL_INVALID.
  for (const payload of [
    null,
    skill({ name: 'Not Valid' }),
    skill({ description: '' }),
    skill({ description: 'two\nlines' }),
    skill({ body: 42 }),
    skill({ source: '' }),
    skill({ pluginId: 'Not An Id' }),
  ])
    assert.throws(() => skills.register(payload), harnessError(ERROR.skillInvalid), JSON.stringify(payload));

  // pluginId is optional metadata and filters the summaries.
  const owned = skills.register(skill({ name: 'owned-skill', pluginId: 'workspace-inquiry-recovery' }));
  assert.equal(owned.pluginId, 'workspace-inquiry-recovery');
  assert.deepEqual(
    skills.list({ pluginId: 'workspace-inquiry-recovery' }).map(item => item.name),
    ['owned-skill'],
  );
  assert.equal(skills.list({ limit: 1 }).length, 1);
  assert.throws(() => skills.list({ pluginId: 'Not An Id' }), harnessError(ERROR.skillInvalid));
  assert.throws(() => skills.list({ limit: 0 }), harnessError(ERROR.skillInvalid));
});

test('duplicate names are refused with HARNESS_SKILL_DUPLICATE', () => {
  const skills = createSkills();
  skills.register(skill());
  assert.throws(() => skills.register(skill()), harnessError(ERROR.skillDuplicate));
  assert.throws(() => skills.register(skill({ source: 'test:other' })), harnessError(ERROR.skillDuplicate));
  assert.equal(skills.list().length, 1, 'a refused duplicate does not change the registry');
});

test('load returns the body; unknown names fail with HARNESS_SKILL_NOT_FOUND', () => {
  const skills = createSkills();
  skills.register(skill());
  assert.deepEqual(skills.load('demo-skill'), {
    name: 'demo-skill',
    description: 'A demo skill',
    body: skill().body,
    source: 'test:demo-skill',
  });
  assert.throws(() => skills.load('missing-skill'), harnessError(SKILL_ERROR.notFound));
  assert.throws(() => skills.remove('missing-skill'), harnessError(SKILL_ERROR.notFound));
  assert.equal(skills.remove('demo-skill'), true);
  assert.deepEqual(skills.list(), []);
  assert.throws(() => skills.load('demo-skill'), harnessError(SKILL_ERROR.notFound));
});

test('registry and body limits are enforced (maxSkills, maxBytes)', () => {
  const skills = createSkills({ maxSkills: 2, maxBytes: 8 });
  skills.register(skill({ name: 'one-skill', body: '12345678' }));
  skills.register(skill({ name: 'two-skill', body: '' }));
  assert.throws(() => skills.register(skill({ name: 'three-skill', body: 'x' })), harnessError(SKILL_ERROR.limit));
  assert.throws(() => skills.register(skill({ name: 'big-skill', body: '123456789' })), harnessError(SKILL_ERROR.tooLarge));
  assert.equal(skills.list().length, 2);
  assert.equal(DEFAULT_MAX_SKILLS, 200);
  assert.equal(DEFAULT_MAX_BYTES, 64 * 1024);
});

test('list order is deterministic and independent of registration order', () => {
  const forward = createSkills();
  for (const name of ['zulu-skill', 'alpha-skill', 'mike-skill'])
    forward.register(skill({ name, source: `test:${name}` }));
  const backward = createSkills();
  for (const name of ['mike-skill', 'alpha-skill', 'zulu-skill'])
    backward.register(skill({ name, source: `test:${name}` }));
  const expected = ['alpha-skill', 'mike-skill', 'zulu-skill'];
  assert.deepEqual(forward.list().map(item => item.name), expected);
  assert.deepEqual(backward.list().map(item => item.name), expected);
  assert.deepEqual(forward.list({ limit: 2 }).map(item => item.name), ['alpha-skill', 'mike-skill']);
});

test('scan discovers valid SKILL.md files and reports a malformed one as an error entry', async t => {
  const directory = await makeTempDirectory('seams-skills-scan');
  removeDirectory(t, directory);
  const root = path.join(directory, 'skills');
  const alpha = await writeSkill(root, 'alpha', { name: 'alpha-skill', description: 'Alpha skill' }, '# Alpha\n');
  const broken = path.join(root, 'broken');
  await fs.mkdir(broken, { recursive: true });
  await fs.writeFile(path.join(broken, 'SKILL.md'), '---\nname: broken-skill\n---\n\nmissing description\n', 'utf8');
  await fs.mkdir(path.join(root, 'not-a-skill'), { recursive: true }); // no SKILL.md: ignored

  // Confinement: a static root only sees its own SKILL.md, not its siblings.
  const confined = createSkills({ roots: [alpha] });
  const confinedResult = await confined.scan();
  assert.deepEqual(confinedResult.errors, []);
  assert.deepEqual(confinedResult.skills.map(item => item.name), ['alpha-skill']);

  const skills = createSkills({ roots: [path.join(root, '*')] });
  const result = await skills.scan();
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, ERROR.skillInvalid);
  assert.match(result.errors[0].message, /description is required/iu);
  assert.ok(result.errors[0].source.endsWith('broken/SKILL.md'), result.errors[0].source);
  assert.deepEqual(result.skills.map(item => item.name), ['alpha-skill']);
  assert.equal(skills.list().length, 1);
  assert.equal(skills.load('alpha-skill').body, '# Alpha\n');
  assert.equal(skills.list()[0].pluginId, null, 'fixture roots outside plugins/ have no plugin id');

  // Rescanning the same source refreshes in place instead of reporting duplicates;
  // the malformed file keeps being reported (scan never hides broken skills).
  const again = await skills.scan();
  assert.equal(again.errors.length, 1);
  assert.equal(again.errors[0].code, ERROR.skillInvalid);
  assert.deepEqual(again.skills.map(item => item.name), ['alpha-skill']);
  assert.equal(skills.list().length, 1);
});

test('scan rejects duplicate skill names across roots', async t => {
  const directory = await makeTempDirectory('seams-skills-duplicate');
  removeDirectory(t, directory);
  const first = path.join(directory, 'first');
  const second = path.join(directory, 'second');
  await writeSkill(first, 'copy', { name: 'same-skill', description: 'First copy' }, '# First\n');
  await writeSkill(second, 'copy', { name: 'same-skill', description: 'Second copy' }, '# Second\n');
  const skills = createSkills({ roots: [path.join(first, '*'), path.join(second, '*')] });
  const result = await skills.scan();
  assert.deepEqual(result.skills.map(item => item.name), ['same-skill']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, ERROR.skillDuplicate);
  assert.equal(skills.list().length, 1);
  assert.equal(skills.load('same-skill').body, '# First\n', 'first root wins deterministically');
});

test('scan enforces the body size cap on discovered SKILL.md files', async t => {
  const directory = await makeTempDirectory('seams-skills-size');
  removeDirectory(t, directory);
  const root = path.join(directory, 'skills');
  await writeSkill(root, 'big', { name: 'big-skill', description: 'Big skill' }, `${'x'.repeat(64)}\n`);
  const skills = createSkills({ roots: [path.join(root, '*')], maxBytes: 32 });
  const result = await skills.scan();
  assert.equal(result.skills.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, SKILL_ERROR.tooLarge);
  assert.equal(skills.list().length, 0);
});

test('scan refuses symbolic links (skipped when symlink creation is unavailable)', async t => {
  const directory = await makeTempDirectory('seams-skills-symlink');
  removeDirectory(t, directory);
  const root = path.join(directory, 'skills');
  const real = await writeSkill(root, 'real', { name: 'real-skill', description: 'Real skill' }, '# Real\n');
  const linked = path.join(root, 'linked');
  try {
    await fs.symlink(real, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'EINVAL'].includes(error?.code)) {
      t.skip(`symlink creation is unavailable on this platform (${error.code}); symlink refusal not exercised`);
      return;
    }
    throw error;
  }
  const linkStats = await fs.lstat(linked);
  if (!linkStats.isSymbolicLink()) {
    t.skip('the platform created a non-link reparse point; symlink refusal not exercised');
    return;
  }
  const skills = createSkills({ roots: [path.join(root, '*')] });
  const result = await skills.scan();
  assert.deepEqual(result.skills.map(item => item.name), ['real-skill']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, SKILL_ERROR.rootInvalid);
  assert.ok(result.errors[0].source.endsWith('linked'), result.errors[0].source);
  assert.match(result.errors[0].message, /symbolic links?/iu);
  assert.equal(skills.list().length, 1);
});

test('scan roots are validated and confined (relative roots may not escape the repo)', () => {
  assert.throws(() => createSkills({ roots: 'plugins/*/skills/*' }), harnessError(SKILL_ERROR.rootInvalid));
  assert.throws(() => createSkills({ roots: ['../outside'] }), harnessError(SKILL_ERROR.rootInvalid));
  assert.throws(() => createSkills({ roots: [''] }), harnessError(SKILL_ERROR.rootInvalid));
  assert.throws(() => createSkills({ roots: ['plugins/**/skills/*'] }), harnessError(SKILL_ERROR.rootInvalid));
  const skills = createSkills();
  assert.equal(skills.roots.length, 1);
  assert.ok(skills.roots[0].startsWith(REPO_ROOT), 'default roots resolve against the repository root');
});

test('default roots discover the repository skill and its plugin id', async () => {
  const skills = createSkills();
  const result = await skills.scan();
  const names = result.skills.map(item => item.name);
  assert.ok(names.includes('historical-inquiry-recovery'), `expected the repository skill, got ${names.join(', ')}`);
  const ownedErrors = result.errors.filter(error => /workspace-inquiry-recovery/u.test(error.source));
  assert.deepEqual(ownedErrors, [], 'the repository skill parses cleanly');
  const listed = skills.list().find(item => item.name === 'historical-inquiry-recovery');
  assert.equal(listed.pluginId, 'workspace-inquiry-recovery');
  assert.ok(listed.source.endsWith('plugins/workspace-inquiry-recovery/skills/inquiries/SKILL.md'), listed.source);
  assert.match(skills.load('historical-inquiry-recovery').body, /询盘/u);
});

test('close() is idempotent and closes the service to further use', async () => {
  const skills = createSkills();
  skills.register(skill());
  skills.close();
  skills.close();
  assert.throws(() => skills.register(skill({ name: 'second-skill' })), harnessError(SKILL_ERROR.closed));
  assert.throws(() => skills.list(), harnessError(SKILL_ERROR.closed));
  assert.throws(() => skills.load('demo-skill'), harnessError(SKILL_ERROR.closed));
  assert.throws(() => skills.remove('demo-skill'), harnessError(SKILL_ERROR.closed));
  await assert.rejects(skills.scan(), harnessError(SKILL_ERROR.closed));
});

test('createSkillsProvider publishes ctx.skills, refuses overwrite and closes on dispose', async () => {
  const ctx = {};
  const provider = createSkillsProvider({ maxBytes: 16 });
  const dispose = await provider.apply(ctx, {});
  const service = ctx.skills;
  service.register(skill({ body: '1234' }));
  assert.equal(service.list().length, 1);

  await assert.rejects(createSkillsProvider().apply({ skills: {} }, {}), harnessError(ERROR.pluginDuplicate));

  await dispose();
  assert.equal(ctx.skills, undefined, 'the plain test context entry is removed on dispose');
  assert.throws(() => service.list(), harnessError(SKILL_ERROR.closed), 'dispose closes the service');
});

test('the real kernel mounts ctx.skills from a temp composition with only the skills row', async t => {
  const directory = await makeTempDirectory('seams-skills-kernel');
  removeDirectory(t, directory);
  const skillsRoot = path.join(directory, 'skills');
  await writeSkill(skillsRoot, 'mounted', { name: 'mounted-skill', description: 'Mounted through the kernel' }, '# Mounted\n');
  const rootPattern = path.join(skillsRoot, '*');
  const compositionPath = path.join(directory, 'skills.composition.yml');
  await fs.writeFile(
    compositionPath,
    [
      'version: 1',
      'name: skills-integration',
      'server: { host: 127.0.0.1, port: 0 }',
      'plugins:',
      '  - id: skills',
      '    name: "@workspace-harness/seams/skills"',
      `    config: { roots: [${JSON.stringify(rootPattern)}] }`,
      '',
    ].join('\n'),
    'utf8',
  );

  const harness = await createHarness({ compositionPath, root: REPO_ROOT, logger: SILENT_LOGGER });
  let service;
  try {
    assert.deepEqual([...harness.plugins.keys()], ['skills']);
    service = harness.ctx.skills;
    assert.equal(typeof service.list, 'function');
    const scanned = await service.scan();
    assert.deepEqual(scanned.errors, []);
    assert.deepEqual(service.list().map(item => item.name), ['mounted-skill']);
    assert.equal(service.load('mounted-skill').body, '# Mounted\n');
  } finally {
    await harness.stop();
  }
  assert.throws(() => service.list(), harnessError(SKILL_ERROR.closed), 'kernel dispose closes ctx.skills');
});

test('parseSkillDocument is strict about the frontmatter grammar', () => {
  assert.throws(() => parseSkillDocument('no frontmatter'), harnessError(ERROR.skillInvalid));
  assert.throws(() => parseSkillDocument('---\nname: x\ndescription: y\n'), harnessError(ERROR.skillInvalid));
  assert.throws(() => parseSkillDocument('---\nname: x\n---\n'), harnessError(ERROR.skillInvalid));
  assert.throws(() => parseSkillDocument('---\nname: x\ndescription: y\nversion: 1\n---\n'), harnessError(ERROR.skillInvalid));
  assert.throws(() => parseSkillDocument('---\nname: x\nname: y\ndescription: z\n---\n'), harnessError(ERROR.skillInvalid));
  assert.throws(() => parseSkillDocument('---\nname: x\ndescription: y\n  nested: z\n---\n'), harnessError(ERROR.skillInvalid));
  assert.throws(
    () => parseSkillDocument('---\nname: x\ndescription: |\n  block\n---\n'),
    harnessError(ERROR.skillInvalid),
  );
  const parsed = parseSkillDocument('---\nname: quoted-skill\ndescription: "Quoted description"\n---\n\n# Body\n');
  assert.deepEqual(parsed, { name: 'quoted-skill', description: 'Quoted description', body: '\n# Body\n' });
});
