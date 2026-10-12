import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'miniprogram/tsconfig.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const destination = path.resolve('release/miniprogram');
await fs.mkdir(destination, { recursive: true });
await fs.cp('.mini-build/miniprogram/src', destination, { recursive: true });
async function assets(directory, relative = '') {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const next = path.join(relative, item.name), source = path.join(directory, item.name);
    if (item.isDirectory()) await assets(source, next);
    else if (!item.name.endsWith('.ts')) { await fs.mkdir(path.dirname(path.join(destination, next)), { recursive: true }); await fs.copyFile(source, path.join(destination, next)); }
  }
}
await assets('miniprogram/src');
await fs.writeFile(path.join(destination, 'project.config.json'), JSON.stringify({ description: 'Workspace conversation client; account/device acceptance pending', miniprogramRoot: './', compileType: 'miniprogram', appid: 'touristappid', projectname: 'workspace-conversation', setting: { es6: true, minified: true, urlCheck: true } }, null, 2));
await fs.writeFile(path.join(destination, 'package.json'), '{"type":"commonjs","private":true}\n');
console.log(`Mini program client compiled with official API typings 5.2.3: ${destination}. No upload/deploy/account action was run.`);
