import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const pinsURL = new URL('../docs/validation/pi-community-20261014/pins.json', import.meta.url);
test('reviewed registry provenance and every transitive npm resolution remain immutable', async () => {
  const pins = JSON.parse(await fs.readFile(pinsURL));
  assert.equal(pins.officialPiVersion, '1.1.0'); assert.equal(pins.nodeVersion, '24.19.0');
  for (const pin of pins.packages) {
    assert.match(pin.gitHead, /^[a-f0-9]{40}$/); assert.match(pin.integrity, /^sha512-/);
    assert.equal(new URL(pin.tarball).hostname, 'registry.npmjs.org');
    assert.equal(pin.githubManifestVersionMatched, true); assert.equal(pin.githubManifestRuntimeDependenciesMatched, true);
    const lock = JSON.parse(await fs.readFile(new URL(`../docs/validation/pi-community-20261014/${pin.name}.package-lock.json`, import.meta.url)));
    assert.equal(lock.packages[`node_modules/${pin.name}`].version, pin.version);
    assert.equal(lock.packages[`node_modules/${pin.name}`].integrity, pin.integrity);
    for (const [name, item] of Object.entries(lock.packages)) {
      if (!name) continue;
      assert.match(item.version, /^\d+\.\d+\.\d+/); assert.ok(item.integrity, name);
      assert.ok(!item.hasInstallScript, name + ' requires a new script audit');
    }
  }
});
test('official isolated Pi load, coexistence, tools, subagent process stop, document distinctions and removal',
  { skip: !process.env.PI_COMMUNITY_INSTALL_ROOT, timeout: 120000 }, async () => {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [new URL('../scripts/pi-community-verify.mjs', import.meta.url).pathname], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      child.on('error', reject); child.on('close', code => resolve({ code, output }));
    });
    assert.equal(result.code, 0, result.output); assert.match(result.output, /"passed":true/);
  });
