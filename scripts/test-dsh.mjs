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
  'integrations/dsh/dsh-workspace-brand/test',
  'integrations/dsh/dsh-buyer-magazine/test',
  'packages/domain-business-memory/test',
  'packages/domain-product-library/test',
  'packages/domain-inquiry-recovery/test',
  'packages/domain-commerce-network/test',
  'integrations/dsh/dsh-commerce-network/test',
  'integrations/dsh/dsh-rfq-desk/test',
  'integrations/dsh/dsh-quote-guard/test',
  'integrations/dsh/dsh-sample-flow/test',
  'integrations/dsh/dsh-channel-ledger/test',
  'packages/domain-rfq/test',
  'packages/domain-quote/test',
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
