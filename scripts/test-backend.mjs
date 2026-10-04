import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = (await readdir(new URL('../test/', import.meta.url))).filter(name => name.endsWith('.test.mjs') && !name.startsWith('ui.')).sort().map(name => `test/${name}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: new URL('../', import.meta.url) });
process.exitCode = result.status ?? 1;
