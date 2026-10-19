import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEFAULT_PLUGIN_ROOT, projectPlugins } from '../workspace-plugin-config.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const knownBackends = new Set(['workspace-enterprise-context', 'workspace-medusa-catalog']);
const labels = Object.freeze({
  'workspace-procurement': '采购与供应准备', 'workspace-factory-materials': '企业资料读取',
  'workspace-factory-customers': '客户资料', 'workspace-factory-inquiries': '询盘管理',
  'workspace-factory-ingestion': '产品资料入库', 'workspace-market-validation': '市场验证',
  'workspace-shopify-product': 'Shopify 产品', 'workspace-local-materials': '本地资料',
  'workspace-plugin-info': '插件诊断', 'workspace-enterprise-context': '企业上下文与记忆',
  'workspace-free-trade': '公开贸易信息', 'workspace-medusa-catalog': 'Medusa 产品库',
  'workspace-goal-intelligence': '经营大脑', 'workspace-marketplace': 'AI Worker 服务',
  'workspace-erpnext-enterprise': 'ERPNext 企业字段',
});
const refuse = () => { throw Object.assign(new Error('Plugin inventory is unavailable; no package code was executed.'), { code: 'PLUGIN_INVENTORY_REFUSED' }); };
const publicText = (value, maximum) => typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value) ? value : '';

/** Read reviewed source files without importing extensions or executing hooks. */
export async function packageSnapshot(directory) {
  const base = path.resolve(directory);
  if (await fs.realpath(base) !== base || !(await fs.lstat(base)).isDirectory()) refuse();
  const records = [];
  let totalBytes = 0, count = 0;
  async function visit(parent, depth) {
    if (depth > 20 || await fs.realpath(parent) !== parent) refuse();
    const entries = await fs.readdir(parent, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (++count > 10000 || entry.isSymbolicLink()) refuse();
      const file = path.join(parent, entry.name);
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) refuse();
      if (stat.isDirectory()) { await visit(file, depth + 1); continue; }
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024 || await fs.realpath(file) !== file) refuse();
      const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.ino !== stat.ino || before.dev !== stat.dev || before.nlink !== 1 || await fs.realpath(file) !== file) refuse();
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) refuse();
        totalBytes += bytes.length;
        if (totalBytes > 64 * 1024 * 1024) refuse();
        records.push([path.relative(base, file).split(path.sep).join('/'), bytes.length, hash(bytes)]);
      } finally { await handle.close(); }
    }
  }
  await visit(base, 0);
  records.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return Object.freeze({ sha256: hash(JSON.stringify(records)), files: records.length, bytes: totalBytes });
}
async function configurationHash(root, configuration) {
  const handle = await fs.open(path.join(root, configuration), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) refuse();
    return hash(await handle.readFile());
  } finally { await handle.close(); }
}

/** A source/configuration snapshot, NOT an atomic deployment snapshot or proof of execution. */
export async function readPluginInventory({ root = DEFAULT_PLUGIN_ROOT, backendSelection = null } = {}) {
  root = path.resolve(root);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const configurations = entries.filter(entry => entry.isFile() && /^config(?:\.[a-z0-9-]+)?\.json$/u.test(entry.name)).map(entry => entry.name).sort();
  if (!configurations.includes('config.json') || configurations.length > 32) refuse();
  const profiles = [];
  let inventory;
  for (const configuration of configurations) {
    const sha256 = await configurationHash(root, configuration);
    const selected = await projectPlugins({ root, configuration });
    if (selected.installed.length > 100 || await configurationHash(root, configuration) !== sha256) refuse();
    inventory ??= selected.installed;
    if (JSON.stringify(selected.installed.map(item => item.id).sort()) !== JSON.stringify(inventory.map(item => item.id).sort())) refuse();
    profiles.push({ configuration, sha256, selected: selected.enabled.map(item => item.id).sort() });
  }
  const packages = [];
  for (const item of inventory) {
    const snapshot = await packageSnapshot(item.directory);
    const version = publicText(item.manifest.version, 64), name = publicText(item.name, 180);
    if (!version || !name) refuse();
    packages.push({
      id: item.id, name, title: labels[item.id] || item.id, version,
      description: publicText(item.manifest.description, 1000),
      packageSha256: snapshot.sha256, fileCount: snapshot.files, byteCount: snapshot.bytes,
      selectedIn: profiles.filter(profile => profile.selected.includes(item.id)).map(profile => profile.configuration),
      extensions: item.extensions.map(file => path.relative(item.directory, file).split(path.sep).join('/')),
      skills: item.skills.map(file => path.relative(item.directory, file).split(path.sep).join('/')),
      backend: knownBackends.has(item.id) ? { ownership: 'package', selected: backendSelection?.enabled(item.id) ?? null, verifiedOnline: false } : { ownership: 'not-certified-as-removable-backend', selected: null, verifiedOnline: false },
      lifecycle: { selection: true, hotUnload: false, physicalRemoval: 'requires-module-specific-acceptance' },
    });
  }
  packages.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  for (const profile of profiles) {
    const current = await projectPlugins({ root, configuration: profile.configuration });
    if (await configurationHash(root, profile.configuration) !== profile.sha256 || JSON.stringify(current.enabled.map(item => item.id).sort()) !== JSON.stringify(profile.selected)) refuse();
  }
  // Runtime/backend selection is separate from immutable source identity, so the
  // same source receipt remains comparable in an offline administrator CLI.
  const sourcePackages = packages.map(({ id, name, version, packageSha256, extensions, skills }) => ({ id, name, version, packageSha256, extensions, skills }));
  return { schemaVersion: 1, snapshotSha256: hash(JSON.stringify({ profiles, packages: sourcePackages })), profiles, packages, onlineVerified: false, codeExecuted: false };
}
