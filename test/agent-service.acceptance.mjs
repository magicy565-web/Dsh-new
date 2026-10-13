import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const workdir = await mkdtemp(path.join(tmpdir(), 'workspace-agent-unified-acceptance-'));
const jobs = [
  ['web-build', npm, ['run', 'build']],
  ['mini-build', npm, ['run', 'build:mini']],
  ['agent-http-pi', npm, ['run', 'test:agent']],
  ['agent-python-client', npm, ['run', 'test:agent:client']],
  ['whole-workspace', npm, ['run', 'test:all']],
];
const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 });
const gitDirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 10000 });
const version = spawnSync(process.execPath, ['--version'], { cwd: root, encoding: 'utf8' });
const results = [];
for (const [name, command, args] of jobs) {
  const startedAt = new Date().toISOString();
  const execution = spawnSync(command, args, {
    cwd: root, env: process.env, encoding: 'utf8',
    maxBuffer: 24 * 1024 * 1024, timeout: 12 * 60 * 1000,
    windowsHide: true,
  });
  const stdout = typeof execution.stdout === 'string' ? execution.stdout : '';
  const stderr = typeof execution.stderr === 'string' ? execution.stderr : '';
  await writeFile(path.join(workdir, name + '.stdout.log'), stdout);
  await writeFile(path.join(workdir, name + '.stderr.log'), stderr);
  results.push({
    name, command: [command, ...args], startedAt, finishedAt: new Date().toISOString(),
    exitCode: execution.status, signal: execution.signal || null,
    spawnError: execution.error?.code || null,
    stdoutFile: name + '.stdout.log', stderrFile: name + '.stderr.log',
  });
}
const allLocalPassed = results.every(row => row.exitCode === 0 && !row.signal && !row.spawnError);
const report = {
  schema: 'cnsubscribe.unified-agent-acceptance.v1',
  source: {
    gitHead: gitHead.status === 0 ? gitHead.stdout.trim() : null,
    gitDirty: gitDirty.status === 0 ? gitDirty.stdout.trim() !== '' : null,
    node: version.status === 0 ? version.stdout.trim() : process.version,
  },
  lineage: {
    integratedFrom: '1e0cc43d973b5d10861561f2cd4979065d5f33f6',
    businessBase: '18cc80aca0f88a68fb96d2f1d960897f8a48dac2',
  },
  localAutomatedResult: allLocalPassed ? 'passed' : 'failed',
  releaseReady: false,
  overall: 'release_blocked',
  independentReview: 'not_verified',
  liveHostMuse: 'not_verified',
  realShopifyGa4WechatAndSevenDays: 'not_verified',
  ci: 'not_verified',
  reason: 'Independent managed-commerce security review and real environment acceptance are separate gates. A local fixture or this runner cannot sign them off.',
  results, evidenceDirectory: workdir,
};
await writeFile(path.join(workdir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  source: report.source, localAutomatedResult: report.localAutomatedResult,
  overall: report.overall, releaseReady: false,
  resultCodes: results.map(row => ({ name: row.name, exitCode: row.exitCode, spawnError: row.spawnError })),
  evidenceDirectory: workdir,
}, null, 2));
process.exitCode = 1;
