#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--compatibility') || args.length > 1) {
  console.error('Use node scripts/verify-plugin-library.mjs [--compatibility].');
  process.exitCode = 2;
} else {
  const compatibility = args.includes('--compatibility');
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const environment = { node: process.version, platform: process.platform, architecture: process.arch };
  if (process.platform !== 'linux' || nodeMajor < (compatibility ? 22 : 24)) {
    console.log(JSON.stringify({ schemaVersion: 1, status: 'not-run', reason: 'Use Linux and the project-supported Node 24+. --compatibility explicitly allows Node 22 checks, not release acceptance.', environment, executedTests: 0 }));
    process.exitCode = 1;
  } else {
    const files = [
      'server/index.mjs', 'server/workspace-backend-plugins.mjs',
      'server/workspace-plugin-config.mjs',
      ...['apply', 'control-store', 'http', 'inventory', 'releases'].map(name => `server/plugin-library/${name}.mjs`),
      'test/plugin-library.test.mjs',
      ...['fixtures', 'control-store.test', 'releases-inventory.test', 'http.test', 'lifecycle.test', 'host-wiring.test'].map(name => `test/plugin-library/${name}.mjs`),
      'scripts/verify-plugin-library.mjs',
    ];
    const sources = [];
    try {
      for (const filename of files) {
        const bytes = await fs.readFile(path.join(root, filename));
        sources.push({ path: filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), gitBlobSha1: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') });
      }
      const testArgs = ['--test', '--test-reporter=tap', 'test/plugin-library.test.mjs'];
      const result = spawnSync(process.execPath, testArgs, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      const count = name => { const match = result.stdout?.match(new RegExp(`^# ${name} (\\d+)$`, 'm')); return match ? Number(match[1]) : null; };
      const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped'].map(name => [name, count(name)]));
      const passed = result.status === 0 && counts.tests > 0 && counts.tests === counts.pass && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0;
      const outputHash = createHash('sha256').update(result.stdout || '').digest('hex');
      console.log(JSON.stringify({ schemaVersion: 1, status: passed ? 'passed' : 'failed', acceptance: compatibility ? 'compatibility-only' : 'target-node-management-regression', environment, command: ['node', ...testArgs], counts, exitCode: result.status, signal: result.signal, tapSha256: outputHash, sources, scope: { originalSelector: true, realFilesystem: true, syntheticIdentities: true, realLoopbackHttp: true, originalResponderBody: 'focused-vm-test', wholeCreateAppStarted: false, originalSignedIngressExercised: false, ompSdkExecuted: false, realModelCalls: 0, realBusinessServiceCalls: 0, browserExecuted: false, productionDeployed: false } }));
      process.exitCode = passed ? 0 : 1;
    } catch {
      console.error(JSON.stringify({ schemaVersion: 1, status: 'failed', code: 'PLUGIN_VALIDATION_SOURCE_UNAVAILABLE', environment, executedTests: 0 }));
      process.exitCode = 1;
    }
  }
}
