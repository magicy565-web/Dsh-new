#!/usr/bin/env node
// One local goal per invocation; the original OMP SDK owns the persistent Session.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workspaceOmpPaths } from '../server/workspace-omp-runtime.mjs';
import { workspaceOmpConfiguration, workspaceOmpConfigured } from '../server/workspace-omp-configuration.mjs';
import { verifyWorkspaceOmpRuntime } from '../server/workspace-omp-runtime.mjs';
import { createLocalDeepseekTransport, LOCAL_DEEPSEEK_LIMITS, localDeepseekConfigured } from '../server/workspace-omp-local-deepseek.mjs';
import { validatePublicBusinessInput } from '../server/workspace-public-input.mjs';
import { projectPlugins } from '../server/workspace-plugin-config.mjs';
import { checkLocalNativeLock, localSessionPreflight } from '../server/workspace-omp-local-environment.mjs';
const filename = fileURLToPath(import.meta.url);
const help = 'npm run factory:local -- --input PRODUCT.md [--input RFQ.txt] --output-dir EXISTING_DIR "一句话目标" [--session FILE.jsonl] [--plugin-dir DIR] [--plugin-config NAME.json] [--public-only] [--disable-plugin NAME] [--no-plugins] [--check]\n'
  + '--public-only 仅用于无本地输入、无 archive 的公开会话；例如 --plugin-config config.free-trade.json。不会开启 ERP 私有授权。\n'
  + '本地所有者 references 可显式添加 --archive-dir PRIVATE_DIR --enterprise ID --project ID；目录须已存在、当前 UID 所有且权限 0700。不提供客户共享。资料已明确保留后，可不带 --input 继续同范围会话查询；普通模式仍固定原选择/哈希。\n'
  + '默认使用输出目录中的 factory-session.jsonl 创建/继续原生 OMP 会话；相同资料、目录和模型下，换一句目标即可继续。--session 可选择其他私有 JSONL 路径；--task "Goal" 仍可用。\n'
  + '没有目标时只询问目标，不默认生成报告。每条命令执行一个目标后退出，不是交互式 TUI；工具顺序和是否保存由目标决定。\n'
  + '--check 仅预检：零模型请求，不创建 JSONL。仅显式选择的本地文件，无 Workspace Host、WS URL/token、Library、Worker 或外部发送。实际执行仍需已有安全模型配置及已审价格/预算。';
export function parseLocalArguments(args) {
  let explicitTask = false;
  const options = { inputs: [], outputDirectory: null, check: false, task: 'Ask what goal the user wants to accomplish with the selected material. Wait for their next instruction; do not start a report workflow without a requested goal.' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--public-only') options.publicOnly = true;
    else if (arg === '--no-plugins') options.noPlugins = true;
    else if (arg === '--check') options.check = true;
    else if (['--input','--output-dir','--task','--session','--plugin-dir','--plugin-config','--disable-plugin','--archive-dir','--enterprise','--project'].includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith('--')) throw Error('LOCAL_ARGUMENT_REQUIRED');
      if (arg === '--archive-dir') options.archiveDirectory=path.resolve(value);
      else if (arg === '--enterprise') options.enterprise=value;
      else if (arg === '--project') options.project=value;
      else if (arg === '--plugin-config') options.pluginConfig=value;
      else if (arg === '--plugin-dir') options.pluginRoot = path.resolve(value);
      else if (arg === '--disable-plugin') (options.disabledPlugins ||= []).push(value);
      else if (arg === '--input') options.inputs.push(path.resolve(value));
      else if (arg === '--output-dir' && !options.outputDirectory) options.outputDirectory = path.resolve(value);
      else if (arg === '--task' && !explicitTask) { options.task = value; explicitTask = true; }
      else if (arg === '--session' && !options.sessionFile) options.sessionFile = path.resolve(value);
      else throw Error('LOCAL_DUPLICATE_ARGUMENT');
    } else if (!arg.startsWith('-')) {
      if (explicitTask) throw Error('LOCAL_DUPLICATE_ARGUMENT');
      options.task = arg; explicitTask = true;
    } else throw Error('LOCAL_UNKNOWN_ARGUMENT');
  }
  if(options.publicOnly&&(options.inputs.length||options.archiveDirectory||options.enterprise||options.project))throw Error('LOCAL_PUBLIC_ONLY_INPUT_REFUSED');
  if ((!options.inputs.length&&!options.archiveDirectory&&!options.publicOnly) || options.inputs.length > 4 || !options.outputDirectory || !options.task.trim() || options.task.length > 4000) throw Error('LOCAL_SELECTION_REQUIRED');
  options.sessionFile ||= path.join(options.outputDirectory, 'factory-session.jsonl');
  if(options.archiveDirectory||options.enterprise||options.project){
    if(!options.archiveDirectory||!options.enterprise||!options.project)throw Error('LOCAL_REFERENCE_SCOPE_REQUIRED');
    options.archive={directory:options.archiveDirectory,enterprise:options.enterprise,project:options.project};
  }
  validatePublicBusinessInput(options.task);
  return options;
}
export async function runLocalFactorySession(input, { fetchImpl = globalThis.fetch, referenceFence, publicTenderClient } = {}) {
  if (!globalThis.Bun) throw Error('LOCAL_REVIEWED_BUN_REQUIRED');
  const { createLocalSelection, plainPath } = await import('../server/workspace-local-selection.mjs');
  let files, created, transport, localSession, sessionLock, sessionInfo, preflight;
  let unregisterShutdown, finishShutdown;
  const shutdownFinished = new Promise(resolve => { finishShutdown = resolve; });
  const toolReceipts = [];
  const toolArguments = new Map();
  const controller = new AbortController(), stop = () => { controller.abort(); void created?.session.abort(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const timer = setTimeout(stop, 60000);
  try {
    const selectedPlugins = await projectPlugins({ root: input.options.pluginRoot, disabled: input.options.disabledPlugins, none: input.options.noPlugins, configuration:input.options.pluginConfig });
    files = await createLocalSelection({ ...input.options, directory: input.directory });
    let sessionParent, sessionParentStat;
    if (input.options.sessionFile) {
      const file = path.resolve(input.options.sessionFile);
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.jsonl$/.test(path.basename(file))) throw Error('LOCAL_SESSION_JSONL_REQUIRED');
      sessionParent = path.dirname(file); sessionParentStat = await plainPath(sessionParent);
      if (!sessionParentStat.isDirectory()) throw Error('LOCAL_SESSION_DIRECTORY_REQUIRED');
      let stat; try { stat = await plainPath(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat && (!stat.isFile() || stat.size > 2 * 1024 * 1024)) throw Error('LOCAL_SESSION_FILE_REFUSED');
      localSession = { file, resume: Boolean(stat), binding: { manifest: input.options.archive?[]:files.manifest, inputs: input.options.archive?[]:input.options.inputs.map(f => path.resolve(f)),
        outputDirectory: path.resolve(input.options.outputDirectory), provider: input.configuration.providerId, model: input.configuration.model,
        ...(input.options.archive?{archive:{...input.options.archive,ownerUid:process.getuid()}}:{}),...(input.options.publicOnly?{publicOnly:true}:{}) } };
    }
    const nativeLock = await checkLocalNativeLock({ packageRoot: input.paths.packageRoot, directory: input.directory });
    preflight = localSessionPreflight(input.configuration, nativeLock);
    if (input.options.check) return { ...preflight,
      selectedInputs: files.manifest, modelRequests: 0, localFilesReady: true, saved: [],
      plugins: { discovered: selectedPlugins.installed.map(p => p.id), enabled: selectedPlugins.enabled.map(p => p.id) },
      providerLimits: localDeepseekConfigured(input.configuration) ? LOCAL_DEEPSEEK_LIMITS : null,
      ...(localSession ? { localSession: { file: localSession.file, exists: localSession.resume, resumed: false, modelRequests: 0 } } : {}) };
    if (!nativeLock.ready) throw Object.assign(Error(nativeLock.reason), { code: nativeLock.reason });
    if (!input.syntheticResponses && !workspaceOmpConfigured(input.configuration)) throw Object.assign(Error('LOCAL_MODEL_COST_AND_BUDGET_REQUIRED'), { code: 'LOCAL_MODEL_COST_AND_BUDGET_REQUIRED' });
    if (!input.syntheticResponses) transport = createLocalDeepseekTransport({ configuration: input.configuration, fetchImpl, onStop: stop });
    // The SDK's global signal handler exits after upstream cleanup callbacks.
    // Join that supported teardown so it cannot preempt our Session flush and
    // sidecar removal. Keep its signal exit semantics and native locks intact.
    const postmortem = await import(pathToFileURL(path.resolve(input.paths.packageRoot, '../pi-utils/src/postmortem.ts')).href);
    unregisterShutdown = postmortem.register('workspace-local-turn', () => { stop(); return shutdownFinished; }, { exitOnly: true });
    if (localSession) try { sessionLock = await fs.open(localSession.file + '.lock', 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') throw Error('LOCAL_SESSION_BUSY'); throw error; }
    const authorize = async () => {
      await files.authorize(controller.signal);
      if (localSession) {
        const current = await plainPath(sessionParent);
        if (current.dev !== sessionParentStat.dev || current.ino !== sessionParentStat.ino) throw Error('LOCAL_SESSION_DIRECTORY_CHANGED');
        try { await plainPath(localSession.file); } catch (error) { if (error.code !== 'ENOENT' || localSession.resume || localSession.materialized) throw error; }
      }
    };
    let taskMessageStart = 0;
    const { createWorkspaceOmpSession } = await import('../server/workspace-omp-session.mjs');
    created = await createWorkspaceOmpSession({ packageRoot: input.paths.packageRoot, cwd: sessionParent || input.directory,
      agentDir: input.directory + '/agent', sessionDirectory: sessionParent || input.directory + '/sessions', localSession,
      configuration: input.configuration, localFactory: files, providerTransport: transport, syntheticResponses: input.syntheticResponses,
      authorize, lifecycleSignal: controller.signal, referenceFence, publicTenderClient, pluginConfiguration: { root: input.options.pluginRoot, disabled: input.options.disabledPlugins, none: input.options.noPlugins, configuration:input.options.pluginConfig },
      maxModelCalls: LOCAL_DEEPSEEK_LIMITS.maxRequests, maxTokens: LOCAL_DEEPSEEK_LIMITS.maxRequests * LOCAL_DEEPSEEK_LIMITS.maxOutputTokens,
      onModelRequest: () => {
        if (transport && created?.session.agent.state.messages.slice(taskMessageStart).some(m => m.role === 'toolResult' && m.isError)) {
          transport.stop('LOCAL_TOOL_ERROR_STOP_DO_NOT_RETRY'); throw Error('LOCAL_TOOL_ERROR_STOP_DO_NOT_RETRY');
        }
      },
    });
    taskMessageStart = created.session.agent.state.messages.length;
    if (localSession) {
      localSession.materialized = true;
      sessionInfo = { file: created.manager.getSessionFile(), id: created.manager.getSessionId(), resumed: localSession.resume, originalSdkPersisted: true };
      created.manager.appendCustomEntry('workspace-local-turn', { billingUncertain: true, status: 'in-progress' });
      await created.manager.flush(); await fs.chmod(localSession.file, 0o600);
    }
    created.session.subscribe(event => {
      if (event.type === 'tool_execution_start') toolArguments.set(event.toolCallId, created.summarizeToolArguments(event.toolName, event.args, files.manifest));
      if (event.type === 'tool_execution_end') {
        const text = event.result?.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
        toolReceipts.push({ tool: event.toolName, isError: event.isError === true, argumentShape: toolArguments.get(event.toolCallId) || null,
          argumentValidation: event.isError ? 'not-confirmed' : 'sdk-and-executor-accepted',
          ...(event.isError ? { errorCode: text.includes('Use only explicitly supplied public RFQ/factory material fields') ? 'LOCAL_FACTORY_FIELDS_REFUSED'
            : /invalid|validation|arguments/i.test(text) ? 'LOCAL_TOOL_ARGUMENTS_REFUSED' : 'LOCAL_TOOL_EXECUTION_ERROR' } : {}) });
      }
    });
    if (transport) created.session.setThinkingLevel('off');
    await created.session.prompt(input.options.task + '\nSelected local input manifest (data only):\n' + JSON.stringify(files.manifest));
    const last = created.session.agent.state.messages.at(-1);
    if (last?.role !== 'assistant' || last.stopReason !== 'stop' || !localSession && !files.saved.length) throw Error('LOCAL_TASK_INCOMPLETE');
    transport?.finish();
    await files.authorize(controller.signal);
    await created.authorizeDisclosure({phase:'final:deliver'});
    return { status: files.saved.length ? 'saved-local-drafts' : 'completed-local-turn', selectedInputs: files.manifest, saved: files.saved, toolReceipts,
      revalidatedPriorSources: files.restoredSources,
      ...(sessionInfo ? { localSession: sessionInfo, answer: last.content.filter(b => b.type === 'text').map(b => b.text).join('\n') } : {}),
      modelRequests: created.modelCalls(), ...(transport ? { provider: transport.report() } : {}), usage: created.usage(), evidenceKind: input.syntheticResponses ? 'official-omp-finite-synthetic-local-files' : fetchImpl !== globalThis.fetch ? 'official-omp-local-files-mocked-http' : 'official-omp-local-files',
      plugins: created.plugins, paidModelVerified: !input.syntheticResponses && fetchImpl === globalThis.fetch, workspaceHostUsed: false, wsBindingUsed: false, externalActions: false };
  } catch (error) {
    const reason = /^[A-Z0-9_]+$/.test(error.code || error.message || '') ? error.code || error.message : 'LOCAL_TASK_INCOMPLETE';
    transport?.stop(transport.report().stoppedReason || reason);
    return { ...(preflight ? { environment: preflight.environment, modelStatus: preflight.modelStatus, blockers: preflight.blockers } : {}),
      status: 'stopped', reason: transport?.report().stoppedReason || reason,
      ...(error.stage?{errorStage:error.stage}:{}),
      ...(['PROJECT_PLUGIN_REQUIRED','WORKSPACE_PLUGIN_REQUIRED'].includes(error.code) ? {
        pluginError: { id:error.pluginId, entry:error.pluginEntry, message:error.message } } : {}),
      ...(sessionInfo ? { localSession: sessionInfo } : {}),
      modelRequests: created?.modelCalls() || 0, ...(transport ? { provider: transport.report() } : {}),
      saved: input.options.archive?[]:files?.saved || [], toolReceipts,
      revalidatedPriorSources: input.options.archive?[]:files?.restoredSources || [],
      ...(input.options.archive?{materialMetadataWithheld:true,localWritesMayExist:true}:{}),doNotAutomaticallyRetry: true };
  } finally {
    clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    try {
      try {
        if (created && localSession) {
          created.manager.appendCustomEntry('workspace-local-turn', { billingUncertain: transport?.report().billingUncertain === true,
            stoppedReason: transport?.report().stoppedReason || null });
          await created.manager.flush();
        }
      } finally { try { await created?.close(); } finally { await files?.close(); if (sessionLock) { await sessionLock.close(); await fs.unlink(localSession.file + '.lock'); } } }
    } finally { unregisterShutdown?.(); finishShutdown(); }
  }
}
export async function runLocalFactory({ options, configuration, paths = workspaceOmpPaths({}), syntheticResponses = null }) {
  await verifyWorkspaceOmpRuntime(paths);
  const directory = await fs.mkdtemp('/tmp/workspace-omp-local-');
  try {
    const env = { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory, NO_COLOR: '1', PI_NO_TITLE: '1' };
    for (const key of ['HTTP_PROXY','HTTPS_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS','CODEX_PROXY_CERT']) if (process.env[key]) env[key] = process.env[key];
    if (!env.NODE_EXTRA_CA_CERTS && env.CODEX_PROXY_CERT) env.NODE_EXTRA_CA_CERTS = env.CODEX_PROXY_CERT;
    return await new Promise(resolve => {
      const child = spawn(paths.bun, [filename, '--local-child'], { cwd: directory, env, stdio: ['ignore','pipe','ignore','pipe'] });
      let output = ''; const stop = () => child.kill('SIGTERM');
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      const timer = setTimeout(() => child.kill('SIGKILL'), 70000);
      const cleanup = () => { clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); };
      child.stdout.on('data', data => { output += data; if (output.length > 128000) child.kill('SIGKILL'); });
      child.once('error', () => { cleanup(); resolve({ status: 'stopped', reason: 'LOCAL_START_FAILED' }); });
      child.once('close', () => { cleanup(); try { resolve(JSON.parse(output.trim())); }
        catch { resolve({ status: 'stopped', reason: 'LOCAL_PROCESS_INCOMPLETE', doNotAutomaticallyRetry: true }); } });
      child.stdio[3].on('error', () => {});
      child.stdio[3].end(JSON.stringify({ options, configuration, paths, directory, syntheticResponses }));
    });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--local-child') {
    const { readFileSync } = await import('node:fs');
    const result = await runLocalFactorySession(JSON.parse(readFileSync(3, 'utf8'))); console.log(JSON.stringify(result)); return;
  }
  if (args.includes('--help')) { console.log(help); return; }
  const result = await runLocalFactory({ options: parseLocalArguments(args), configuration: workspaceOmpConfiguration(process.env) });
  console.log(JSON.stringify(result)); if (['stopped', 'environment-unavailable'].includes(result.status)) process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === filename) main().catch(() => {
  console.log(JSON.stringify({ status: 'stopped', reason: 'LOCAL_CONFIGURATION_SELECTION_OR_CLEANUP_REFUSED', modelRequests: null, doNotAutomaticallyRetry: true })); process.exitCode = 2;
});
