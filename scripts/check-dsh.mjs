// Validate native bundle entry points using Node only; no install or inference.
import { readFile, stat, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
for (const name of ['dsh-workspace-library', 'dsh-sourcing-agent', 'dsh-workspace-memory', 'dsh-inquiry-recovery', 'dsh-mini-erp', 'dsh-workspace-brand', 'dsh-buyer-magazine', 'dsh-commerce-network', 'dsh-service-billing', 'dsh-shopify-admin']) {
  const directory = new URL(`integrations/dsh/${name}/`, root);
  const manifest = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
  if (manifest.type !== 'module' || !manifest.dsh?.bundle?.patch) {
    throw new Error(`${name}: a native DSH bundle manifest is required.`);
  }
  await stat(new URL(manifest.dsh.bundle.patch, directory));
  for (const entry of Object.values(manifest.exports)) {
    if (typeof entry !== 'string') throw new Error(`${name}: unsupported entry declaration.`);
    if (!entry.includes('*')) await stat(new URL(entry, directory));
  }
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(file, directory))], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${name}/${file}: syntax check failed.`);
  }
  console.log(`${manifest.name}@${manifest.version}: native bundle entries and JavaScript syntax OK`);
}
const result = spawnSync(process.execPath, [fileURLToPath(new URL('integrations/dsh/dsh-workspace-library/dev/check-locales.mjs', root))], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
