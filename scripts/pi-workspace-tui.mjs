#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorkspaceClient, workspaceExtension, WORKSPACE_TOOLS } from '../pi/extensions/workspace.mjs';

const launcher = fileURLToPath(import.meta.url);

// Official Pi owns the editor, terminal rendering, Agent and extension lifecycle.
// All business work goes through Workspace's existing authenticated task APIs.
export async function createWorkspaceTuiRuntime({ client, isolationDirectory, sample = false, close = async () => {} }) {
  if (!path.isAbsolute(isolationDirectory)) throw new Error('The TUI requires an explicit isolated directory.');
  const agentDir = path.join(isolationDirectory, 'agent');
  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = '1';
  const { createAgentSession, createAgentSessionRuntime, DefaultResourceLoader, InteractiveMode, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
  const { InMemoryCredentialStore } = await import('@earendil-works/pi-ai');
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  let faux, model;
  if (sample) {
    const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await import('@earendil-works/pi-ai/providers/faux');
    faux = fauxProvider({ api: 'faux', provider: 'workspace-tui-controlled-faux', models: [{ id: 'workspace-tui-sample', name: 'Controlled faux sample (no model account)', maxTokens: 1600 }] });
    const response = request => {
      const last = request.messages.at(-1);
      if (last?.role === 'toolResult') {
        const receipt = last.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        let business = false;
        try { const value = JSON.parse(receipt); business = value.profile === 'business-preset' && value.identity === 'taskId'; } catch { /* No business identity is inferred from prose. */ }
        return fauxAssistantMessage(`Original Workspace task receipt (controlled faux transport):\n${receipt}\nUse ${business ? '/ws-business-status TASK_ID' : '/ws-status RUN_ID'} to read its current persisted result.`);
      }
      const input = typeof last?.content === 'string' ? last.content : (last?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
      if (input.startsWith('PUBLIC_BUSINESS_FIXTURE ')) {
        // Explicit sample-only native tool-dispatch fixture, never inferred
        // business data, a backend model configuration or permission grant.
        let task; try { task = JSON.parse(input.slice('PUBLIC_BUSINESS_FIXTURE '.length)); } catch { return fauxAssistantMessage('Provide valid explicit public fixture JSON; no business task was submitted.'); }
        return fauxAssistantMessage(fauxToolCall('workspace_business_task', task), { stopReason: 'toolUse' });
      }
      return fauxAssistantMessage(fauxToolCall('workspace_delegate', { title: 'Public synthetic TUI sample', content: input }), { stopReason: 'toolUse' });
    };
    // Bounded deterministic test transport. This is not evidence of an actual
    // model account or live provider; all displayed business receipts are HTTP.
    faux.setResponses(Array.from({ length: 32 }, () => response));
    modelRuntime.registerNativeProvider(faux.provider);
    model = faux.getModel();
  }
  const settingsManager = SettingsManager.inMemory({ defaultTools: [], compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off', quietStartup: false });
  const resourceLoader = new DefaultResourceLoader({ cwd: isolationDirectory, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [workspaceExtension(client, { sample, close })],
    systemPrompt: 'You are a Workspace task client. Use only explicitly supplied public text. The original Workspace service controls tasks, model budgets, native children, exact approvals and durable results. Never infer success or approve an action. No shell, filesystem, browser or arbitrary HTTP tool is available.' });
  await resourceLoader.reload();
  const services = { cwd: isolationDirectory, agentDir, modelRuntime, settingsManager, resourceLoader, diagnostics: [] };
  const factory = async ({ sessionManager, sessionStartEvent }) => ({ ...(await createAgentSession({ cwd: isolationDirectory, agentDir, modelRuntime, model,
    thinkingLevel: 'off', scopedModels: model ? [{ model, thinkingLevel: 'off' }] : [], noTools: 'builtin', tools: [...WORKSPACE_TOOLS],
    resourceLoader, sessionManager, settingsManager, sessionStartEvent })), services, diagnostics: [] });
  const runtime = await createAgentSessionRuntime(factory, { cwd: isolationDirectory, agentDir, sessionManager: SessionManager.inMemory(isolationDirectory) });
  return { runtime, faux, InteractiveMode };
}

async function isolatedMain({ sample, check, isolationDirectory }) {
  let development;
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await development?.close(); } };
  let host;
  if (sample) {
    const { startPiDevelopment } = await import('../server/pi-development.mjs');
    development = await startPiDevelopment({ dataDirectory: path.join(isolationDirectory, 'workspace') });
    host = { baseURL: development.baseURL, token: development.token };
  } else host = { baseURL: process.env.WS_AGENT_URL, token: process.env.WS_AGENT_TOKEN };
  const client = createWorkspaceClient(host);
  const { runtime, faux, InteractiveMode } = await createWorkspaceTuiRuntime({ client, isolationDirectory, sample, close });
  try {
    if (check) {
      await runtime.session.bindExtensions({});
      console.log(JSON.stringify({ runtime: 'official-pi-coding-agent', version: '1.1.0', transport: sample ? 'controlled-faux' : 'workspace-command-profile',
        tools: runtime.session.getActiveToolNames(), sessionFile: runtime.session.sessionFile || null, modelCalls: faux?.state.callCount || 0 }));
      return;
    }
    const mode = new InteractiveMode(runtime, { startupDiagnostics: [{ type: 'info', message: sample
      ? 'Workspace public synthetic sample · official Pi TUI · keyless controlled faux · actual backend task receipts · business documents are synthetic and unverified'
      : 'Workspace command profile · original backend authority · TUI natural-language model calls blocked' }] });
    await mode.run();
  } finally { await runtime.dispose(); await close(); }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('Official Pi Workspace TUI\n  npm run agent:tui -- --sample   Public synthetic, keyless controlled faux development sample\n  npm run agent:tui               Original WS_AGENT_URL / WS_AGENT_TOKEN injected in memory; command profile\n  --check                        Inspect installed official runtime and plugin tools without model calls\n\n/ws-task {"title":"Public task","content":"Explicit public text"}\n/ws-delegate {"title":"Public task","content":"Explicit public text"}\n/ws-status RUN_ID\n/ws-cancel RUN_ID\n/ws-resume RUN_ID\n/ws-approve RUN_ID PROPOSAL_ID\n/ws-continue RUN_ID PROPOSAL_ID\n/ws-presets\n/ws-business {"type":"procurement","title":"Public procurement","input":{"product":"Public cup","spec":"Public specification","quantity":10},"requestId":"public-business-1"}\n/ws-business-status TASK_ID\n/ws-business-resume TASK_ID\n/ws-quit');
    return;
  }
  if (args.some(arg => !['--sample', '--check', '--isolated-child'].includes(arg))) throw new Error('Invalid TUI options. Use --help; credentials cannot be command-line arguments.');
  const sample = args.includes('--sample'), check = args.includes('--check');
  if (args.includes('--isolated-child')) {
    const isolationDirectory = process.env.WORKSPACE_PI_TUI_ISOLATION;
    if (!isolationDirectory || !path.isAbsolute(isolationDirectory)) throw new Error('The official TUI child requires its isolated directory.');
    return isolatedMain({ sample, check, isolationDirectory });
  }
  if (!check && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Start the official Pi TUI in an interactive terminal, or use --check.');
  const isolationDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-pi-tui-'));
  try {
    // Do not inherit user model keys, ~/.pi config overrides, .env loading, npm
    // settings, external editor commands or proxy credentials into the TUI.
    const env = { PATH: process.env.PATH, TERM: process.env.TERM || 'xterm-256color', LANG: process.env.LANG || 'C.UTF-8',
      PI_OFFLINE: '1', PI_CODING_AGENT_DIR: path.join(isolationDirectory, 'agent'), WORKSPACE_PI_TUI_ISOLATION: isolationDirectory,
      ...(process.env.COLORTERM ? { COLORTERM: process.env.COLORTERM } : {}),
      ...(!sample ? { WS_AGENT_URL: process.env.WS_AGENT_URL || '', WS_AGENT_TOKEN: process.env.WS_AGENT_TOKEN || '' } : {}) };
    const child = spawn(process.execPath, [launcher, '--isolated-child', ...(sample ? ['--sample'] : []), ...(check ? ['--check'] : [])], { cwd: isolationDirectory, env, stdio: 'inherit' });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    try {
      const outcome = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
      process.exitCode = outcome.code ?? (outcome.signal ? 1 : 0);
    } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
  } finally { await fs.rm(isolationDirectory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === launcher) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
