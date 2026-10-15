#!/usr/bin/env node
// One real model-only smoke through the original OMP Session/provider.
// No ambient business client, tools, credentials, transcripts or alternate loop.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const filename = fileURLToPath(import.meta.url);
export const MODEL_LIMITS = Object.freeze({ maxRequests: 1, maxOutputTokens: 128, maxRequestBytes: 4000,
  conservativeInputTokens: 32000, upperCny: (32000 * 2 + 128 * 8) / 1e6, taskCapCny: 0.20 });
async function childMain() {
  const { acceptanceConfiguration, boundedDeepseekFetch, measuredUsage } = await import('../server/deepseek-acceptance-policy.mjs');
  const { createWorkspaceOmpSession } = await import('../server/workspace-omp-session.mjs');
  const directory = process.env.WORKSPACE_MODEL_DIRECTORY;
  const configuration = acceptanceConfiguration({ DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY });
  const originalFetch = globalThis.fetch;
  let requests = 0, status = null, requestBytes = null, stage = 'session_setup', created, result;
  const started = performance.now(), controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); void created?.session.abort(); }, 45000);
  const bounded = boundedDeepseekFetch(async request => {
    if (requests >= 1) throw Error('ONE_REQUEST_ONLY');
    const body = await request.clone().json();
    requestBytes = Buffer.byteLength(JSON.stringify(body));
    if (requestBytes > MODEL_LIMITS.maxRequestBytes || body.max_tokens > 128 || body.tools?.length
      || body.model !== 'deepseek-flash' || body.thinking?.type !== 'disabled') throw Error('MODEL_ONLY_BOUND_REFUSED');
    stage = 'network_request'; requests++;
    // Preserve SDK Bearer and platform HTTPS proxy substitution. No plaintext fallback.
    const response = await originalFetch(request, { signal: controller.signal });
    status = response.status; stage = response.ok ? 'provider_stream' : 'http_refused';
    return response;
  });
  globalThis.fetch = bounded.fetch;
  try {
    if (!configuration.apiKey || MODEL_LIMITS.upperCny > MODEL_LIMITS.taskCapCny) throw Error('ADMISSION_REFUSED');
    created = await createWorkspaceOmpSession({ packageRoot: process.env.WORKSPACE_OMP_PACKAGE_ROOT,
      configuration, cwd: directory, agentDir: directory + '/agent', sessionDirectory: directory + '/sessions',
      maxModelCalls: 1, maxTokens: 128, lifecycleSignal: controller.signal,
      publicTools: { searchProvider: 'disabled', browserExecutable: null, files: [] },
      uiExtension: pi => {
        pi.on('before_agent_start', () => ({ systemPrompt: ['Answer the simple public question briefly. No tools.'] }));
        pi.on('tool_call', () => ({ block: true, reason: 'Model-only connectivity verification.' }));
      } });
    await created.session.setActiveToolsByName([]);
    created.session.setThinkingLevel('off');
    stage = 'model_prompt';
    await created.session.prompt('What is 2 + 2? Reply with the number only.');
    stage = status === null ? stage : status >= 400 ? 'http_refused' : 'usage_validation';
    const messages = created.session.agent.state.messages;
    const assistants = messages.filter(m => m.role === 'assistant');
    const usage = measuredUsage(messages);
    if (requests !== 1 || usage.responses !== 1 || messages.some(m => m.role === 'toolResult')) throw Error('UNCERTAIN_USAGE');
    const message = assistants[0], answer = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (message.stopReason !== 'stop' || message.content.some(b => b.type !== 'text') || answer.trim() !== '4'
      || message.usage.output > 128 || usage.usageUpperCny > MODEL_LIMITS.upperCny) throw Error('ANSWER_OR_USAGE_REFUSED');
    result = { status: 'passed', realModelVerified: true, answerCorrect: true, usage: Object.fromEntries(
      ['input','output','cacheRead','cacheWrite','totalTokens'].map(k => [k, message.usage[k]])),
      usageUpperCny: usage.usageUpperCny, accountChargedCny: null };
    stage = 'complete';
  } catch {
    result = { status: 'stopped', realModelVerified: false, reason: requests ? 'INCOMPLETE_STOP_DO_NOT_RETRY_UNCERTAIN_CHARGE' : 'PRE_REQUEST_FAILURE',
      usageUpperCny: null, accountChargedCny: null };
  } finally {
    clearTimeout(timer);
    try { await created?.close(); } catch { stage = stage === 'complete' ? 'cleanup_failed' : stage; }
    globalThis.fetch = originalFetch;
  }
  console.log(JSON.stringify({ modelOnlyAcceptance: true, ...result, stage, model: 'deepseek-flash', sdk: 'omp@18.10.4',
    modelRequests: requests, httpStatus: status, requestBytes, elapsedMs: Math.round(performance.now()-started),
    preflightUpperCny: MODEL_LIMITS.upperCny, businessBindingPresent: false, businessToolsVerified: false }));
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check','--execute-paid-request','--model-child'].includes(args[0])) throw Error('INVALID_OPTIONS');
  if (args[0] === '--model-child') { if (!globalThis.Bun) throw Error('BUN_REQUIRED'); return childMain(); }
  const { workspaceOmpPaths } = await import('../server/workspace-omp-bridge.mjs');
  const { verifyWorkspaceOmpRuntime } = await import('./workspace-omp.mjs');
  const paths = workspaceOmpPaths({});
  await verifyWorkspaceOmpRuntime(paths);
  if (args[0] === '--check') return console.log(JSON.stringify({ modelOnlyAcceptance: true, status: 'configured_unverified',
    keyPresent: Boolean(process.env.DEEPSEEK_API_KEY), model: 'deepseek-flash', sdk: 'omp@18.10.4', modelRequests: 0, limits: MODEL_LIMITS }));
  if (!process.env.DEEPSEEK_API_KEY || MODEL_LIMITS.upperCny > MODEL_LIMITS.taskCapCny) throw Error('ADMISSION_REFUSED');
  const directory = await fs.mkdtemp('/tmp/workspace-omp-model-');
  try {
    const env = { PATH: process.env.PATH, HOME: directory, TMPDIR: directory,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, WORKSPACE_OMP_PACKAGE_ROOT: paths.packageRoot, WORKSPACE_MODEL_DIRECTORY: directory };
    for (const key of ['HTTP_PROXY','HTTPS_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS','CODEX_PROXY_CERT']) if (process.env[key]) env[key] = process.env[key];
    if (!env.NODE_EXTRA_CA_CERTS && env.CODEX_PROXY_CERT) env.NODE_EXTRA_CA_CERTS = env.CODEX_PROXY_CERT;
    const result = await new Promise(resolve => {
      const child = spawn(paths.bun, [filename, '--model-child'], { cwd: directory, env, stdio: ['ignore','pipe','ignore'] });
      let output = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 55000);
      child.stdout.on('data', data => { output += data; if (output.length > 16000) child.kill('SIGKILL'); });
      child.once('error', () => { clearTimeout(timer); resolve(null); });
      child.once('close', () => { clearTimeout(timer); resolve(output.trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).find(r => r?.modelOnlyAcceptance === true)); });
    });
    console.log(JSON.stringify(result || { modelOnlyAcceptance: true, status: 'stopped', stage: 'child_process', realModelVerified: false,
      reason: 'UNKNOWN_REQUEST_STATE_DO_NOT_RETRY', accountChargedCny: null, preflightUpperCny: MODEL_LIMITS.upperCny }));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === filename) main().catch(() => {
  console.log(JSON.stringify({ modelOnlyAcceptance: true, status: 'stopped', stage: 'pre_request_setup', modelRequests: 0, realModelVerified: false })); process.exitCode = 1;
});
