import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
// Production-bundle DOM suites require a build and run through the UI commands.
const files = (await readdir(new URL('../test/', import.meta.url))).filter(name => name.endsWith('.test.mjs') && !name.startsWith('ui.') && !name.endsWith('.dom.test.mjs')).sort().map(name => `test/${name}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: new URL('../', import.meta.url) });
process.exitCode = result.status ?? 1;
