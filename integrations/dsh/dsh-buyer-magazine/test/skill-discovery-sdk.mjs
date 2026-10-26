// Explicit official-SDK acceptance; no installation, model, browser or user profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
if (!process.argv[2]) { console.log('SKIP: pass an absolute official runtime; no SDK was imported.'); process.exit(0); }
assert(isAbsolute(process.argv[2]), 'The SDK runtime path must be explicit and absolute.');
if (process.argv[3]) assert(isAbsolute(process.argv[3]), 'The source path must be explicit and absolute.');
const source = process.argv[3] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(process.argv[2], 'package.json'));
const sdk = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-skill-filesystem')).href);
const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href);
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const root = await mkdtemp('/tmp/dsh-magazine-discovery-');
let provider;
try {
  const installed = join(root, 'node_modules', manifest.name);
  await mkdir(installed, { recursive: true });
  await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}');
  for (const file of ['package.json', ...manifest.files]) await cp(join(source, file), join(installed, file), { recursive: true });
  assert.equal(boot.resolveBundleDir('standalone-audit', manifest.name, join(root, 'package.json'), root), installed);
  const rows = boot.composeEntries([boot.loadOverlayPatches('standalone-audit', join(installed, 'cordis.patch.yml'))]);
  assert.equal(rows.length, 1); assert.equal(rows[0].name, '@deepseek-ai/dsh-agent-preset');
  assert.equal(rows[0].config.id, 'buyer-magazine');
  const plugins = rows[0].config.plugins;
  for (const name of ['dsh-buyer-magazine', '@deepseek-ai/dsh-tool-web', '@deepseek-ai/dsh-tool-present', '@deepseek-ai/dsh-skill-filesystem']) assert(plugins.some(p => p.name === name), name);
  assert(!JSON.stringify(plugins).includes('dsh-sourcing-agent'));
  const expression = plugins.find(p => p.id === 'skill-filesystem').config.customSkillDirs[0].__jsExpr;
  const skillRoot = Function('baseUrl', `return (${expression});`)(pathToFileURL(join(root, 'package.json')).href);
  assert.equal(skillRoot, join(installed, 'skills'));
  const warnings = [], controller = new AbortController();
  provider = new sdk.FileSystemSkillProvider({ get: () => undefined, logger: { warn: m => warnings.push(m) } },
    { invalidate: () => assert.fail('No watchers'), signal: controller.signal },
    { providerName: 'standalone-audit', watch: false, includeDefaultRoots: false, customSkillDirs: [skillRoot] });
  const entries = await provider.list({ cwd: root });
  assert.deepEqual(entries.map(e => e.name).sort(), ['buyer-magazine', ...JSON.parse(await readFile(join(installed,'skill-pack.json'),'utf8')).skills.map(s=>s.name)].sort());
  const loaded = await provider.get(entries.find(e=>e.name==='buyer-magazine'), { signal: controller.signal });
  assert.equal(loaded.resourceBase.path, join(skillRoot, 'buyer-magazine'));
  assert.match(loaded.content, /standalone native DSH plugin/);
  assert.match(loaded.content, /buyer_magazine_generate/);
  for (const file of ['ISSUE-FORMAT.md', 'MODULES.md', 'upstream/studio/STUDIO-SKILL.md']) await readFile(join(loaded.resourceBase.path, file));
  const provenance = JSON.parse(await readFile(join(installed, 'docs/skill-upstream-provenance.json'), 'utf8'));
  assert.equal(provenance.files.length, 23);
  for (const f of provenance.files) {
    const data = await readFile(join(installed, f.target));
    assert.equal(data.length, f.bytes); assert.equal(createHash('sha256').update(data).digest('hex'), f.sha256);
  }
  assert.deepEqual(warnings, []);
  console.log(JSON.stringify({ status: 'passed', version: manifest.version, standalonePreset: true, operationalSkills: entries.map(e => e.name), preservedStudioFiles: 23, sourcingRequired: false, modelCalls: 0 }));
} finally { await provider?.dispose(); await rm(root, { recursive: true, force: true }); }
