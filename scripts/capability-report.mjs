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

function renderMarkdown(report) {
  const lines = [];
  lines.push('# 能力地图（自动生成）');
  lines.push('');
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push('');
  lines.push(`插件 **${report.totals.plugins}** 个 · 路由 **${report.totals.routes}** 条 · 工具 **${report.totals.tools}** 个 · `
    + `有测试 **${report.totals.withTests}** · 有冒烟 **${report.totals.withSmoke}** · 有页面 **${report.totals.withPage}**`);
  lines.push('');
  lines.push('| 插件 | 路由 | 工具 | 测试 | 冒烟 | 页面 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const plugin of report.plugins) {
    lines.push(`| \`${plugin.id}\` | ${plugin.routes.length} | ${plugin.tools.length} | `
      + `${plugin.tests.length > 0 ? plugin.tests.length : '—'} | `
      + `${plugin.smokes.length > 0 ? plugin.smokes.length : '—'} | ${plugin.hasPage ? '✓' : '—'} |`);
  }
  const gaps = report.plugins.filter(plugin => plugin.tests.length === 0);
  lines.push('');
  lines.push('## 没有测试的插件');
  lines.push('');
  if (gaps.length === 0) lines.push('（无）');
  else for (const plugin of gaps) lines.push(`- \`${plugin.id}\`（${plugin.routes.length} 路由，${plugin.tools.length} 工具）`);
  const noSmoke = report.plugins.filter(plugin => plugin.smokes.length === 0);
  lines.push('');
  lines.push('## 没有冒烟引用的插件');
  lines.push('');
  if (noSmoke.length === 0) lines.push('（无）');
  else for (const plugin of noSmoke) lines.push(`- \`${plugin.id}\``);
  lines.push('');
  lines.push('> 说明：冒烟引用是“文本里出现了插件 id 或目录”，不等于该插件的全部路径都被覆盖；');
  lines.push('> 没有冒烟引用的插件未必未验证（可能由组合级冒烟间接覆盖），但值得人工确认。');
  return `${lines.join('\n')}\n`;
}

export function buildReport(plugins, smokes) {
  const withCoverage = attachCoverage(plugins, smokes);
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      plugins: withCoverage.length,
      routes: withCoverage.reduce((sum, plugin) => sum + plugin.routes.length, 0),
      tools: withCoverage.reduce((sum, plugin) => sum + plugin.tools.length, 0),
      withTests: withCoverage.filter(plugin => plugin.tests.length > 0).length,
      withSmoke: withCoverage.filter(plugin => plugin.smokes.length > 0).length,
      withPage: withCoverage.filter(plugin => plugin.hasPage).length,
    },
    plugins: withCoverage,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const value = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const report = buildReport(await collectPlugins(ROOT), await collectSmokes(ROOT));
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
