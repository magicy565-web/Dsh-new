// Selectively adapted from f929906: test the fixed upstream lock, never replace it.
// Linux uses abstract Unix sockets; this is not a fallback flock implementation.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workspaceOmpConfigured } from './workspace-omp-configuration.mjs';
import { localDeepseekConfigured } from './workspace-omp-local-deepseek.mjs';

const implementation = 'omp:18.10.4:pi-utils/file-lock';
const unavailable = (error, phase) => ({ ready: false, reason: 'LOCAL_NATIVE_LOCK_UNAVAILABLE', implementation,
  phase, errno: Number(/\(os error (\d+)\)/.exec(error?.message || '')?.[1]) || null });

export async function checkLocalNativeLock({ packageRoot, directory }) {
  let probeDirectory, lease, result, phase = 'load';
  try {
    if (!globalThis.Bun || Bun.version !== '1.3.14') throw Error('FIXED_BUN_REQUIRED');
    const utils = path.resolve(packageRoot, '../pi-utils');
    const manifest = JSON.parse(await fs.readFile(path.join(utils, 'package.json'), 'utf8'));
    if (manifest.name !== '@oh-my-pi/pi-utils' || manifest.version !== '18.10.4') throw Error('FIXED_LOCK_PACKAGE_REQUIRED');
    const { tryAcquireFileLock } = await import(pathToFileURL(path.join(utils, 'src/file-lock.ts')).href);
    phase = 'prepare';
    probeDirectory = await fs.mkdtemp(path.join(directory, 'native-lock-'));
    const resource = path.join(probeDirectory, 'probe');
    phase = 'acquire'; lease = tryAcquireFileLock(resource);
    if (!lease) throw Error('NATIVE_LOCK_NOT_ACQUIRED');
    phase = 'release'; lease.release(); lease = null;
    phase = 'reacquire'; lease = tryAcquireFileLock(resource);
    if (!lease) throw Error('NATIVE_LOCK_NOT_REACQUIRED');
    phase = 'release-reacquired'; lease.release(); lease = null;
    result = { ready: true, implementation, scope: 'temporary-lock-only' };
  } catch (error) { result = unavailable(error, phase); }
  finally {
    try { lease?.release(); }
    catch (error) { result = unavailable(error, 'cleanup-release'); }
    try { if (probeDirectory) await fs.rm(probeDirectory, { recursive: true, force: true }); }
    catch (error) { result = unavailable(error, 'cleanup-directory'); }
  }
  return result;
}

// Presence/admission checks only. A passing probe does not prove a Session,
// provider connection, current balance, spending approval or crash recovery.
export function localSessionPreflight(configuration, nativeLock) {
  const modelStatus = !workspaceOmpConfigured(configuration) ? 'model-unconfigured'
    : localDeepseekConfigured(configuration) ? 'configured-unverified' : 'provider-unsupported';
  return { status: nativeLock.ready ? modelStatus : 'environment-unavailable', modelStatus,
    preflightReady: nativeLock.ready && modelStatus === 'configured-unverified',
    persistentSessionVerified: false, paidModelVerified: false,
    environment: { nativeLock },
    blockers: [...(nativeLock.ready ? [] : [nativeLock.reason]),
      ...(modelStatus === 'model-unconfigured' ? ['LOCAL_MODEL_COST_AND_BUDGET_REQUIRED']
        : modelStatus === 'provider-unsupported' ? ['LOCAL_PINNED_DEEPSEEK_REQUIRED'] : [])],
    modelConfiguration: { provider: configuration.providerId, model: configuration.model,
      apiKeyPresent: Boolean(configuration.apiKey), costPresent: Boolean(configuration.cost),
      remainingBudgetReviewed: configuration.remainingBudgetVerified === true } };
}

// The default Node entry checks the same Bun primitive in an empty temporary HOME.
// No model configuration or ambient credentials are passed to this child.
export async function inspectNativeLock(paths) {
  let directory, result;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-omp-preflight-'));
    result = await new Promise(resolve => {
      const child = spawn(paths.bun, [fileURLToPath(import.meta.url), '--probe', paths.packageRoot, directory], {
        cwd: directory, env: { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: directory, TMPDIR: directory },
        stdio: ['ignore', 'pipe', 'ignore'] });
      let output = '', finished = false, refused = false;
      const finish = result => { if (!finished) { finished = true; clearTimeout(timer); resolve(result); } };
      const timer = setTimeout(() => { refused = true; child.kill('SIGKILL'); }, 10000);
      child.stdout.on('data', data => { if (refused) return; output += data;
        if (output.length > 4096) { refused = true; child.kill('SIGKILL'); } });
      child.once('error', () => finish(unavailable(null, 'probe-process')));
      child.once('close', code => {
        try {
          const result = JSON.parse(output);
          if (refused || code !== 0 || typeof result.ready !== 'boolean' || result.implementation !== implementation) throw Error();
          finish(result);
        } catch { finish(unavailable(null, 'probe-process')); }
      });
    });
  } catch (error) { result = unavailable(error, 'probe-process'); }
  finally {
    try { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
    catch (error) { result = unavailable(error, 'cleanup-directory'); }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5 || process.argv[2] !== '--probe') throw Error('NATIVE_PREFLIGHT_ARGUMENTS_REQUIRED');
  console.log(JSON.stringify(await checkLocalNativeLock({ packageRoot: process.argv[3], directory: process.argv[4] })));
}
