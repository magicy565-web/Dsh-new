// Capability map: what this harness can actually do, and what proves it.
//
//   node scripts/capability-report.mjs [--json <file>] [--markdown <file>]
//
// Reads each plugin manifest, its tests and the smoke scripts, then reports
// per-plugin: routes, tools, test files, and whether any smoke script mentions
// the plugin. "No smoke" is not a failure -- it is a gap worth seeing.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

async function listDirectories(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { return null; }
}

/** Read every plugin manifest and its local evidence. */
export async function collectPlugins(root = ROOT) {
  const names = await listDirectories(path.join(root, 'plugins'));
  const plugins = [];
  for (const name of names) {
    const directory = path.join(root, 'plugins', name);
    const manifest = await readJson(path.join(directory, 'harness.plugin.json'));
    if (!manifest) continue;
    const tests = (await readdir(path.join(directory, 'test')).catch(() => []))
      .filter(file => file.endsWith('.test.mjs')).sort();
    const hasPage = (manifest.routes ?? []).some(route => /^GET \/[a-z-]+$/u.test(route));
    plugins.push({
      id: manifest.id ?? name,
      directory: `plugins/${name}`,
      version: manifest.version ?? null,
      provides: manifest.provides ?? [],
      requires: manifest.requires ?? [],
      routes: manifest.routes ?? [],
      tools: manifest.tools ?? [],
      tests,
      hasPage,
    });
  }
  return plugins;
}

/** Which smoke scripts exist, and which plugin ids each one mentions. */
export async function collectSmokes(root = ROOT) {
  const directory = path.join(root, 'scripts');
  const files = (await readdir(directory).catch(() => [])).filter(file => file.endsWith('-smoke.mjs')).sort();
  const smokes = [];
  for (const file of files) {
    const text = await readFile(path.join(directory, file), 'utf8');
    smokes.push({ file: `scripts/${file}`, text });
  }
  return smokes;
}

/** Distinctive http prefixes for a plugin (`/api/quotes`, `/quotes`, ...). */
export function routeKeys(plugin) {
  const keys = new Set();
  for (const route of plugin.routes) {
    const api = /^[A-Z]+ (\/api\/[a-z0-9-]+)/u.exec(route);
    if (api) { keys.add(api[1]); continue; }
    const page = /^[A-Z]+ (\/[a-z-]+)$/u.exec(route);
    if (page) keys.add(page[1]);
  }
  return [...keys];
}

/** Attach smoke coverage: a smoke counts when it names the plugin or one of its prefixes. */
export function attachCoverage(plugins, smokes) {
  return plugins.map(plugin => {
    const keys = routeKeys(plugin);
    const mentions = smokes
      .filter(smoke => smoke.text.includes(plugin.id) || smoke.text.includes(plugin.directory)
        || keys.some(key => smoke.text.includes(key))
        || plugin.tools.some(tool => smoke.text.includes(tool)))
      .map(smoke => smoke.file);
    return { ...plugin, routeKeys: keys, smokes: mentions };
  });
}

/**
 * Composition rows: plugin package name -> { rowId, enabled }.
 * A row is disabled when it carries `enabled: false` (inline or nested config).
 */
export function parseComposition(text) {
  const rows = new Map();
  const blocks = String(text).split(/\n\s*-\s+id:/u).slice(1);
  for (const block of blocks) {
    const rowId = (/^([A-Za-z0-9-]+)/u.exec(block.trim()) ?? [])[1] ?? null;
    const name = (/\n\s*name:\s*([^\s#]+)/u.exec(block) ?? [])[1] ?? null;
    if (!name || !name.startsWith('workspace-')) continue;
    rows.set(name, { rowId, enabled: !/enabled:\s*false/u.test(block) });
  }
  return rows;
}

/**
 * Curated notes for cases text matching cannot express. Only display-level:
 * they never hide a missing smoke, they explain it.
 */
export const COVERAGE_NOTES = Object.freeze({
  'workspace-runner': { kind: 'indirect', note: '每次 run 都由 runner 执行，冒烟通过聊天/工具路径间接覆盖' },
  'workspace-llm-bridge': { kind: 'disabled', note: '组合里默认禁用（外部桥接，按需开启）' },
});

/** Classify every plugin so real gaps are separated from known exceptions. */
export function classify(plugins, composition) {
  return plugins.map(plugin => {
    const row = composition.get(plugin.id) ?? null;
    const note = COVERAGE_NOTES[plugin.id] ?? null;
    const mounted = row !== null;
    const disabled = mounted ? row.enabled === false : note?.kind === 'disabled';
    let bucket = 'covered';
    if (note?.kind === 'disabled' || disabled) bucket = 'disabled';
    else if (note?.kind === 'indirect') bucket = 'indirect';
    else if (plugin.smokes.length > 0) bucket = 'covered';
    else if (!mounted) bucket = 'unmounted';
    else bucket = 'gap';
    return { ...plugin, mounted, disabled, note: note?.note ?? null, bucket };
  });
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# 能力地图（自动生成）');
  lines.push('');
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push('');
  lines.push(`插件 **${report.totals.plugins}** 个 · 路由 **${report.totals.routes}** 条 · 工具 **${report.totals.tools}** 个 · `
    + `有测试 **${report.totals.withTests}** · 有冒烟 **${report.totals.withSmoke}** · 有页面 **${report.totals.withPage}**`);
  lines.push('');
  lines.push('| 插件 | 路由 | 工具 | 测试 | 冒烟 | 页面 | 挂载 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const plugin of report.plugins) {
    const mounted = plugin.disabled ? '禁用' : plugin.mounted ? '✓' : '—';
    lines.push(`| \`${plugin.id}\` | ${plugin.routes.length} | ${plugin.tools.length} | `
      + `${plugin.tests.length > 0 ? plugin.tests.length : '—'} | `
      + `${plugin.smokes.length > 0 ? plugin.smokes.length : '—'} | ${plugin.hasPage ? '✓' : '—'} | ${mounted} |`);
  }

  const section = (title, items, render) => {
    lines.push('');
    lines.push(`## ${title}`);
    lines.push('');
    if (items.length === 0) lines.push('（无）');
    else for (const plugin of items) lines.push(render(plugin));
  };

  section('没有测试的插件', report.plugins.filter(plugin => plugin.tests.length === 0),
    plugin => `- \`${plugin.id}\`（${plugin.routes.length} 路由，${plugin.tools.length} 工具）`);
  section('真正的缺口：已挂载、无冒烟、无说明', report.plugins.filter(plugin => plugin.bucket === 'gap'),
    plugin => `- \`${plugin.id}\`（${plugin.routes.length} 路由，${plugin.tools.length} 工具）`);
  section('间接覆盖（有说明）', report.plugins.filter(plugin => plugin.bucket === 'indirect'),
    plugin => `- \`${plugin.id}\` — ${plugin.note}`);
  section('默认禁用（有说明）', report.plugins.filter(plugin => plugin.bucket === 'disabled'),
    plugin => `- \`${plugin.id}\` — ${plugin.note ?? '组合里 enabled: false'}`);
  section('未挂载且无冒烟的插件包', report.plugins.filter(plugin => plugin.bucket === 'unmounted'),
    plugin => `- \`${plugin.id}\`（需要时再挂载；挂载后必须有冒烟）`);

  lines.push('');
  lines.push('> 说明：冒烟引用是“文本里出现了插件 id、API 前缀或工具名”，不等于该插件的全部路径都被覆盖。');
  lines.push('> 「真正的缺口」只列已挂载、无冒烟引用、也没有人工说明的插件；');
  lines.push('> 人工说明表在脚本的 `COVERAGE_NOTES` 里，必须写清楚理由，不能用来掩盖缺口。');
  return `${lines.join('\n')}\n`;
}

export function buildReport(plugins, smokes, composition = new Map()) {
  const classified = classify(attachCoverage(plugins, smokes), composition);
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      plugins: classified.length,
      routes: classified.reduce((sum, plugin) => sum + plugin.routes.length, 0),
      tools: classified.reduce((sum, plugin) => sum + plugin.tools.length, 0),
      withTests: classified.filter(plugin => plugin.tests.length > 0).length,
      withSmoke: classified.filter(plugin => plugin.smokes.length > 0).length,
      withPage: classified.filter(plugin => plugin.hasPage).length,
      mounted: classified.filter(plugin => plugin.mounted).length,
      gaps: classified.filter(plugin => plugin.bucket === 'gap').length,
    },
    plugins: classified,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const value = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const compositionText = await readFile(path.join(ROOT, 'harness.local.yml'), 'utf8').catch(() => '');
  const report = buildReport(await collectPlugins(ROOT), await collectSmokes(ROOT), parseComposition(compositionText));
  const markdown = renderMarkdown(report);
  if (value('--json')) await writeFile(path.resolve(value('--json')), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (value('--markdown')) await writeFile(path.resolve(value('--markdown')), markdown, 'utf8');
  process.stdout.write(markdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    process.stderr.write(`capability-report: ${error.message}\n`);
    process.exitCode = 1;
  });
}
