import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Offline business verification only. No npm test, launch gate, independent
// review, real model/search/Shopify call, Vault enrollment or deployment.
// The unchanged PR44 runner is archived under docs/validation/agent-service/
// pr44-test-source. Every invocation creates new reports and preserves old ones.
// Usage: node test/agent-service.acceptance.mjs
// Exit 1 remains intentional while the recorded independent-review gate is
// unresolved, even when every local business test group exits successfully.

const root = fileURLToPath(new URL('../', import.meta.url));
const startedAt = new Date().toISOString();
const directory = path.join(root, 'docs/validation/pi-agent-integration',
  'acceptance-' + startedAt.replace(/[^0-9TZ]/g, '') + '-' + randomUUID().slice(0, 8));
await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
await mkdir(directory, { recursive: false, mode: 0o700 });
const relative = filename => path.relative(root, filename).split(path.sep).join('/');
const hash = value => createHash('sha256').update(value).digest('hex');
const backendPath = 'docs/validation/pi-agent-integration/backend-second.log';

// Allow only process essentials. Host model, research, Shopify, member tokens,
// native-runtime flags and proxy configuration are not inherited by fixtures.
const environment = { PATH: process.env.PATH || '', TZ: 'UTC', NODE_DISABLE_COLORS: '1', FORCE_COLOR: '0', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' };
for (const key of ['SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) if (process.env[key]) environment[key] = process.env[key];

const nodeGroup = (id, name, files, evidenceScope) => ({ id, name, runner: 'node-test-tap', command: process.execPath, args: ['--test', '--test-reporter=tap', ...files], files, evidenceScope });
const groups = [
  nodeGroup('agent-http', '统一 Agent HTTP、接入契约及模板', [
    'test/agent-pi-service.http.test.mjs', 'test/agent-service.http.test.mjs', 'test/agent-workspace.integration.test.mjs',
  ], '真实本机 HTTP、原 Workspace Store、SQLite、文件和 Python 下载客户端；Pi 使用官方 faux 模型，模板仅显式 demo；未安装真实 Muse Vault。'),
  nodeGroup('pi-runtime', 'Agent 及原 Pi Runtime / Durable', [
    'test/agent-pi-runtime.test.mjs', 'test/pi-runtime.test.mjs', 'test/pi-durable-contract.test.mjs', 'test/pi-process-crash.test.mjs',
  ], '真实已安装 Pi Agent / Durable、JSONL 与原运行记录；官方 faux 模型 / 本地工具夹具，包括原 Pi 进程 SIGKILL；未调用真实模型或产生模型计费。'),
  nodeGroup('agent-owner', '原成员归属与旧 API 引用过滤', ['test/agent-owner-policy.test.mjs'],
    '纯数据归属与引用图测试；真实企业 ingress/session 的离线 HTTP 夹具另由 agent-http 覆盖，不是生产账号验收。'),
  nodeGroup('agent-research', '受控只读研究 adapter', ['test/agent-research.test.mjs'],
    'Brave Web Search 协议形状和有界来源转换使用注入的本地 HTTP / Response；不访问 Brave，不证明真实供应商、价格或市场事实。'),
  { id: 'python-client', name: '零依赖 Python 薄客户端', runner: 'python-unittest', command: 'python3', args: ['test/agent-client.test.py'], files: ['test/agent-client.test.py'],
    evidenceScope: '真实 Python CLI / urllib 与本机 HTTP 夹具，验证流式重连、原请求键查询、恢复、文件及凭据处理；没有真实 Muse Vault 或长期凭据配置。' },
  nodeGroup('supplier-business', '原供应商领域、发布和监测业务', [
    'test/supplier-profile.test.mjs', 'test/supplier-service.http.test.mjs', 'test/supplier-publication.test.mjs', 'test/supplier-publication.http.test.mjs',
  ], '原业务服务、Pi 工具及本机 HTTP，Shopify GraphQL 与发布回执由本地响应夹具提供；七天采用测试时钟，通知为受控本地回执；没有真实商店发布、真实销量 / 流量或连续七天生产观察。'),
];

function nodeCounts(text) {
  const values = {};
  for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...text.matchAll(new RegExp('^(?:#|ℹ)\\s+' + name + '\\s+(\\d+)\\s*$', 'gm'))];
    values[name] = matches.length ? Number(matches.at(-1)[1]) : null;
  }
  return { total: values.tests, passed: values.pass, failed: values.fail, cancelled: values.cancelled, skipped: values.skipped, todo: values.todo };
}
function pythonCounts(text, exitCode) {
  const match = text.match(/^Ran (\d+) tests?\b/m);
  if (!match) return { total: null, passed: null, failed: null, skipped: null, errors: null };
  const total = Number(match[1]), last = text.match(/^(?:OK|FAILED)(?: \(([^\n]*)\))?\s*$/m);
  const value = name => Number(last?.[1]?.match(new RegExp('(?:^|, )' + name + '=(\\d+)'))?.[1] || 0);
  const failed = value('failures') + value('errors') + value('unexpected successes'), skipped = value('skipped');
  return { total, passed: last ? total - failed - skipped - value('expected failures') : null,
    failed: last ? failed : exitCode === 0 ? 0 : null, skipped, errors: value('errors'), expectedFailures: value('expected failures') };
}
async function sourceSnapshot() {
  const files = [];
  async function visit(folder) {
    for (const item of await readdir(path.join(root, folder), { withFileTypes: true })) {
      const filename = path.posix.join(folder, item.name);
      if (item.isDirectory()) await visit(filename);
      else if (item.isFile() && /\.(?:mjs|py|json)$/.test(item.name)) files.push(filename);
    }
  }
  for (const folder of ['server', 'presets/agent', 'client', 'test']) await visit(folder);
  const sources = [];
  for (const filename of files.sort()) sources.push({ path: filename, sha256: hash(await readFile(path.join(root, filename))) });
  return { digest: hash(JSON.stringify(sources)), files: sources };
}
const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, env: environment, encoding: 'utf8' });
const gitDirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, env: environment, encoding: 'utf8' });
const before = await sourceSnapshot();
const outcomes = [];
for (const group of groups) {
  const stdoutPath = path.join(directory, group.id + '.stdout.log'), stderrPath = path.join(directory, group.id + '.stderr.log');
  const stdout = openSync(stdoutPath, 'wx', 0o600), stderr = openSync(stderrPath, 'wx', 0o600);
  const began = new Date().toISOString(), start = performance.now();
  process.stderr.write(JSON.stringify({ event: 'group_started', id: group.id, started_at: began }) + '\n');
  let execution;
  try { execution = spawnSync(group.command, group.args, { cwd: root, env: environment, stdio: ['ignore', stdout, stderr], timeout: 120000, killSignal: 'SIGTERM' }); }
  finally { closeSync(stdout); closeSync(stderr); }
  const output = await readFile(stdoutPath), errors = await readFile(stderrPath), text = output.toString('utf8') + '\n' + errors.toString('utf8');
  const counts = group.runner === 'python-unittest' ? pythonCounts(text, execution.status) : nodeCounts(text);
  const status = execution.status === 0 && !execution.error && !execution.signal && counts.total > 0 && counts.failed === 0 && !counts.cancelled ? 'passed' : 'failed';
  const result = { id: group.id, name: group.name, runner: group.runner, command: [group.command, ...group.args], files: group.files,
    started_at: began, finished_at: new Date().toISOString(), duration_ms: Math.round(performance.now() - start),
    exit_code: execution.status, signal: execution.signal || null, spawn_error_code: execution.error?.code || null, status, counts,
    evidence_scope: group.evidenceScope,
    logs: { stdout: { path: relative(stdoutPath), bytes: output.length, sha256: hash(output) }, stderr: { path: relative(stderrPath), bytes: errors.length, sha256: hash(errors) } } };
  outcomes.push(result);
  process.stderr.write(JSON.stringify({ event: 'group_finished', id: group.id, exit_code: result.exit_code, status, counts }) + '\n');
}
const after = await sourceSnapshot();
let previousBackend;
try {
  const data = await readFile(path.join(root, backendPath)), text = data.toString('utf8');
  previousBackend = { path: backendPath, sha256: hash(data), counts: nodeCounts(text),
    recorded_failure_found: text.includes('Reviewed original source differs: server/shopify.mjs') && text.includes('test/managed-commerce-boundaries.test.mjs'),
    executed_by_this_runner: false };
} catch (error) { previousBackend = { path: backendPath, available: false, read_error_code: error.code || 'READ_FAILED', executed_by_this_runner: false }; }

const count = key => outcomes.reduce((sum, item) => sum + (item.counts[key] ?? 0), 0);
const allGroupsPassed = outcomes.every(item => item.status === 'passed');
const localResult = before.digest !== after.digest ? 'source_changed_during_run' : allGroupsPassed ? 'passed' : 'failed';
const report = {
  schema_version: 2, feature: 'Cnsubscribe Workspace unified Pi Agent and original supplier service',
  started_at: startedAt, finished_at: new Date().toISOString(), runtime: process.version,
  code: { git_head: gitHead.status === 0 ? gitHead.stdout.trim() : null, worktree_changed_or_untracked: gitDirty.status === 0 ? Boolean(gitDirty.stdout.trim()) : null,
    recorded_source_scope: 'server, presets/agent, client and test .mjs/.py/.json files; not an independent review or release approval',
    before_sha256: before.digest, after_sha256: after.digest, unchanged_during_run: before.digest === after.digest, sources: before.files },
  overall: 'release_blocked', release_ready: false, local_automated_result: localResult,
  counts: { groups: outcomes.length, groups_passed: outcomes.filter(item => item.status === 'passed').length, groups_failed: outcomes.filter(item => item.status === 'failed').length,
    tests: count('total'), passed: count('passed'), failed: count('failed'), skipped: count('skipped'), cancelled: count('cancelled'), test_counts_complete: outcomes.every(item => item.counts.total !== null && item.counts.failed !== null) },
  groups: outcomes,
  independent_review: { status: 'blocked', executed_by_this_runner: false, previous_backend: previousBackend,
    test_file: 'test/managed-commerce-boundaries.test.mjs',
    reason: 'The retained backend-second run fails the historical reviewed source pin for server/shopify.mjs. This runner does not change the pin, rerun the independent review, or authorize release. The test file stopped at its top-level pin assertion, so its subsequent historical cases were not executed.',
    missing_evidence_policy: 'A missing or changed historical log cannot clear this gate; original independent-review confirmation is still required.' },
  external_verification: [
    { item: '真实 Muse 连接器创建、Secure Vault 一次录入和运行时长期注入', status: 'not_verified' },
    { item: '真实生产模型端点、账号、收费调用及内容质量', status: 'not_verified' },
    { item: '真实 Brave 查询、供应商 / 市场 / 价格事实核验', status: 'not_verified' },
    { item: '真实 Shopify 店铺授权、草稿创建和批准版本发布', status: 'not_verified' },
    { item: '真实七天销量、商品 / 全店流量区分及对外通知送达', status: 'not_verified' },
    { item: 'workspace.cnsubscribe.xyz 生产 HTTPS、部署和生产备份恢复', status: 'not_verified' },
  ],
  execution_limits: { fixture_only: true, host_credentials_inherited: false, full_backend_rerun: false, independent_review_rerun: false, deployment: false },
  process_exit_code: 1,
};
const jsonPath = path.join(directory, 'report.json'), markdownPath = path.join(directory, 'report.md');
const markdown = ['# 统一 Pi Agent 离线验收记录', '',
  `开始：${report.started_at}；结束：${report.finished_at}。`, '',
  '**发布状态：blocked。** 原 reviewed source pin 门禁尚未通过，本 runner 不重新执行或批准独立审查。', '',
  `本地分组结果：${localResult}。${report.counts.groups} 组中 ${report.counts.groups_passed} 组通过，${report.counts.groups_failed} 组失败；测试 ${report.counts.tests} 项，${report.counts.passed} 通过、${report.counts.failed} 失败、${report.counts.skipped} 跳过。runner 退出码为 1。`, '',
  '| 分组 | 原命令退出码 | 通过 / 总数 | 跳过 | 证据范围 |', '| --- | ---: | ---: | ---: | --- |',
  ...outcomes.map(item => `| ${item.name} | ${item.exit_code ?? item.signal ?? item.spawn_error_code} | ${item.counts.passed ?? '未知'} / ${item.counts.total ?? '未知'} | ${item.counts.skipped ?? '未知'} | ${item.evidence_scope} |`), '',
  '## 保留门禁', '', `引用已有记录：\`${backendPath}\`，本轮未重复 npm test。完整历史统计：${JSON.stringify(previousBackend.counts || null)}。`, '',
  '原 test/managed-commerce-boundaries.test.mjs 顶部 server/shopify.mjs reviewed source pin 失败，后续历史用例未执行。没有改变 pin、删除失败记录或用本地分组通过代替独立审查。', '',
  '## 未验收', '', ...report.external_verification.map(item => '- ' + item.item + '：' + item.status), '',
  '## 可复核输出', '',
  '每组 stdout / stderr 原样分别保存；report.json 包含实际命令、退出码、信号、统计、文件哈希和源文件指纹。无服务端真实凭据注入，源码指纹不表示审查通过。', '',
  `源文件在分组运行间保持一致：${report.code.unchanged_during_run}。Git HEAD：${report.code.git_head || '不可用'}；工作树有改动或未跟踪文件：${report.code.worktree_changed_or_untracked}。`, '',
].join('\n');
await writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
await writeFile(markdownPath, markdown, { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ ...report, code: { ...report.code, sources: { count: before.files.length, detailed_records: relative(jsonPath) } },
  reports: { json: relative(jsonPath), markdown: relative(markdownPath) } }, null, 2) + '\n');
process.exitCode = report.process_exit_code;
