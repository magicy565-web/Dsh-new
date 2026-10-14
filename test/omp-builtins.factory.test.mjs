import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const sdk = process.env.OMP_BUILTINS_SDK_ROOT;
const bun = fileURLToPath(new URL('../support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun', import.meta.url));
test('fixed official OMP search receipts, denial, public document and isolated browser close', { skip: !sdk && 'Set OMP_BUILTINS_SDK_ROOT to the audited 18.10.4 package root.' }, async t => {
  assert.equal(createHash('sha256').update(await fs.readFile(bun)).digest('hex'), 'a8f9ebd1770ddc8e55dab7a68d4ec1ec1eebf374bb97cc65cf2c3cb373fc6791');
  const dir = await fs.mkdtemp('/tmp/omp-factory-builtins-'); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const evidence = path.join(dir, 'evidence.json');
  const env = { PATH: `${path.dirname(bun)}:${process.env.PATH}`, HOME: dir, TMPDIR: dir,
    PI_CODING_AGENT_DIR: path.join(dir, 'agent'), PI_BROWSER_RELAY: '0', PI_BROWSER_CMUX: '0', PI_BROWSER_TERN: '0',
    PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium', OMP_BUILTINS_SDK_ROOT: sdk, OMP_BUILTINS_EVIDENCE: evidence,
    OMP_BUILTINS_LIVE_SEARCH: process.env.OMP_BUILTINS_LIVE_SEARCH || '0', NO_COLOR: '1' };
  const outcome = await new Promise((resolve, reject) => {
    const child = spawn(bun, [fileURLToPath(new URL('./fixtures/omp-factory-builtins.mjs', import.meta.url))], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('OMP builtin acceptance timeout')); }, 60000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
  assert.equal(outcome.code, 0, outcome.output); assert.match(outcome.output, /OMP_PUBLIC_SYNTHETIC_BUILTINS_VERIFIED/);
  const facts = JSON.parse(await fs.readFile(evidence));
  assert.equal(facts.browser.closedTabs, true); assert.equal(facts.paidModelCalls, 0);
  assert.equal(facts.search.refusal.bypass, false);
  if (process.env.OMP_BUILTINS_SAVE_EVIDENCE) await fs.copyFile(evidence, process.env.OMP_BUILTINS_SAVE_EVIDENCE);
  t.diagnostic('Actual published OMP tool classes/prelude, explicit synthetic search response and owned HTTP browser page. This does not assert model/subagent execution or real customer discovery.');
});
