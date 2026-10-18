// Current-contract acceptance only. An import blocker remains a failed boundary.
// Unapproved policy candidates are separate explicit commands, never defaults.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BASE } from './fixtures.mjs';
if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Use Node 24 and the unchanged project dependency lock.');
const suites = ['adapter-host.test.mjs', 'cross-document-regression.test.mjs', 'upload-library.test.mjs'];
let failed = false;
for (const suite of suites) {
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL(suite, import.meta.url))], {
    env: { PATH: process.env.PATH, HOME: '/tmp', NO_COLOR: '1' }, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024,
  });
  process.stdout.write(JSON.stringify({ boundary: suite, fixedBase: BASE, node: process.version, exitCode: result.status, signal: result.signal, error: result.error?.code }) + '\n');
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
