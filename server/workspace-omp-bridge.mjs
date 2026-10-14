import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { privateDirectory } from './store.mjs';
import { ProviderError } from './provider.mjs';
import { snapshotWorkspaceOmpPublicFiles } from './workspace-omp-public-tools.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
export const OMP_ENGINE_SCOPE = 'omp:18.10.4:public-v1';
export function workspaceOmpPaths(env = {}) {
  return { bun: env.WORKSPACE_BUN_BIN || path.join(root, 'support/omp-bun-linux-x64/node_modules/@oven/bun-linux-x64-baseline/bin/bun'),
    packageRoot: env.WORKSPACE_OMP_PACKAGE_ROOT || path.join(root, 'support/omp-coding-agent/node_modules/@oh-my-pi/pi-coding-agent') };
}
export async function checkWorkspaceOmpPaths(paths) {
  if (!path.isAbsolute(paths.bun) || !path.isAbsolute(paths.packageRoot)) throw new Error('Workspace OMP paths must be absolute reviewed host paths.');
  await fs.access(paths.bun);
  const manifest = JSON.parse(await fs.readFile(path.join(paths.packageRoot, 'package.json')));
  if (manifest.name !== '@oh-my-pi/pi-coding-agent' || manifest.version !== '18.10.4') throw new Error('Install the fixed official OMP 18.10.4 package; no Node or alternate engine fallback is implicit.');
}
export function createWorkspaceOmpEngineAdapter({ paths, configuration, publicTools = {}, syntheticResponses = null,
  syntheticPublicSearchResponses = null, infrastructure = {}, onWorkerLifecycle = () => {} }) {
  if (syntheticPublicSearchResponses && !syntheticResponses) throw new Error('Public HTTP fixtures require the explicit finite keyless model fixture; production cannot select them.');
  return Object.freeze({ scope: OMP_ENGINE_SCOPE,
    async complete({ input, run, binding, client, authorize, isolationDirectory, savedSession, saveSession }) {
      await checkWorkspaceOmpPaths(paths); await authorize();
      const user = input.messages.filter(row => row.role === 'user').at(-1);
      if (!user || typeof user.content !== 'string') throw new ProviderError('PUBLIC_TEXT_REQUIRED', 'Use the original public text admission.');
      const sessionDirectory = path.join(isolationDirectory, 'sessions', binding.client.bindingFingerprint), agentDir = path.join(isolationDirectory, 'agent');
      await privateDirectory(sessionDirectory); await privateDirectory(agentDir);
      const home = path.join(isolationDirectory, 'home'); await privateDirectory(home);
      const publicFiles = await snapshotWorkspaceOmpPublicFiles({ root: publicTools.publicDocumentRoot, files: publicTools.files || [] });
      await authorize();
      const publicToolConfiguration = { searchProvider: publicTools.searchProvider || 'duckduckgo',
        browserExecutable: publicTools.browserExecutable || null, publicFiles };
      const childEnv = { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: home, TMPDIR: isolationDirectory,
        PI_CODING_AGENT_DIR: agentDir, PI_NO_TITLE: '1', NO_COLOR: '1', TERM: 'dumb' };
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS']) if (typeof infrastructure[key] === 'string') childEnv[key] = infrastructure[key];
      // No service token/API key appears in argv, logs or env. The selected
      // model configuration crosses the private fd only, and never the model context.
      return await new Promise((resolve, reject) => {
        const child = spawn(paths.bun, [path.join(root, 'server/workspace-omp-worker.mjs')], { cwd: isolationDirectory, env: childEnv, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
        onWorkerLifecycle({ phase: 'spawn', pid: child.pid });
        const channel = child.stdio[3]; let settled = false, bytes = 0, modelCalls = 0, childClosed = false, pendingResult = null, resultVerified = false;
        const lines = createInterface({ input: channel, crlfDelay: Infinity });
        const send = value => { if (!channel.destroyed) channel.write(JSON.stringify(value) + '\n'); };
        let terminateTimer, killTimer;
        const stop = () => { if (childClosed || killTimer) return; send({ type: 'abort' });
          // Let the official root/child AbortSignals settle first. Escalation
          // remains bounded and targets only this owned worker/process group.
          terminateTimer = setTimeout(() => { if (!childClosed) child.kill('SIGTERM'); }, 250); terminateTimer.unref();
          killTimer = setTimeout(() => { if (!childClosed) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }, 1500); killTimer.unref(); };
        const timer = setTimeout(stop, 65000);
        const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); input.signal?.removeEventListener('abort', stop);
          if (error) { stop(); reject(error); } else resolve(result); };
        channel.on('error', () => { if (!pendingResult) finish(new ProviderError('OMP_SESSION_FAILED', 'The official OMP transport closed.')); });
        lines.on('error', () => { if (!pendingResult) finish(new ProviderError('OMP_SESSION_FAILED', 'The official OMP line transport closed.')); });
        const finishSuccess = () => { if (childClosed && resultVerified) finish(null, { ...pendingResult, runtime: { ...pendingResult.runtime, workerExitObserved: true } }); };
        input.signal?.addEventListener('abort', stop, { once: true });
        const allowed = new Set(['businessPresets', 'businessSubmit', 'businessTasks', 'businessStatus', 'businessResult']);
        const handleLine = async line => {
          bytes += Buffer.byteLength(line); if (bytes > 8_000_000 || Buffer.byteLength(line) > 2_000_000) { finish(new ProviderError('OMP_PROTOCOL_LIMIT', 'OMP exceeded its admitted transport limit.')); return; }
          let message; try { message = JSON.parse(line); } catch { finish(new ProviderError('OMP_PROTOCOL_INVALID', 'OMP returned an invalid transport receipt.')); return; }
          if (message.type === 'request') {
            try {
              await authorize(); let result;
              if (message.method === 'authorize') result = true;
              else if (message.method === 'saveSession') result = await saveSession(message.args[0]);
              else if (message.method === 'modelRequest') { if (++modelCalls > 4) throw new Error('Original model request bound exceeded.'); await input.onEvent?.({ type: 'pi.agent-session.request', engine: 'omp' }); result = true; }
              else if (allowed.has(message.method)) {
                const args = message.args || []; if (args.length > 2) throw new Error('Invalid original client invocation.');
                if (message.method === 'businessSubmit') result = await client.businessSubmit(args[0], input.signal);
                else if (message.method === 'businessPresets') result = await client.businessPresets(input.signal);
                else if (message.method === 'businessStatus') result = await client.businessStatus(args[0], input.signal);
                else result = await client[message.method](args[0] ?? {}, input.signal);
              } else throw new Error('This public OMP session cannot invoke that capability.');
              send({ type: 'reply', id: message.id, result });
            } catch { send({ type: 'reply', id: message.id, error: 'Original authorization or task operation refused; no replacement execution was admitted.' }); }
          } else if (message.type === 'event') {
            const event = message.event;
            if (typeof event?.toolName === 'string' && event.toolName.startsWith('workspace_')) await input.onEvent?.({
              type: event.type === 'tool_execution_start' ? 'pi.tool.started' : event.isError ? 'pi.tool.failed' : 'pi.tool.finished',
              toolName: event.toolName, toolCallId: createHash('sha256').update(String(event.toolCallId)).digest('hex'), engine: 'omp' });
          } else if (message.type === 'result') {
            pendingResult = message.result;
            try { await authorize(); const result = pendingResult; if (result?.runtime?.engineScope !== OMP_ENGINE_SCOPE || result.runtime.originalRunId !== run.id || result.runtime.modelCalls !== modelCalls) throw new Error(); resultVerified = true; finishSuccess(); }
            catch { finish(new ProviderError('OMP_RECEIPT_INVALID', 'OMP returned an invalid original-run receipt.')); }
          } else if (message.type === 'nativeModelAbort' && syntheticResponses) onWorkerLifecycle({ phase: 'nativeModelAbort', pid: child.pid });
          else if (message.type === 'nativeModelWaiting' && syntheticResponses) onWorkerLifecycle({ phase: 'nativeModelWaiting', pid: child.pid });
          else if (message.type === 'error') finish(new ProviderError('OMP_SESSION_FAILED', message.error + (syntheticResponses && message.diagnostic ? ' Explicit synthetic fixture diagnostic: ' + message.diagnostic : '')));
        };
        lines.on('line', line => { void handleLine(line).catch(() => finish(new ProviderError('OMP_SESSION_FAILED', 'The original OMP host operation stopped.'))); });
        child.on('error', () => finish(new ProviderError('OMP_UNAVAILABLE', 'The reviewed OMP runtime could not start.')));
        child.on('close', code => { childClosed = true; clearTimeout(terminateTimer); clearTimeout(killTimer); lines.close();
          onWorkerLifecycle({ phase: 'exit', pid: child.pid, code });
          if (pendingResult && code === 0) finishSuccess();
          else if (!settled) finish(new ProviderError(input.signal?.aborted ? 'CANCELLED' : 'OMP_SESSION_FAILED', 'The official OMP session stopped without completion.')); });
        send({ type: 'start', config: { packageRoot: paths.packageRoot, cwd: isolationDirectory, agentDir, sessionDirectory, savedSession,
          configuration, publicTools: publicToolConfiguration, syntheticResponses, syntheticPublicSearchResponses,
          content: user.content, runId: run.id, maxTokens: input.maxTokens } });
      });
    },
  });
}
