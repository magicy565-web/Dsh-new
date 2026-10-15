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
export const OMP_FACTORY_ENGINE_SCOPE = 'omp:18.10.4:factory-materials-v1';
export const OMP_CUSTOMERS_ENGINE_SCOPE = 'omp:18.10.4:factory-customers-v1';
export const OMP_INGESTION_ENGINE_SCOPE = 'omp:18.10.4:factory-ingestion-v1';
export const OMP_SHOPIFY_ENGINE_SCOPE = 'omp:18.10.4:shopify-product-v1';
export const OMP_MARKET_ENGINE_SCOPE = 'omp:18.10.4:market-validation-v1';
export const OMP_INQUIRIES_ENGINE_SCOPE = 'omp:18.10.4:factory-inquiries-v1';
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
export function createWorkspaceOmpEngineAdapter({ paths, configuration, publicTools = {}, factoryMaterials = false, factoryCustomers = false, factoryInquiries = false, factoryIngestion = false, marketValidation = false, shopifyProduct = false, syntheticResponses = null,
  syntheticPublicSearchResponses = null, infrastructure = {}, onWorkerLifecycle = () => {} }) {
  if (syntheticPublicSearchResponses && !syntheticResponses) throw new Error('Public HTTP fixtures require the explicit finite keyless model fixture; production cannot select them.');
  if (typeof factoryInquiries !== 'boolean') throw TypeError('Use one fixed reviewed OMP profile.');
  if (factoryInquiries || marketValidation || shopifyProduct) factoryMaterials = true;
  if (typeof factoryIngestion !== 'boolean' || typeof marketValidation !== 'boolean' || factoryIngestion && (factoryMaterials || factoryCustomers) || marketValidation && (factoryInquiries || factoryCustomers)) throw TypeError('Use one reviewed profile.');
  const privateProfile = factoryMaterials || factoryIngestion;
  if (typeof factoryMaterials !== 'boolean' || typeof factoryCustomers !== 'boolean' || factoryMaterials && factoryCustomers) throw TypeError('Use one fixed reviewed OMP profile.');
  if (typeof shopifyProduct !== 'boolean' || shopifyProduct && (factoryIngestion || marketValidation || factoryInquiries || factoryCustomers)) throw TypeError('Use one reviewed Shopify product profile.');
  const engineScope = shopifyProduct ? OMP_SHOPIFY_ENGINE_SCOPE : factoryIngestion ? OMP_INGESTION_ENGINE_SCOPE : marketValidation ? OMP_MARKET_ENGINE_SCOPE : factoryInquiries ? OMP_INQUIRIES_ENGINE_SCOPE : factoryMaterials ? OMP_FACTORY_ENGINE_SCOPE : factoryCustomers ? OMP_CUSTOMERS_ENGINE_SCOPE : OMP_ENGINE_SCOPE;
  return Object.freeze({ scope: engineScope,
    async complete({ input, run, binding, client, authorize, materialsClient, inquiryClient, customerClient, ingestionClient, planClient, monitorClient, productClient, isolationDirectory, savedSession, saveSession }) {
      input.signal?.throwIfAborted();
      await checkWorkspaceOmpPaths(paths); await authorize();
      const user = input.messages.filter(row => row.role === 'user').at(-1);
      if (!user || typeof user.content !== 'string') throw new ProviderError('PUBLIC_TEXT_REQUIRED', 'Use the original public text admission.');
      const sessionDirectory = path.join(isolationDirectory, 'sessions', binding.client.bindingFingerprint), agentDir = path.join(isolationDirectory, 'agent');
      await privateDirectory(sessionDirectory); await privateDirectory(agentDir);
      const home = path.join(isolationDirectory, 'home'); await privateDirectory(home);
      const publicFiles = privateProfile ? [] : await snapshotWorkspaceOmpPublicFiles({ root: publicTools.publicDocumentRoot, files: publicTools.files || [] });
      await authorize();
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(run.id)) throw new Error('Use an original Run identifier for owned public snapshots.');
      const snapshotPrefix = `selected-public-materials-${run.id}-`;
      const cleanupSnapshots = async () => {
        for (const name of await fs.readdir(isolationDirectory)) {
          if (name.startsWith(snapshotPrefix) && /^[A-Za-z0-9]{6}$/u.test(name.slice(snapshotPrefix.length)))
            await fs.rm(path.join(isolationDirectory, name), { recursive: true, force: true });
        }
      };
      const publicToolConfiguration = { searchProvider: publicTools.searchProvider || 'duckduckgo',
        browserExecutable: publicTools.browserExecutable || null, publicFiles, snapshotPrefix };
      const childEnv = { PATH: path.dirname(paths.bun) + ':/usr/bin:/bin', HOME: home, TMPDIR: isolationDirectory,
        PI_CODING_AGENT_DIR: agentDir, PI_NO_TITLE: '1', NO_COLOR: '1', TERM: 'dumb' };
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS']) if (typeof infrastructure[key] === 'string') childEnv[key] = infrastructure[key];
      // No service token/API key appears in argv, logs or env. The selected
      // model configuration crosses the private fd only, and never the model context.
      input.signal?.throwIfAborted();
      return await new Promise((resolve, reject) => {
        const child = spawn(paths.bun, [path.join(root, 'server/workspace-omp-worker.mjs')], { cwd: isolationDirectory, env: childEnv, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
        onWorkerLifecycle({ phase: 'spawn', pid: child.pid });
        const channel = child.stdio[3]; let settled = false, bytes = 0, modelCalls = 0, childClosed = false, cleanupComplete = false, pendingResult = null, resultVerified = false;
        const lines = createInterface({ input: channel, crlfDelay: Infinity });
        const send = value => { if (!channel.destroyed) channel.write(JSON.stringify(value) + '\n'); };
        let terminateTimer, killTimer;
        const operations = new Map();
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
        const finishSuccess = () => { if (childClosed && cleanupComplete && resultVerified) finish(null, { ...pendingResult, runtime: { ...pendingResult.runtime, workerExitObserved: true } }); };
        input.signal?.addEventListener('abort', stop, { once: true });
        if (input.signal?.aborted) stop();
        const allowed = new Set(factoryCustomers || factoryInquiries || factoryIngestion || marketValidation || shopifyProduct ? [] : ['businessPresets', 'businessSubmit', 'businessTasks', 'businessStatus', 'businessResult']);
        const handleLine = async line => {
          bytes += Buffer.byteLength(line); if (bytes > 8_000_000 || Buffer.byteLength(line) > 2_000_000) { finish(new ProviderError('OMP_PROTOCOL_LIMIT', 'OMP exceeded its admitted transport limit.')); return; }
          let message; try { message = JSON.parse(line); } catch { finish(new ProviderError('OMP_PROTOCOL_INVALID', 'OMP returned an invalid transport receipt.')); return; }
          if (message.type === 'cancelRequest') { operations.get(message.id)?.abort(); return; }
          if (message.type === 'request') {
            if (!Number.isSafeInteger(message.id) || message.id < 1 || operations.has(message.id)) { finish(new ProviderError('OMP_PROTOCOL_INVALID', 'Invalid original operation identifier.')); return; }
            const operation = new AbortController(); operations.set(message.id, operation);
            const rpcSignal = input.signal ? AbortSignal.any([input.signal, operation.signal]) : operation.signal;
            try {
              rpcSignal.throwIfAborted(); await authorize(); rpcSignal.throwIfAborted(); let result;
              if (message.method === 'authorize') result = true;
              else if (message.method === 'saveSession') result = await saveSession(message.args[0]);
              else if (message.method === 'modelRequest') { if (++modelCalls > 4) throw new Error('Original model request bound exceeded.'); await input.onEvent?.({ type: 'pi.agent-session.request', engine: 'omp' }); result = true; }
              else if (shopifyProduct && message.method === 'shopifyProduct') {
                const [method, value, model, images] = message.args || [];
                if (!productClient || !['status', 'read', 'image', 'readiness', 'propose', 'review', 'execute', 'reconcile', 'result', 'refresh'].includes(method)) throw Error('Original product method required.');
                result = method === 'refresh' ? await productClient.refresh(value, model, rpcSignal, images) : await productClient[method](value, rpcSignal, model);
              }
              else if (factoryIngestion && ['factoryIngestionStatus', 'factoryIngestionRead', 'factoryIngestionSave', 'factoryIngestionQuery', 'factoryIngestionRevalidate'].includes(message.method)) {
                if (!ingestionClient) throw Error('Original reviewed intake selection required.');
                const [value, model, images] = message.args || [];
                if (message.method === 'factoryIngestionRevalidate') { await ingestionClient.revalidateReceipt(value, model, rpcSignal, images); result = true; }
                else { const method = { factoryIngestionStatus: 'status', factoryIngestionRead: 'read', factoryIngestionSave: 'save', factoryIngestionQuery: 'query' }[message.method]; result = await ingestionClient[method](value, rpcSignal, model); }
              } else if (marketValidation && ['marketMonitorRequest', 'marketMonitorStatus', 'marketMonitorControl', 'marketMonitorRefresh'].includes(message.method)) {
                if (!monitorClient) throw Error('Original monitor client required.');
                const [value, model] = message.args || [];
                const method = { marketMonitorRequest: 'request', marketMonitorStatus: 'status', marketMonitorControl: 'control', marketMonitorRefresh: 'refresh' }[message.method];
                result = method === 'refresh' ? await monitorClient.refresh(value, model, rpcSignal) : await monitorClient[method](value, rpcSignal, model);
              } else if (marketValidation && ['marketValidationRead', 'marketValidationSave', 'marketValidationRevalidate'].includes(message.method)) {
                if (!planClient) throw Error('Original plan client required.');
                const [value, model] = message.args || [];
                if (message.method === 'marketValidationRevalidate') { await planClient.revalidateReceipt(value, model, rpcSignal); result = true; }
                else result = await planClient[message.method === 'marketValidationRead' ? 'read' : 'save'](value, rpcSignal, model);
              }
              else if (factoryInquiries && ['factoryInquirySave', 'factoryInquiryRevalidate'].includes(message.method)) {
                if (!inquiryClient) throw Error('Original inquiry Session client is unavailable.');
                const [value, model] = message.args || [];
                if (message.method === 'factoryInquirySave') result = await inquiryClient.save(value, rpcSignal, model);
                else { await inquiryClient.revalidateReceipt(value, model, rpcSignal); result = true; }
              } else if (factoryCustomers && message.method === 'factoryCustomerSave') {
                if (!customerClient) throw Error('Original public draft Session client unavailable.');
                result = await customerClient.save(message.args?.[0], rpcSignal, message.args?.[1]);
              } else if (factoryMaterials && ['factoryMaterialsStatus', 'factoryMaterialsRead', 'factoryDocumentRead', 'factoryMaterialsRevalidate'].includes(message.method)) {
                if (!materialsClient) throw Error('Original Library Session client is unavailable.');
                const [value, model] = message.args || [];
                if (message.method === 'factoryMaterialsStatus') result = await materialsClient.status(rpcSignal, value);
                else if (message.method === 'factoryMaterialsRead') result = await materialsClient.materials(value, rpcSignal, model);
                else if (message.method === 'factoryDocumentRead') result = await materialsClient.document(value, rpcSignal, model);
                else { await materialsClient.revalidateReceipt(value, model, rpcSignal); result = true; }
              } else if (allowed.has(message.method)) {
                const args = message.args || []; if (args.length > 2) throw new Error('Invalid original client invocation.');
                if (message.method === 'businessSubmit') result = await client.businessSubmit(args[0], input.signal);
                else if (message.method === 'businessPresets') result = await client.businessPresets(input.signal);
                else if (message.method === 'businessStatus') result = await client.businessStatus(args[0], input.signal);
                else result = await client[message.method](args[0] ?? {}, input.signal);
              } else throw new Error('This public OMP session cannot invoke that capability.');
              rpcSignal.throwIfAborted(); send({ type: 'reply', id: message.id, result });
            } catch (error) {
              if (syntheticResponses) onWorkerLifecycle({ phase: 'rpc-refused', method: message.method, code: error.code || error.name });
              // Preserve only reviewed business codes, never arbitrary Host error text.
              const codes = ['SHOPIFY_PRODUCT_SOURCE_CHANGED', 'SHOPIFY_PRODUCT_IMAGES_NOT_SELECTED', 'SHOPIFY_PRODUCT_IMAGE_NOT_SELECTED', 'SHOPIFY_PRODUCT_IMAGE_TOO_LARGE', 'SHOPIFY_PRODUCT_CACHE_REFUSED', 'SHOPIFY_PRODUCT_INPUT_INVALID', 'SUPPLIER_PUBLICATION_NOT_EXECUTABLE', 'SUPPLIER_PUBLICATION_STALE', 'SHOPIFY_SETUP_REQUIRED', 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED', 'IDEMPOTENCY_CONFLICT', 'FACTORY_INQUIRY_SOURCE_CHANGED', 'FACTORY_INQUIRY_REQUEST_CHANGED', 'FACTORY_INQUIRY_ARTIFACT_CHANGED', 'FACTORY_INQUIRY_SOURCE_REFUSED',
                'FACTORY_INGESTION_UPLOAD_NOT_APPROVED', 'FACTORY_INGESTION_SOURCE_CHANGED', 'FACTORY_INGESTION_TARGET_CHANGED', 'FACTORY_INGESTION_REQUEST_CHANGED', 'FACTORY_INGESTION_QUERY_REAUTHORIZE', 'FACTORY_INGESTION_FIELD_NOT_APPROVED', 'FACTORY_INGESTION_SCOPE_REFUSED', 'FACTORY_INGESTION_CACHE_CHANGED',
                'REAL_LAUNCH_RECEIPT_REQUIRED', 'MARKET_PLAN_RECEIPT_MISMATCH', 'MONITOR_NOT_FOUND', 'MONITOR_SOURCE_OWNER_REQUIRED', 'MONITOR_SCOPE_CHANGED', 'APPROVAL_REQUIRED', 'APPROVAL_MISMATCH', 'APPROVAL_EXPIRED', 'APPROVAL_USED', 'MONITOR_STOPPED', 'MONITOR_WINDOW_ENDED', 'MONITOR_CANCELLED', 'LAUNCH_SCOPE_CHANGED', 'BUSINESS_EXECUTION_INTENT_REQUIRED',
                'MARKET_PLAN_SOURCE_CHANGED', 'MARKET_PLAN_REQUEST_CHANGED', 'MARKET_PLAN_CACHE_REFUSED', 'MARKET_PLAN_DOCUMENT_NOT_LINKED', 'MARKET_PLAN_SOURCE_REFUSED',
                'PUBLIC_DRAFT_REQUEST_CHANGED', 'PUBLIC_DRAFT_ARTIFACT_CHANGED', 'ORIGINAL_PUBLIC_SOURCE_RECEIPT_REQUIRED', 'PUBLIC_SOURCE_URL_REFUSED', 'PUBLIC_SOURCE_METADATA_LIMIT'];
              send({ type: 'reply', id: message.id, error: 'Original authorization or task operation refused; no replacement execution was admitted.',
                ...(codes.includes(error.code) ? { errorCode: error.code } : {}),
                ...([400, 401, 403, 404, 409, 503].includes(error.status) ? { status: error.status } : {}) });
            } finally { operations.delete(message.id); }
          } else if (message.type === 'event') {
            const event = message.event;
            if (typeof event?.toolName === 'string' && event.toolName.startsWith('workspace_')) await input.onEvent?.({
              type: event.type === 'tool_execution_start' ? 'pi.tool.started' : event.isError ? 'pi.tool.failed' : 'pi.tool.finished',
              toolName: event.toolName, toolCallId: createHash('sha256').update(String(event.toolCallId)).digest('hex'), engine: 'omp' });
          } else if (message.type === 'result') {
            pendingResult = message.result;
            try { await authorize(); const result = pendingResult; if (result?.runtime?.engineScope !== engineScope || result.runtime.originalRunId !== run.id || result.runtime.modelCalls !== modelCalls) throw new Error(); resultVerified = true; finishSuccess(); }
            catch { finish(new ProviderError('OMP_RECEIPT_INVALID', 'OMP returned an invalid original-run receipt.')); }
          } else if (message.type === 'nativeModelAbort' && syntheticResponses) onWorkerLifecycle({ phase: 'nativeModelAbort', pid: child.pid });
          else if (message.type === 'nativeModelWaiting' && syntheticResponses) onWorkerLifecycle({ phase: 'nativeModelWaiting', pid: child.pid });
          else if (message.type === 'error') finish(new ProviderError('OMP_SESSION_FAILED', message.error + (syntheticResponses && message.diagnostic ? ' Explicit synthetic fixture diagnostic: ' + message.diagnostic : '')));
        };
        lines.on('line', line => { void handleLine(line).catch(() => finish(new ProviderError('OMP_SESSION_FAILED', 'The original OMP host operation stopped.'))); });
        child.on('error', () => finish(new ProviderError('OMP_UNAVAILABLE', 'The reviewed OMP runtime could not start.')));
        child.on('close', code => { childClosed = true; for (const operation of operations.values()) operation.abort(); operations.clear(); clearTimeout(terminateTimer); clearTimeout(killTimer); lines.close();
          void cleanupSnapshots().then(() => {
            cleanupComplete = true; onWorkerLifecycle({ phase: 'exit', pid: child.pid, code });
            if (pendingResult && code === 0) finishSuccess();
            else if (!settled) finish(new ProviderError(input.signal?.aborted ? 'CANCELLED' : 'OMP_SESSION_FAILED', 'The official OMP session stopped without completion.'));
          }).catch(() => finish(new ProviderError('OMP_SNAPSHOT_CLEANUP_FAILED', 'The owned public Run snapshot could not be cleaned.'))); });
        send({ type: 'start', config: { packageRoot: paths.packageRoot, cwd: isolationDirectory, agentDir, sessionDirectory, savedSession,
          configuration, engineScope, factoryMaterials, factoryCustomers, factoryInquiries, factoryIngestion, marketValidation, shopifyProduct, publicTools: publicToolConfiguration, syntheticResponses, syntheticPublicSearchResponses,
          content: user.content, runId: run.id, maxTokens: input.maxTokens } });
      });
    },
  });
}
