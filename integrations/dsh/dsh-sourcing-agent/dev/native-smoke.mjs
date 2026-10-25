import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sourcing from '../index.js';
if (!process.env.DSH_RUNTIME_DIR) throw new Error('Set DSH_RUNTIME_DIR to the official runtime directory.');
const require = createRequire(join(resolve(process.env.DSH_RUNTIME_DIR), 'package.json'));
const load = name => import(require.resolve('@deepseek-ai/' + name));
const { Context } = await load('cordis');
const { default: Skills } = await load('dsh-skill');
const Filesystem = await load('dsh-skill-filesystem');
const ctx = new Context(), standard = new Context();
try {
  await ctx.plugin(Skills); const provider = await ctx.plugin(Sourcing);
  const catalog = await ctx.skills.list(); assert.equal(catalog.length, 6);
  const loaded = await ctx.skills.get('export-supplier'); assert.ok(loaded.content.includes('询盘')); assert.ok(loaded.resourceBase.path.endsWith('export-supplier'));
  await standard.plugin(Skills);
  await standard.plugin(Filesystem, { includeDefaultRoots: false, customSkillDirs: [fileURLToPath(new URL('../skills/', import.meta.url))], watch: false });
  assert.equal((await standard.skills.list()).length, 6);
  assert.ok((await standard.skills.get('market-evidence')).content.includes('来源'));
  await provider.dispose(); assert.equal((await ctx.skills.list()).length, 0);
  console.log('OK: official DSH skill registration, on-demand loading, template resource bases, plain-file discovery and unload; no model calls.');
} finally { await ctx.fiber.dispose(); await standard.fiber.dispose(); }
