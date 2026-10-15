#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { lazyStream } from '@earendil-works/pi-ai/api/lazy';
import { createWorkspaceClient, WORKSPACE_AGENT_TOOLS } from '../pi/extensions/workspace.mjs';
import { WORKSPACE_PLUGIN_CAPABILITIES } from '../pi/extensions/workspace-read.mjs';
import { createWorkspaceTuiRuntime } from './pi-workspace-tui.mjs';
import { loadPiProviderConfig } from '../server/pi-provider-config.mjs';
import { createWorkspacePiModelProfile } from '../server/pi-model-profile.mjs';

const libraryTools = new Set(['workspace_company_profile', 'workspace_products', 'workspace_product']);
function cachedLibraryReceipts(messages) {
  return messages.flatMap(message => {
    if (message?.role !== 'toolResult' || !libraryTools.has(message.toolName)) return [];
    let value;
    try { value = JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')); }
    catch { throw new Error('Library cached receipt cannot be reauthorized. Start a fresh transcript.'); }
    if (['available', 'empty'].includes(value?.status)) {
      if (value.plugin !== 'workspace-library' || !value.authorization) throw new Error('Library cached receipt lacks its original authorization.');
      return [value];
    }
    return [];
  });
}

async function privateDirectory(directory) {
  if (!path.isAbsolute(directory)) throw new Error('Use an absolute private Workspace Agent session directory.');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory
    || process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid()))
    throw new Error('Workspace Agent sessions require an owned private directory without symbolic links.');
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) throw new Error('Unsafe Workspace Agent session entry.');
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await privateDirectory(filename);
    else if (process.platform !== 'win32') await fs.chmod(filename, 0o600);
  }
}

// Official transcript persistence only. Business records remain in the original
// Workspace Store and every result read revalidates the original HTTP binding.
export async function createWorkspaceAgentRuntime({ client, isolationDirectory, modelRuntime, model, sessionManager,
  continueSession = false, close = async () => {} }) {
  if (!modelRuntime || typeof modelRuntime.getModel !== 'function' || !model || !modelRuntime.getModel(model.provider, model.id))
    throw new Error('The development Agent requires an explicit official model runtime and registered model. No sample fallback is available.');
  const backend = await client.check();
  if (!/^[a-f0-9]{64}$/.test(client.bindingFingerprint || '')) throw new Error('The original Workspace service binding is required for session isolation.');
  await privateDirectory(isolationDirectory);
  const sessionDirectory = path.join(isolationDirectory, 'sessions', client.bindingFingerprint);
  await privateDirectory(sessionDirectory);
  const manager = sessionManager || (continueSession ? SessionManager.continueRecent(isolationDirectory, sessionDirectory) : SessionManager.create(isolationDirectory, sessionDirectory));
  // Do not send a reopened transcript's cached business documents to a model
  // after its original member/task access has disappeared. Task state still
  // requires a subsequent fresh tool read; this is an access guard only.
  const previousTasks = new Set();
  for (const entry of manager.getEntries()) {
    const message = entry.message;
    if (message?.role !== 'toolResult' || !['workspace_business_task', 'workspace_business_status', 'workspace_business_tasks', 'workspace_business_result'].includes(message.toolName)) continue;
    let receipt;
    try { receipt = JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')); } catch { continue; }
    if (receipt?.profile === 'business-preset' && typeof receipt.task?.taskId === 'string') previousTasks.add(receipt.task.taskId);
    if (receipt?.profile === 'business-preset' && Array.isArray(receipt.tasks)) for (const task of receipt.tasks) if (typeof task?.taskId === 'string') previousTasks.add(task.taskId);
  }
  for (const taskId of previousTasks) await client.businessStatus(taskId);
  const prepareSession = async session => {
    const receipts = () => cachedLibraryReceipts(session.sessionManager.getEntries().map(entry => entry.message));
    for (const receipt of receipts()) await client.revalidateLibraryReceipt(receipt, session.model);
    // Official Agent context hook runs BEFORE every model call. Scanning the
    // original transcript also covers compacted branches and cached summaries.
    // The runtime factory reinstalls this guard on switch/import/fork/new.
    const originalTransform = session.agent.transformContext;
    session.agent.transformContext = async (messages, signal) => {
      for (const receipt of receipts()) await client.revalidateLibraryReceipt(receipt, session.model, signal);
      return originalTransform ? originalTransform(messages, signal) : messages;
    };
  };
  const created = await createWorkspaceTuiRuntime({ client, isolationDirectory, agent: true, modelRuntime, model, sessionManager: manager, prepareSession, close });
  return { ...created, backend };
}

// A transport-only guard around the official API: fixed per-response token cap,
// no retry, disabled reasoning, and no credential text in transcript/UI output.
// It does not replace the official Agent loop or the backend budget authority.
export async function createWorkspaceAgentModel(configuration, secrets = [], { beforeModelRequest = async () => {} } = {}) {
  if (!configuration.apiKey?.trim()) throw new Error('The existing host model key is missing. Configure the selected provider safely outside chat; no sample or alternate account is used.');
  const hidden = [configuration.apiKey, ...secrets].filter(Boolean);
  const redact = value => typeof value === 'string' ? hidden.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value)
    : Array.isArray(value) ? value.map(redact) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redact(item)])) : value;
  const original = openAICompletionsApi();
  const guarded = method => (model, context, options) => lazyStream(model, async () => {
    // Optional admission hook for bounded acceptance. The official SDK still
    // owns serialization, streaming and AgentSession/tool execution.
    try { await beforeModelRequest({ model, context }); }
    catch { throw new Error('The configured model admission refused this request. No provider request was sent.'); }
    const signal = options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
    const source = original[method](model, context, { ...options, signal, env: {}, maxTokens: Math.min(1600, options?.maxTokens ?? 1600), maxRetries: 0, timeoutMs: 60_000, reasoning: 'off' });
    return {
      async *[Symbol.asyncIterator]() { try { for await (const event of source) yield redact(event); } catch { throw new Error('The configured model transport failed. No task completion is implied.'); } },
      async result() { try { return redact(await source.result()); } catch { throw new Error('The configured model transport failed. No task completion is implied.'); } },
    };
  });
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  modelRuntime.registerNativeProvider(createWorkspacePiModelProfile({ ...configuration, api: { stream: guarded('stream'), streamSimple: guarded('streamSimple') } }));
  const model = modelRuntime.getModel(configuration.providerId, configuration.model);
  if (!model) throw new Error('The configured official model is unavailable.');
  return { modelRuntime, model };
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  if (args.includes('--help')) {
    console.log('Workspace backend development Agent · official Pi AgentSession\n  npm run agent:dev                 Natural input → original business tools → persisted tasks/documents\n  npm run agent:dev -- --continue    Reopen latest official transcript for this existing service binding\n  npm run agent:dev -- --check       Verify configuration and original health/presets; zero model calls\n\nHost environment: WS_AGENT_URL, WS_AGENT_TOKEN; existing PI_PROVIDER / PI_MODEL / selected provider key. Optional WS_AGENT_SESSION_DIR: absolute owned private transcript directory. No credential arguments, profile files or sample fallback.\nOnly public input. Human controls (visible confirmation):\n/ws-business-status TASK_ID\n/ws-business-cancel TASK_ID\n/ws-business-resume TASK_ID STABLE_REQUEST_ID\n/ws-approve RUN_ID PROPOSAL_ID\n/ws-continue RUN_ID PROPOSAL_ID STABLE_REQUEST_ID\n/ws-cancel RUN_ID\n/ws-resume RUN_ID STABLE_REQUEST_ID\nEsc cancels the frontend turn; use original task cancellation for admitted work. /ws-quit closes the terminal.');
    return;
  }
  if (args.some(arg => !['--check', '--continue'].includes(arg))) throw new Error('Invalid development Agent options. Use --help; no sample, credential or arbitrary session-file arguments are accepted.');
  const client = createWorkspaceClient({ baseURL: environment.WS_AGENT_URL, token: environment.WS_AGENT_TOKEN });
  const configuration = loadPiProviderConfig(environment);
  const frontend = await createWorkspaceAgentModel(configuration, [environment.WS_AGENT_TOKEN]);
  const backend = await client.check();
  if (args.includes('--check')) {
    console.log(JSON.stringify({ runtime: 'official-pi-coding-agent', version: '1.1.0', profile: 'workspace-business-agent',
      tools: [...WORKSPACE_AGENT_TOOLS], plugins: WORKSPACE_PLUGIN_CAPABILITIES,
      frontend: { provider: configuration.providerId, model: configuration.model, configured: true, onlineVerified: false, modelCalls: 0 },
      backend: { ...backend, naturalLanguage: 'official-frontend-agent' }, paidCalls: 0 }));
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Start agent:dev in an interactive terminal, or use --check.');
  const isolationDirectory = environment.WS_AGENT_SESSION_DIR || path.join(os.homedir(), '.local', 'state', 'workspace-pi-development');
  process.umask(0o077);
  // This CLI owns its process. InteractiveMode still uses these SDK discovery
  // settings; shared web/session factories must leave process globals alone.
  process.env.PI_CODING_AGENT_DIR = path.join(isolationDirectory, 'agent');
  process.env.PI_OFFLINE = '1';
  const { runtime, InteractiveMode } = await createWorkspaceAgentRuntime({ client, isolationDirectory, ...frontend, continueSession: args.includes('--continue') });
  try {
    await new InteractiveMode(runtime, { startupDiagnostics: [{ type: 'info', message: 'Workspace development Agent · official Pi AgentSession · original business task authority · no live provider verification' }] }).run();
  } finally {
    await runtime.dispose();
    await privateDirectory(isolationDirectory);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
