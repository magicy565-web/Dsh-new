// Pure pinned runtime checks; no business plugin or server imports.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
export function workspaceOmpPaths(env = {}) {
  return { bun: env.WORKSPACE_BUN_BIN || path.join(root, 'support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun'),
    packageRoot: env.WORKSPACE_OMP_PACKAGE_ROOT || path.join(root, 'support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent') };
}
export async function checkWorkspaceOmpPaths(paths) {
  if (!path.isAbsolute(paths.bun) || !path.isAbsolute(paths.packageRoot)) throw new Error('Workspace OMP paths must be absolute reviewed host paths.');
  await fs.access(paths.bun);
  const manifest = JSON.parse(await fs.readFile(path.join(paths.packageRoot, 'package.json')));
  if (manifest.name !== '@oh-my-pi/pi-coding-agent' || manifest.version !== '18.10.4') throw new Error('Install the fixed official OMP 18.10.4 package; no Node or alternate engine fallback is implicit.');
}
export async function verifyWorkspaceOmpRuntime(paths) {
  await checkWorkspaceOmpPaths(paths);
  const audit = JSON.parse(await fs.readFile(path.join(root, 'support/omp-bun-linux-x64/runtime-audit.json')));
  if (createHash('sha256').update(await fs.readFile(paths.bun)).digest('hex') !== audit.binarySha256) throw new Error('Bun 可执行文件与已审计官方 1.3.14 artifact 不一致。');
  return await new Promise((resolve, reject) => {
    const child = spawn(paths.bun, ['--version'], { env: { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'ignore'] }); let text = '';
    child.stdout.on('data', data => { text += data; }); child.on('error', reject); child.on('close', code => {
      if (code === 0 && text.trim() === '1.3.14') resolve({ omp: '18.10.4', bun: text.trim(), integrity: 'verified' });
      else reject(new Error('官方固定 Bun 版本验证失败。'));
    });
  });
}
