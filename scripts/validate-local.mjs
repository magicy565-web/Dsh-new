#!/usr/bin/env node
/** Offline fixture evidence only. Never invokes live acceptance, deployment or a browser. */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { sourceFingerprint } from '../server/source-fingerprint.mjs';
const cwd = new URL('../', import.meta.url);
const checks = [];
await fs.mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
let log = '';
for (const [name, command] of [['backend', 'test'], ['production-ui-dom', 'test:ui']]) {
  let output = '';
  const child = spawn('npm', ['run', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { const text = bytes.toString(); output += text; process.stdout.write(bytes); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  log += `\n=== ${name}: npm run ${command} ===\n${output}`;
  await fs.writeFile(new URL('../evidence/full-validation-candidate.log', import.meta.url), log);
  const number = key => Number([...output.replace(/\x1b\[[0-9;]*m/g, '').matchAll(new RegExp(`^(?:#|ℹ) ${key} (\\d+)$`, 'gm'))].at(-1)?.[1] ?? NaN);
  const check = { name, tests: number('tests'), passed: number('pass'), failed: number('fail'), skipped: number('skipped') };
  if (code !== 0 || !Number.isSafeInteger(check.tests) || !check.tests || check.passed !== check.tests || check.failed !== 0 || check.skipped !== 0) {
    await fs.rm(new URL('../evidence/local-verification.json', import.meta.url), { force: true });
    throw new Error(`${name} did not complete with every fixture passing. No passing local evidence was published.`);
  }
  checks.push(check);
}
const report = { schemaVersion: 1, evidenceKind: 'local-fixtures', result: 'passed', checkedAt: new Date().toISOString(), sourceFingerprint: await sourceFingerprint(), externalCalls: false, actualBrowser: false, checks };
await fs.writeFile(new URL('../evidence/local-verification.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
