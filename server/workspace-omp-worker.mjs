// Bun subprocess hosting the unmodified official OMP AgentSession. fd 3 is a
// bounded host transport, not an execution queue or business-record registry.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createWorkspaceOmpSession, OMP_ENGINE_SCOPE } from './workspace-omp-session.mjs';
const write = value => fs.writeSync(3, JSON.stringify(value) + '\n');
const input = createInterface({ input: fs.createReadStream(null, { fd: 3 }), crlfDelay: Infinity });
const pending = new Map(); let nextId = 1, created, running = false, initializing;
const lifecycle = new AbortController();
const request = (method, args = [], signal) => new Promise((resolve, reject) => {
  signal?.throwIfAborted(); lifecycle.signal.throwIfAborted();
  const id = nextId++;
  const abort = () => { pending.delete(id); cleanup(); write({ type: 'cancelRequest', id }); reject(new DOMException('Original operation cancelled.', 'AbortError')); };
  const cleanup = () => { signal?.removeEventListener('abort', abort); lifecycle.signal.removeEventListener('abort', abort); };
  pending.set(id, { resolve, reject, cleanup });
  signal?.addEventListener('abort', abort, { once: true }); lifecycle.signal.addEventListener('abort', abort, { once: true });
  try { write({ type: 'request', id, method, args }); }
  catch (error) { pending.delete(id); cleanup(); reject(error); }
});
const clientMethods = ['businessPresets', 'businessSubmit', 'businessTasks', 'businessStatus', 'businessResult'];
const client = Object.fromEntries(clientMethods.map(method => [method, (...args) => request(method, args.map(arg => arg instanceof AbortSignal ? null : arg))]));
async function start(config) {
  if (running) throw new Error('A worker hosts one official OMP turn only.'); running = true;
  // This explicit finite fixture cannot accidentally probe a real tender,
  // model or private service. Its local Docling HTTP stays on the Node Host.
  if(config.enterpriseContext&&config.syntheticResponses)globalThis.fetch=async()=>{throw Error('FINITE_ENTERPRISE_WORKER_NETWORK_FORBIDDEN');};
  const freeTradeHost=config.freeTrade?(await import('./workspace-free-trade-host.mjs')).freeTradeHostFromRpc(config.freeTradeDescriptor,request):null;
  const enterpriseContextHost=config.enterpriseContext?(await import('./workspace-enterprise-context-host.mjs')).enterpriseContextHostFromRpc(config.enterpriseContextDescriptor,request):null;
  created = await (initializing = createWorkspaceOmpSession({ ...config, enterpriseContextHost,freeTradeHost,client:config.freeTrade||config.enterpriseContext?undefined:client, factoryTasks: !config.enterpriseContext && !config.freeTrade && !config.factoryMaterials && !config.factoryCustomers && !config.factoryIngestion && !config.marketValidation && !config.shopifyProduct,
    marketplaceClient:config.nativeBusiness&&config.marketplaceConfigured?Object.fromEntries(['status','find','propose','order','revalidateReceipt'].map(method=>[method,(value,signal,model)=>request('marketplace',[method,value,model],signal)])):null,
    medusaClient: config.nativeBusiness&&config.medusaConfigured?{
      ...Object.fromEntries(['status','preview','reconcile'].map(method=>[method,(value,signal,model)=>request('medusaCatalog',[method,value,model],signal)])),
      refresh:(receipt,model,signal)=>request('medusaCatalog',['refresh',receipt,model],signal),
    }:null,
    brainClient: config.nativeBusiness&&config.brainConfigured?Object.fromEntries(['sourceCatalog','contextRead','contextSave','diagnose','decisionRead','decisionSave','reviewSave','brief','revalidateReceipt'].map(method=>[method,(value,signal,model)=>request('businessBrain',[method,value,model],signal)])):null,
    productClient: config.shopifyProduct ? {
      ...Object.fromEntries(['status', 'read', 'image', 'readiness', 'propose', 'review', 'execute', 'reconcile', 'result'].map(method => [method, (value, signal, model) => request('shopifyProduct', [method, value, model], signal)])),
      refresh: (receipt, model, signal, images) => request('shopifyProduct', ['refresh', receipt, model, images], signal),
    } : null,
    ingestionClient: config.factoryIngestion ? {
      ...Object.fromEntries(['status', 'read', 'save', 'query'].map(method => [method, async (input, signal, model) => {
        signal?.throwIfAborted();
        if (method === 'save') await created.manager.flush();
        return request('factoryIngestion' + method[0].toUpperCase() + method.slice(1), [input, model], signal);
      }])),
      revalidateReceipt: (receipt, model, signal, images) => request('factoryIngestionRevalidate', [receipt, model, images], signal),
    } : null,
    monitorClient: config.marketValidation ? {
      ...Object.fromEntries(['request', 'status', 'control'].map(method => [method, (input, signal, model) => request('marketMonitor' + method[0].toUpperCase() + method.slice(1), [input, model], signal)])),
      refresh: (receipt, model, signal) => request('marketMonitorRefresh', [receipt, model], signal),
    } : null,
    planClient: config.marketValidation ? {
      read: (input, signal, model) => request('marketValidationRead', [input, model], signal),
      save: (input, signal, model) => request('marketValidationSave', [input, model], signal),
      revalidateReceipt: (receipt, model, signal) => request('marketValidationRevalidate', [receipt, model], signal),
    } : null,
    inquiryClient: config.factoryInquiries ? {
      save: (input, signal, model) => request('factoryInquirySave', [input, model], signal),
      revalidateReceipt: (receipt, model, signal) => request('factoryInquiryRevalidate', [receipt, model], signal),
    } : null,
    customerClient: config.factoryCustomers ? { save: async (input, signal, model) => { signal?.throwIfAborted(); await created.manager.flush(); return request('factoryCustomerSave', [input, model], signal); } } : null,
    materialsClient: config.factoryMaterials ? {
      status: (signal, model) => request('factoryMaterialsStatus', [model], signal),
      materials: (input, signal, model) => request('factoryMaterialsRead', [input, model], signal),
      document: (input, signal, model) => request('factoryDocumentRead', [input, model], signal),
      revalidateReceipt: (receipt, model, signal) => request('factoryMaterialsRevalidate', [receipt, model], signal),
    } : null, lifecycleSignal: lifecycle.signal,
    authorize: value => request('authorize', [], value instanceof AbortSignal?value:undefined), onModelRequest: event => request('modelRequest', [event]),
    onModelDispatched:event=>write({type:'modelDispatched',...event}),
    onModelAbort: () => { if (config.syntheticResponses) write({ type: 'nativeModelAbort' }); },
    onModelWaiting: () => { if (config.syntheticResponses) write({ type: 'nativeModelWaiting' }); } }));
  created.session.subscribe(event => {
    if (['tool_execution_start', 'tool_execution_end'].includes(event.type)) write({ type: 'event', event: {
      type: event.type, toolName: event.toolName, toolCallId: event.toolCallId, isError: event.isError } });
  });
  // The official journal's missing-file fingerprint must remain intact.
  // Use its explicit persistence API; never write a fabricated/external header.
  await created.manager.ensureOnDisk(); await created.manager.flush();
  await request('saveSession', [{ engineScope: created.engineScope, agentSessionId: created.manager.getSessionId(), sessionFile: created.manager.getSessionFile() }]);
  const startIndex = created.session.messages.length;
  await created.session.prompt(config.content, { expandPromptTemplates: false });
  await created.authorizeDisclosure({phase:'final:deliver'}); await created.manager.flush();
  const messages = created.session.messages.slice(startIndex), last = messages.at(-1);
  if (last?.role !== 'assistant' || last.stopReason !== 'stop') throw new Error('The official OMP session did not produce a complete new answer.');
  const usage = created.usage();
  if (usage.completionTokens !== null && usage.completionTokens > config.maxTokens) throw new Error('OMP exceeded the original reserved output allowance.');
  write({ type: 'result', result: { content: JSON.stringify({ done: true, content: created.session.getLastAssistantText() }),
    usage,
    runtime: { kind: 'pi-durable', execution: 'agent-session', engine: 'omp', engineScope: created.engineScope,
      agentSessionId: created.manager.getSessionId(), modelCalls: created.modelCalls(), originalRunId: config.runId } } });
  await created.close(); input.close(); process.exit(0);
}
input.on('line', line => {
  if (Buffer.byteLength(line) > 2_000_000) { process.exitCode = 1; input.close(); return; }
  let value; try { value = JSON.parse(line); } catch { process.exitCode = 1; input.close(); return; }
  if (value.type === 'reply') {
    const operation = pending.get(value.id); if (!operation) return; pending.delete(value.id); operation.cleanup();
    if (value.error) operation.reject(Object.assign(new Error(value.error), { code: value.errorCode, status: value.status })); else operation.resolve(value.result);
  } else if (value.type === 'abort') { lifecycle.abort(); void created?.session.abort(); }
  else if (value.type === 'start') void start(value.config).catch(async error => {
    write({ type: 'error', error: 'The official OMP session failed; no task completion or model fallback is implied.',
      ...(value.config.syntheticResponses ? { diagnostic: error.message+(error.pluginReason?':'+error.pluginReason:'') } : {}) });
    await created?.close().catch(() => {}); process.exit(1);
  });
});
process.once('SIGTERM', () => void (async () => { lifecycle.abort(); await initializing?.catch(() => {}); await created?.session.abort(); await created?.close().catch(() => {}); process.exit(1); })());
