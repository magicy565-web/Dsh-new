import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
for (const engine of ['pi', 'omp']) test(`product DTOs match actual ${engine} JSON Schema validation`, () => {
  const executable = engine === 'pi' ? process.execPath : root + '/support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun';
  const r = spawnSync(executable, ['test/fixtures/shopify-product-contracts.mjs', engine], { cwd: root, timeout: 20000, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: '/tmp', PI_OFFLINE: '1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr); const evidence = JSON.parse(r.stdout.trim()); assert.equal(evidence.cases, 67); assert.equal(evidence.explicitBusinessConstraints, 5); assert.equal(evidence.modelCalls, 0);
});
test('copied export has declarations and only intended package files', async t => {
  const dir = await fs.mkdtemp('/tmp/shopify-product-types-'); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const copied = path.join(dir, 'node_modules/@workspace-agent/pi-shopify-product'); await fs.cp(path.join(root, 'plugins/workspace-shopify-product'), copied, { recursive: true });
  const file = path.join(dir, 'consumer.mts'); await fs.writeFile(file, `import {validateShopifyProductInput, type PublicationReviewInput} from '@workspace-agent/pi-shopify-product/contracts';
const x = validateShopifyProductInput('read', {productId:'synthetic'}); const id: string = x.productId;
// @ts-expect-error publication requires exact selected channel
const y: PublicationReviewInput = {serviceId:'synthetic',requestId:'stable',action:'publish'};
void [id,y];`);
  const checked = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2023', file], { cwd: dir, timeout: 20000, encoding: 'utf8' }); assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const packed = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', '--cache=/tmp/shopify-product-npm-cache'], { cwd: copied, timeout: 15000, encoding: 'utf8' }); assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map(f => f.path); for (const name of ['src/extension.js', 'src/contracts.mjs', 'src/contracts.d.mts', 'skills/shopify-product/SKILL.md']) assert.ok(files.includes(name), name);
  assert.ok(files.every(f => !f.includes('node_modules') && !f.startsWith('.env')));
});
