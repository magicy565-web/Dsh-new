// Produce an independently installable native DSH bundle, with no unpublished
// workspace dependency and no extra application/server/agent runtime.
import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, 'integrations/dsh/dsh-commerce-network');
const destination = resolve(process.argv[2] || join(root, 'dist'));
const stage = await mkdtemp(join(tmpdir(), 'commerce-bundle-'));
try {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  for (const filename of manifest.files) {
    const target = join(stage, filename); await mkdir(dirname(target), { recursive: true });
    await cp(join(directory, filename), target, { recursive: true });
  }
  const acceptance = await readFile(join(root, 'docs/COMMERCE-NETWORK-V1-ACCEPTANCE.md'), 'utf8');
  const sourceBase = 'https://github.com/magicy565-web/workspace-agent/blob/codex/commerce-network-product-v1-20261028/';
  await writeFile(join(stage, 'ACCEPTANCE.md'), acceptance.replace(/\]\(\.\.\/([^)]*)\)/g, (_match, path) => `](${sourceBase}${path})`));
  manifest.files.push('ACCEPTANCE.md');
  const readme = await readFile(join(stage, 'README.md'), 'utf8');
  await writeFile(join(stage, 'README.md'), readme.replace('../../../docs/COMMERCE-NETWORK-V1-ACCEPTANCE.md', './ACCEPTANCE.md'));
  await mkdir(join(stage, 'domain'), { recursive: true });
  const domain = await readFile(join(root, 'packages/domain-commerce-network/src/index.mjs'), 'utf8');
  await writeFile(join(stage, 'domain/index.mjs'), domain);
  const service = await readFile(join(stage, 'service.js'), 'utf8');
  if (!service.includes("from '@workspace-agent/domain-commerce-network'")) throw new Error('The declared domain import changed; inspect package assembly before release.');
  await writeFile(join(stage, 'service.js'), service.replace("from '@workspace-agent/domain-commerce-network'", "from './domain/index.mjs'"));
  manifest.files.push('domain'); manifest.dependencies = {}; manifest.license = 'UNLICENSED';
  delete manifest.scripts;
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(destination, { recursive: true });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const output = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], { cwd: stage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const archive = join(destination, output[0].filename), bytes = await readFile(archive);
  const receipt = { package: manifest.name, version: manifest.version, archive: output[0].filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), files: output[0].files.map(f => f.path), standalone: true, executionHost: 'DeepSeek Harness', targetHost: '0.2.1-rc.3', unpublishedDependencies: [] };
  await writeFile(join(destination, 'commerce-package-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
} finally { await rm(stage, { recursive: true, force: true }); }
