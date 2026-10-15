#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorkspaceClient } from '../packages/workspace-procurement/src/workspace.mjs';
import { workspaceOmpPaths, checkWorkspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { workspaceOmpConfiguration, workspaceOmpConfigured, workspaceOmpPublicToolConfiguration } from '../server/workspace-omp-host.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const help = 'Workspace · 官方 OMP 18.10.4 前端，原 Workspace HTTP/任务/审批/Store 为唯一业务执行权威\n'
  + 'npm run workspace             一次启动原服务；交互终端使用官方 OMP UI，输入沿原 Run\n'
  + 'npm run workspace -- --serve   启动原服务，网页新公开会话默认 OMP\n'
  + 'npm run workspace -- --terminal 明确使用官方 OMP 终端（当前仅原local Session）\n'
  + 'npm run workspace -- --check   只查固定运行器、原绑定、配置；不调用模型\n'
  + 'npm run agent:pi               显式原 Pi 1.1.0 终端回退，不默认双跑\n'
  + '缺依赖：node scripts/setup-omp-runtime.mjs；node scripts/workspace-omp-install.mjs\n'
  + '使用现有 WS_AGENT_URL/WS_AGENT_TOKEN 和选定模型配置。价格与剩余预算未证明时 OMP 未配置。\n'
  + '默认 public 只接受公开资料；资料／询盘 profile 另需原 Library 审核策略，旧 Pi/private transcript 不迁移。\n'
  + '审批、取消、恢复与文书仍使用原 Workspace 页面/API；终端本身不调用模型。';
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
export async function main(args = process.argv.slice(2), environment = process.env) {
  if (args.includes('--help')) { console.log(help); return; }
  if (args.length > 1 || args.some(arg => !['--check', '--serve', '--terminal'].includes(arg))) throw new Error('使用 --help；不接受凭据、任意会话文件或隐式引擎切换参数。');
  const profile = environment.WORKSPACE_OMP_PROFILE || 'public';
  const scopes = { public: 'omp:18.10.4:public-v1', 'factory-materials': 'omp:18.10.4:factory-materials-v1',
    'factory-customers': 'omp:18.10.4:factory-customers-v1', 'factory-inquiries': 'omp:18.10.4:factory-inquiries-v1', 'factory-ingestion': 'omp:18.10.4:factory-ingestion-v1', 'market-validation': 'omp:18.10.4:market-validation-v1' };
  if (!Object.hasOwn(scopes, profile)) throw Error('Use one fixed reviewed OMP profile.');
  const privateProfile = ['factory-materials', 'factory-inquiries', 'factory-ingestion', 'market-validation'].includes(profile);
  const paths = workspaceOmpPaths(environment), configuration = workspaceOmpConfiguration(environment);
  let runtime;
  try { runtime = await verifyWorkspaceOmpRuntime(paths); }
  catch { console.log(JSON.stringify({ status: 'unconfigured', reason: 'FIXED_OMP_RUNTIME_REQUIRED', install: ['node scripts/setup-omp-runtime.mjs', 'node scripts/workspace-omp-install.mjs'], modelCalls: 0 })); process.exitCode = 1; return; }
  const baseURL = environment.WS_AGENT_URL || `http://127.0.0.1:${environment.PORT || 8787}`;
  const serviceOrigin = new URL(baseURL);
  if (!['http:', 'https:'].includes(serviceOrigin.protocol) || serviceOrigin.username || serviceOrigin.password || serviceOrigin.search || serviceOrigin.hash)
    throw new Error('Use the original Workspace HTTP origin without credentials or query parameters.');
  if (args.includes('--check')) {
    const publicConfiguration = workspaceOmpPublicToolConfiguration(environment);
    let backend = { status: 'unconfigured', reason: 'EXISTING_WORKSPACE_BINDING_REQUIRED' };
    if (environment.WS_AGENT_TOKEN) {
      const client = createWorkspaceClient({ baseURL, token: environment.WS_AGENT_TOKEN });
      try { backend = { status: 'configured_unverified', identity: await client.bindingIdentity(), readiness: await client.check() }; }
      catch { backend = { status: 'unavailable', reason: 'ORIGINAL_WORKSPACE_BINDING_REFUSED_OR_UNREACHABLE' }; }
    }
    console.log(JSON.stringify({ status: workspaceOmpConfigured(configuration) && backend.status === 'configured_unverified' ? 'configured_unverified' : 'unconfigured',
      runtime, frontend: { engine: 'omp', profile, engineScope: scopes[profile], provider: configuration.providerId, model: configuration.model,
        modelKeyPresent: Boolean(configuration.apiKey), costReviewed: Boolean(configuration.cost), remainingBudgetReviewed: configuration.remainingBudgetVerified },
      backend, publicToolConfiguration: { search: privateProfile ? 'disabled_in_private_profile' : publicConfiguration.searchProvider === 'disabled' ? 'disabled' : 'supported_unverified',
        searchProvider: privateProfile ? null : publicConfiguration.searchProvider, browser: privateProfile ? 'disabled_in_private_profile' : publicConfiguration.browserExecutable ? 'supported_unverified' : 'unconfigured',
        selectedPublicFileCount: privateProfile ? 0 : publicConfiguration.files.length },
      library: privateProfile ? 'original-reviewed-session-policy-required' : 'disabled', paidModelCalls: 0, modelCalls: 0, businessExecutor: 'original-workspace-runtime' })); return;
  }
  if (!workspaceOmpConfigured(configuration)) {
    console.log(JSON.stringify({ status: 'unconfigured', reason: 'SELECTED_MODEL_COST_AND_REMAINING_BUDGET_REQUIRED', runtime, modelCalls: 0,
      detail: '已继续启动原 Workspace 服务；公开新会话在模型、价格和预算配置完成前明确拒绝模型执行。' }));
  }
  const children = new Set(); let closing = false;
  const close = async () => { if (closing) return; closing = true; for (const child of children) child.kill('SIGTERM'); };
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void close());
  if (!environment.WS_AGENT_URL || args.includes('--serve')) {
    const child = spawn(process.execPath, [path.join(root, 'server/index.mjs')], { cwd: root, env: { ...environment, WORKSPACE_RUNTIME: 'omp' }, stdio: ['ignore', 'pipe', 'inherit'] }); children.add(child);
    child.once('exit', () => { children.delete(child); void close(); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('原 Workspace 服务未在启动时限内确认监听。')), 30000);
      child.stdout.on('data', data => { process.stdout.write(data); if (String(data).includes('Workspace server:')) { clearTimeout(timer); resolve(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); reject(new Error('原 Workspace 服务启动失败：' + code)); });
    }).catch(async error => { await close(); throw error; });
  }
  if (environment.WS_AGENT_URL && !args.includes('--serve')) console.log('使用现有原 Workspace 服务：' + baseURL);
  if (!await fs.stat(path.join(root, 'dist/index.html')).then(() => true).catch(() => false)) console.log('网页构建产物缺失；原 API 已启动。请运行 npm run build 后刷新网页。');
  const terminalRequested = args.includes('--terminal') || !args.includes('--serve') && process.stdin.isTTY && process.stdout.isTTY;
  if (!terminalRequested) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) { await close(); throw new Error('官方 OMP 终端需要交互 TTY；无 TTY 时使用原网页服务。'); }
  const home = await fs.mkdtemp('/tmp/workspace-omp-terminal-home-');
  const terminalEnvironment = { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: home, TMPDIR: home,
    PI_CODING_AGENT_DIR: home + '/agent', PI_NO_TITLE: '1', WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot,
    WS_AGENT_URL: baseURL, WS_AGENT_SESSION_DIR: home };
  for (const key of ['WS_AGENT_TOKEN', 'PI_PROVIDER', 'PI_MODEL', 'PI_BASE_URL', 'WORKSPACE_OMP_PROFILE'])
    if (environment[key]) terminalEnvironment[key] = environment[key];
  const terminal = spawn(paths.bun, [path.join(root, 'scripts/workspace-omp-terminal.mjs')], { cwd: home, env: terminalEnvironment, stdio: 'inherit' });
  children.add(terminal);
  try { await new Promise((resolve, reject) => { terminal.once('error', reject); terminal.once('close', code => code === 0 ? resolve() : reject(new Error('官方 OMP 终端已停止：' + code))); }); }
  finally { children.delete(terminal); await close(); await fs.rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
