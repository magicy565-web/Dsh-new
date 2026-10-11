import { promises as fs } from 'node:fs';
import path from 'node:path';

// Read-only comparison. Does not open an app Store or modify data/ownership.
const directory = await fs.realpath(path.resolve(process.argv[2] || '.'));
const results = [];
for (const mode of ['r', 'r+']) {
  let handle;
  try {
    handle = await fs.open(directory, mode);
    if (!(await handle.stat()).isDirectory()) throw Error('A directory is required.');
    await handle.sync(); results.push({ mode, sync: true });
  } catch (error) { results.push({ mode, sync: false, code: error.code, errno: error.errno, syscall: error.syscall, message: error.message }); }
  finally { if (handle) await handle.close(); }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, directory, statfsType: (await fs.statfs(directory)).type, results }));
