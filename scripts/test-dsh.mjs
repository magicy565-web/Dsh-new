// Run the retained native plugin and host-independent domain regressions.
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const directories = [
  'integrations/dsh/dsh-workspace-library/test',
  'integrations/dsh/dsh-space-workspace/test',
  'integrations/dsh/dsh-sourcing-agent/test',
  'integrations/dsh/dsh-workspace-memory/test',
  'integrations/dsh/dsh-inquiry-recovery/test',
  'integrations/dsh/dsh-mini-erp/test',
  'packages/domain-business-memory/test',
  'packages/domain-product-library/test',
  'packages/domain-inquiry-recovery/test',
];
const files = [];
for (const directory of directories) {
  const tests = (await readdir(new URL(`${directory}/`, root)))
    .filter(name => name.endsWith('.test.mjs')).sort();
  if (!tests.length) throw new Error(`No tests found in ${directory}.`);
  files.push(...tests.map(name => `${directory}/${name}`));
}
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: fileURLToPath(root), stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
