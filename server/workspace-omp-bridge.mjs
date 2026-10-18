import {MEDUSA_ENTERPRISE_SCOPE,revalidateMedusaEnterpriseJournal,assertMedusaEnterpriseDisclosure} from './workspace-omp-medusa-enterprise.mjs';
import { workspaceOmpPaths, checkWorkspaceOmpPaths } from './workspace-omp-runtime.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { revalidateBusinessJournal,readBusinessContext } from './workspace-omp-business-journal.mjs';
import { privateDirectory, openPrivateFile } from './store.mjs';
import { ProviderError } from './provider.mjs';
import { snapshotWorkspaceOmpPublicFiles } from './workspace-omp-public-tools.mjs';
import { createNativeDeepseekAcceptance, validateLocalDeepseekReport, localDeepseekConfigured, NATIVE_FACTS_PAID_ACCEPTANCE, LOCAL_DEEPSEEK_LIMITS } from './workspace-omp-local-deepseek.mjs';
import {createWorkspaceModelBudget,normalizeWorkspaceModelBudget} from './workspace-model-budget.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
export const OMP_ENGINE_SCOPE = 'omp:18.10.4:public-v1';
export const OMP_ENTERPRISE_CONTEXT_SCOPE='omp:18.10.4:enterprise-context-v1';
export const OMP_FREE_TRADE_SCOPE = 'omp:18.10.4:free-trade-v1';
export const OMP_FACTORY_ENGINE_SCOPE = 'omp:18.10.4:factory-materials-v1';
export const OMP_CUSTOMERS_ENGINE_SCOPE = 'omp:18.10.4:factory-customers-v1';
export const OMP_INGESTION_ENGINE_SCOPE = 'omp:18.10.4:factory-ingestion-v1';
export const OMP_SHOPIFY_ENGINE_SCOPE = 'omp:18.10.4:shopify-product-v1';
export const OMP_MARKET_ENGINE_SCOPE = 'omp:18.10.4:market-validation-v1';
export const OMP_INQUIRIES_ENGINE_SCOPE = 'omp:18.10.4:factory-inquiries-v1';
export { workspaceOmpPaths, checkWorkspaceOmpPaths } from './workspace-omp-runtime.mjs';
export function createWorkspaceOmpEngineAdapter({ paths, configuration, publicTools = {}, nativeBusiness = false, medusaEnterprise = false, factoryMaterials = false, factoryCustomers = false, factoryInquiries = false, factoryIngestion = false, marketValidation = false, shopifyProduct = false, syntheticResponses = null, freeTrade = false, enterpriseContext = false, pluginConfiguration = {},
  syntheticPublicSearchResponses = null, infrastructure = {}, onWorkerLifecycle = () => {}, paidAcceptance = null, modelBudget = null }) {
  if (paidAcceptance !== null && (!nativeBusiness || syntheticResponses || !localDeepseekConfigured(configuration))) throw Error('NATIVE_FACTS_PAID_ACCEPTANCE_REQUIRED');
  const acceptanceAdmission = paidAcceptance === null ? null : createNativeDeepseekAcceptance(paidAcceptance);
  if(modelBudget!==null){modelBudget=normalizeWorkspaceModelBudget(modelBudget);if(paidAcceptance!==null||!nativeBusiness||syntheticResponses||!localDeepseekConfigured(configuration))throw Error('WORKSPACE_MODEL_BUDGET_REQUIRED');}
  if(typeof medusaEnterprise!=='boolean'||medusaEnterprise&&(nativeBusiness||freeTrade||factoryMaterials||factoryCustomers||factoryInquiries||factoryIngestion||marketValidation||shopifyProduct))throw Error('MEDUSA_ENTERPRISE_READONLY_PROFILE_REQUIRED');
  if(medusaEnterprise)enterpriseContext=true;
  if(nativeBusiness){if(freeTrade||enterpriseContext||factoryIngestion||factoryCustomers||factoryInquiries)throw Error('NATIVE_BUSINESS_PROFILE_REQUIRED');factoryMaterials=true;marketValidation=true;shopifyProduct=true;}
  if (syntheticPublicSearchResponses && !syntheticResponses) throw new Error('Public HTTP fixtures require the explicit finite keyless model fixture; production cannot select them.');
  if (typeof factoryInquiries !== 'boolean') throw TypeError('Use one fixed reviewed OMP profile.');
  if (factoryInquiries || marketValidation || shopifyProduct) factoryMaterials = true;
  if (typeof factoryIngestion !== 'boolean' || typeof marketValidation !== 'boolean' || factoryIngestion && (factoryMaterials || factoryCustomers) || marketValidation && (factoryInquiries || factoryCustomers)) throw TypeError('Use one reviewed profile.');
  if(typeof freeTrade!=='boolean'||freeTrade&&(factoryMaterials||factoryCustomers||factoryInquiries||factoryIngestion||marketValidation||shopifyProduct))throw Error('Use one reviewed free-trade profile.');
  if(typeof enterpriseContext!=='boolean'||enterpriseContext&&(freeTrade||factoryMaterials||factoryCustomers||factoryInquiries||factoryIngestion||marketValidation||shopifyProduct))throw Error('Use one original enterprise-context profile.');
  const scopedPlugin=freeTrade||enterpriseContext;
  const privateProfile = factoryMaterials || factoryIngestion || scopedPlugin;
  if (typeof factoryMaterials !== 'boolean' || typeof factoryCustomers !== 'boolean' || factoryMaterials && factoryCustomers) throw TypeError('Use one fixed reviewed OMP profile.');
  if (typeof shopifyProduct !== 'boolean' || shopifyProduct && (factoryIngestion || marketValidation && !nativeBusiness || factoryInquiries || factoryCustomers)) throw TypeError('Use one reviewed Shopify product profile.');
  const engineScope = medusaEnterprise ? MEDUSA_ENTERPRISE_SCOPE : nativeBusiness ? 'omp:18.10.4:business-v1' : enterpriseContext ? OMP_ENTERPRISE_CONTEXT_SCOPE : freeTrade ? OMP_FREE_TRADE_SCOPE : shopifyProduct ? OMP_SHOPIFY_ENGINE_SCOPE : factoryIngestion ? OMP_INGESTION_ENGINE_SCOPE : marketValidation ? OMP_MARKET_ENGINE_SCOPE : factoryInquiries ? OMP_INQUIRIES_ENGINE_SCOPE : factoryMaterials ? OMP_FACTORY_ENGINE_SCOPE : factoryCustomers ? OMP_CUSTOMERS_ENGINE_SCOPE : OMP_ENGINE_SCOPE;
  return Object.freeze({ scope: engineScope,
    async complete({ input, run, binding, client, authorize, budgetStore = null, assertBudgetCurrent = null, enterpriseContextHost = binding?.enterpriseContextHost, freeTradeHost = binding?.freeTradeHost, materialsClient, inquiryClient, customerClient, ingestionClient, planClient, monitorClient, productClient, medusaClient, brainClient, bindBrainForNativeSession = null, marketplaceClient, isolationDirectory, savedSession, saveSession }) {
      input.signal?.throwIfAborted();
      const paidAdmission=modelBudget?createWorkspaceModelBudget({store:budgetStore,selection:modelBudget,configuration}):acceptanceAdmission;
      if(modelBudget&&typeof assertBudgetCurrent!=='function')throw Error('WORKSPACE_MODEL_BUDGET_REQUIRED');
      const brainFactsConfigured = bindBrainForNativeSession !== null;
      const documentToolsConfigured = binding?.brainDocumentTools === true;
      if (documentToolsConfigured && !brainFactsConfigured) throw Error('Original document fact binding required.');
      const modelRequestLimit = documentToolsConfigured ? LOCAL_DEEPSEEK_LIMITS.maxRequests : 4;
      if (paidAdmission && (!brainFactsConfigured || run.businessAgentContext?.resetContext === true)) throw Error('NATIVE_FACTS_PAID_ACCEPTANCE_REQUIRED');
      if (brainFactsConfigured && (!nativeBusiness || typeof bindBrainForNativeSession !== 'function' || brainClient)) throw Error('Original late native Brain binding required.');
      await checkWorkspaceOmpPaths(paths); await authorize();
      if(medusaEnterprise&&(!binding.client.readOnlySession||run.businessAgentContext?.allowBusinessSubmit===true))throw Error('MEDUSA_ENTERPRISE_READONLY_BINDING_REQUIRED');
      if(enterpriseContext){const {assertEnterpriseContextHost}=await import('./workspace-enterprise-context-host.mjs');assertEnterpriseContextHost(enterpriseContextHost);}
      if(freeTrade){const {assertFreeTradeHost}=await import('./workspace-free-trade-host.mjs');assertFreeTradeHost(freeTradeHost);}
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
      if(modelBudget){await paidAdmission.begin(run.id,assertBudgetCurrent);try{await authorize();paidAdmission.assertCurrent(run.id);}catch(error){await paidAdmission.finish(run.id,{report:null,modelCalls:0,successful:false});throw error;}}
      else paidAdmission?.begin(run.id);
      return await new Promise((resolve, reject) => {
        const child = spawn(paths.bun, [path.join(root, 'server/workspace-omp-worker.mjs')], { cwd: isolationDirectory, env: childEnv, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
        onWorkerLifecycle({ phase: 'spawn', pid: child.pid });
        const channel = child.stdio[3]; let settled = false, bytes = 0, modelCalls = 0, preparedCalls=0, permittedCall=0, childClosed = false, cleanupComplete = false, pendingResult = null, resultVerified = false;
        let providerReport = null, providerReportReceived = false;
        let activeHandlers=0,durableFinishing=false,durableAccounted=false;
        let paidFailurePending = null, paidFailureTimer, paidFailureFinalizing = false;
        let paidDispatchedCalls = 0, paidWirePermittedCall = 0, paidWireRefusedCall = 0, paidDisclosureStopped = false;
        const lines = createInterface({ input: channel, crlfDelay: Infinity });
        const send = value => { if (!channel.destroyed) channel.write(JSON.stringify(value) + '\n'); };
        let terminateTimer, killTimer;
        const operations = new Map();let enterpriseControl,enterpriseNativeId,freeControl,freeNativeId,delivering=false,nativeMapping=savedSession;
        let factBindingStarted=false,factSaveStarted=false,factSaved=false,factControl=null,factNativeId=null,factReceiver=null,factFinalCalls=null,factActivity=0,factOperations=0,factDocumentTools=null;
        const stop = () => { if (childClosed || killTimer) return; send({ type: 'abort' });
          // Let the official root/child AbortSignals settle first. Escalation
          // remains bounded and targets only this owned worker/process group.
          terminateTimer = setTimeout(() => { if (!childClosed) child.kill('SIGTERM'); }, 250); terminateTimer.unref();
          killTimer = setTimeout(() => { if (!childClosed) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }, 1500); killTimer.unref(); };
        const timer = setTimeout(stop, 65000);
        const finish = (error, result) => { if (settled||durableFinishing) return;
          if (paidAdmission && error && !(childClosed && cleanupComplete && (!modelBudget||activeHandlers===0)) && !paidFailureFinalizing) {
            // Keep the original failed worker's fd open until bounded cleanup:
            // late protocol faults must invalidate a previously complete report.
            paidFailurePending ||= error; paidDisclosureStopped = true; stop();
            paidFailureTimer ||= setTimeout(() => {
              providerReport = null; paidFailureFinalizing = true;
              finish(paidFailurePending);
            }, 2000);
            return;
          }
          if (paidAdmission) {
            // Close pending pre-send callbacks even when a malformed report
            // failed before it could become the terminal accepted report.
            if (error) paidDisclosureStopped = true;
            if (!error) try { validateLocalDeepseekReport(providerReport, { modelCalls, requireConfirmed: true }); }
            catch { error = new ProviderError('OMP_PROVIDER_ACCOUNTING_REFUSED', 'Complete original provider usage is required; do not retry.'); }
            if(modelBudget){
              durableFinishing=true;
              void (async()=>{
                try{
                  // Success was durably accounted BEFORE the original final
                  // full journal/source checks, so no write-await splits them.
                  if(!durableAccounted){
                    if(!error)throw Error('Original final accounting required.');
                    const accounting=await paidAdmission.finish(run.id,{report:providerReport,modelCalls:paidDispatchedCalls,successful:false});
                    durableAccounted=true;onWorkerLifecycle(accounting);
                  }
                }catch{paidAdmission.stop();error ||= new ProviderError('OMP_PROVIDER_ACCOUNTING_REFUSED','Original provider accounting could not be durably confirmed.');}
                settled=true;clearTimeout(timer);clearTimeout(paidFailureTimer);input.signal?.removeEventListener('abort',stop);
                if(error){paidDisclosureStopped=true;stop();reject(error);}else resolve(result);
              })();
              return;
            }
            try {
              const accounting = paidAdmission.finish(run.id, { report: providerReport, modelCalls: paidDispatchedCalls, successful: !error });
              onWorkerLifecycle(accounting);
              // The trusted observation hook cannot insert a source change
              // between the last full original fact check and delivery.
              if (!error) factControl.assertDisclosureCurrent({messages:[],context:[]}, factReceiver, input.signal);
            } catch {
              paidAdmission.stop();
              error ||= new ProviderError('OMP_DISCLOSURE_REFUSED', 'Original final disclosure or accounting no longer permits this result.');
            }
          }
          if (paidAdmission && error) paidDisclosureStopped = true;
          settled = true; clearTimeout(timer); clearTimeout(paidFailureTimer); input.signal?.removeEventListener('abort', stop);
          if (error) { stop(); reject(error); } else resolve(result); };
        channel.on('error', () => { if (!pendingResult) finish(new ProviderError('OMP_SESSION_FAILED', 'The official OMP transport closed.')); });
        lines.on('error', () => { if (!pendingResult) finish(new ProviderError('OMP_SESSION_FAILED', 'The official OMP line transport closed.')); });
        const finishSuccess = () => {
          if(!childClosed||!cleanupComplete||!resultVerified||delivering||modelBudget&&activeHandlers)return;delivering=true;
          void(async()=>{
            if(modelBudget){
              validateLocalDeepseekReport(providerReport,{modelCalls,requireConfirmed:true});
              const accounting=await paidAdmission.finish(run.id,{report:providerReport,modelCalls:paidDispatchedCalls,successful:true});
              durableAccounted=true;onWorkerLifecycle(accounting);
            }
            await authorize();if(freeTrade){if(!freeControl)throw Error();await freeControl.finalCheck(input.signal,binding.model);}
            if(enterpriseContext){if(!enterpriseControl)throw Error();await enterpriseControl.finalCheck(input.signal,binding.model);}
            if (brainFactsConfigured) {
              if (!factControl || factFinalCalls !== modelCalls || !factReceiver || factOperations) throw Error('Original final fact disclosure required.');
              await factControl.finalCheck(input.signal, factReceiver);
            }
            if(nativeBusiness||factoryInquiries||medusaEnterprise){
              if(!nativeMapping||path.dirname(nativeMapping.sessionFile)!==sessionDirectory)throw Error('Original journal mapping required.');
              const file=await openPrivateFile(nativeMapping.sessionFile);let journal;
              try{if((await file.stat()).size>32000000)throw Error('Original journal bound exceeded.');journal=await file.readFile('utf8');}finally{await file.close();}
              const entries=journal.trim().split('\n').map(line=>JSON.parse(line));
              const messages=await readBusinessContext(entries,{paths,signal:input.signal,fullReadonlyHistory:medusaEnterprise});
              if(medusaEnterprise){
                await revalidateMedusaEnterpriseJournal(messages,{medusaClient,enterpriseControl,model:binding.model,signal:input.signal});
                await authorize();
                assertMedusaEnterpriseDisclosure(messages,{medusaClient,enterpriseControl,model:binding.model,signal:input.signal});
              }
              else if(nativeBusiness)await revalidateBusinessJournal(messages,{materialsClient,planClient,monitorClient,productClient,medusaClient,brainClient,marketplaceClient,documentTools:factDocumentTools,model:binding.model,signal:input.signal});
              else{
                const {revalidateInquiryJournal}=await import('./factory-inquiries.mjs');
                await revalidateInquiryJournal(messages,{materialsClient,inquiryClient,model:binding.model,signal:input.signal});
              }
              // Inquiry clients finish with original authorization followed by
              // synchronous source/Artifact checks; do not add an async gap
              // after that final check. Preserve the existing business fence.
              if(nativeBusiness){await authorize();factDocumentTools?.assertDisclosureCurrent({messages,context:messages},factReceiver,input.signal);}
            }
            if (brainFactsConfigured) {
              if (factFinalCalls !== modelCalls || factOperations) throw Error('Original final fact disclosure required.');
              factControl.assertDisclosureCurrent({messages:[],context:[]}, factReceiver, input.signal);
            }
            finish(null,{...pendingResult,runtime:{...pendingResult.runtime,workerExitObserved:true}});
          })().catch(()=>finish(new ProviderError('OMP_DISCLOSURE_REFUSED','Original final disclosure authorization no longer permits this result.')));
        };
        input.signal?.addEventListener('abort', stop, { once: true });
        if (input.signal?.aborted) stop();
        const allowed = new Set(scopedPlugin || factoryCustomers || factoryInquiries || factoryIngestion || marketValidation || shopifyProduct ? [] : client.readOnlySession ? ['businessTasks', 'businessStatus', 'businessResult'] : ['businessPresets', 'businessSubmit', 'businessTasks', 'businessStatus', 'businessResult']);
        const handleLine = async line => {
          bytes += Buffer.byteLength(line); if (bytes > 8_000_000 || Buffer.byteLength(line) > 2_000_000) { finish(new ProviderError('OMP_PROTOCOL_LIMIT', 'OMP exceeded its admitted transport limit.')); return; }
          let message; try { message = JSON.parse(line); } catch { finish(new ProviderError('OMP_PROTOCOL_INVALID', 'OMP returned an invalid transport receipt.')); return; }
          if (paidAdmission && paidFailurePending && message.type === 'request') {
            providerReport = null; finish(paidFailurePending); return;
          }
          if (paidAdmission && providerReportReceived && message.type === 'request' && (message.method === 'modelRequest'
            || message.method === 'businessFactsDisclosure' && message.args?.[0]?.phase === 'model:disclose')) {
            providerReport = null;
            finish(new ProviderError('OMP_PROVIDER_ACCOUNTING_REFUSED', 'A terminal provider report cannot admit another model request; do not retry.'));
            return;
          }
          if (message.type === 'cancelRequest') { operations.get(message.id)?.abort(); return; }
          if (message.type === 'request') {
            if (!Number.isSafeInteger(message.id) || message.id < 1 || operations.has(message.id)) { finish(new ProviderError('OMP_PROTOCOL_INVALID', 'Invalid original operation identifier.')); return; }
            const operation = new AbortController(); operations.set(message.id, operation);
            const rpcSignal = input.signal ? AbortSignal.any([input.signal, operation.signal]) : operation.signal;
            const factPendingRequest=brainFactsConfigured&&['businessBrain','businessDocuments','modelRequest'].includes(message.method);
            if(factPendingRequest){factActivity++;factOperations++;factFinalCalls=null;}
            try {
              rpcSignal.throwIfAborted(); await authorize(); rpcSignal.throwIfAborted(); let result;
              if (message.method === 'authorize') result = true;
              else if (brainFactsConfigured && message.method === 'brainNativeSessionReady') {
                const value=message.args?.[0];
                if (!Array.isArray(message.args) || message.args.length!==1 || !value || Object.keys(value).join(',')!=='nativeSessionId'
                  || typeof value.nativeSessionId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.nativeSessionId)
                  || factBindingStarted || savedSession && savedSession.agentSessionId!==value.nativeSessionId)
                  throw Error('Original native fact Session required.');
                // Lock before await: a repeated/concurrent RPC cannot reopen
                // the original control and discard its observed fact proofs.
                factBindingStarted=true;
                const bound=await bindBrainForNativeSession(value.nativeSessionId);
                factControl=bound.control;brainClient=bound.brain;factNativeId=value.nativeSessionId;
                if(documentToolsConfigured){if(!bound.documentTools)throw Error('Original document tools required.');factDocumentTools=bound.documentTools;}
                result=factDocumentTools?await factDocumentTools.describe(rpcSignal,binding.model):true;
              }
              else if (brainFactsConfigured && message.method === 'businessFactsDisclosure') {
                const value=message.args?.[0],receiver=value?.receiver;
                if (paidAdmission && value?.phase === 'model:disclose' && (providerReportReceived || paidDisclosureStopped)) {
                  providerReport = null;
                  throw Error('LOCAL_ACCEPTANCE_ACCOUNTING_REFUSED');
                }
                if (!Array.isArray(message.args) || message.args.length!==1 || !value || Object.keys(value).some(k=>!['nativeSessionId','phase','modelCalls','receiver','wireBody',...(documentToolsConfigured?['messages','context']:[])].includes(k))
                  || !factControl || value.nativeSessionId!==factNativeId || !['model:disclose','final:deliver'].includes(value.phase)
                  || !Number.isSafeInteger(value.modelCalls) || value.modelCalls!==modelCalls
                  || !receiver || Object.keys(receiver).sort().join(',')!=='baseUrl,id,provider'
                  || ['provider','id','baseUrl'].some(k=>typeof receiver[k]!=='string'||!receiver[k])
                  || value.wireBody!==undefined && typeof value.wireBody!=='string') throw Error('Original fact disclosure boundary required.');
                const activity=factActivity;
                if(factOperations)throw Error('Original fact operations must settle before disclosure.');
                if(documentToolsConfigured&&(!Array.isArray(value.messages)||!Array.isArray(value.context)))throw Error('Original document context required.');
                const payload = {messages:documentToolsConfigured?value.messages:[],context:documentToolsConfigured?value.context:[],...(value.wireBody===undefined?{}:{wireBody:value.wireBody})};
                if(factDocumentTools){await factDocumentTools.revalidate(payload.messages,rpcSignal,receiver);await factDocumentTools.revalidate(payload.context,rpcSignal,receiver);}
                await factControl.authorizeDisclosure(payload,rpcSignal,receiver);
                if (paidAdmission && value.phase === 'model:disclose' && (providerReportReceived || paidDisclosureStopped)) {
                  providerReport = null;
                  throw Error('LOCAL_ACCEPTANCE_ACCOUNTING_REFUSED');
                }
                // Keep the original authority in Node and close the async
                // callback boundary with its complete synchronous proof check.
                factControl.assertDisclosureCurrent(payload,receiver,rpcSignal);
                factDocumentTools?.assertDisclosureCurrent(payload,receiver,rpcSignal);
                if(factOperations || activity!==factActivity || value.modelCalls!==modelCalls)throw Error('Original fact disclosure changed during authorization.');
                if (paidAdmission && value.phase === 'model:disclose' && value.wireBody !== undefined) {
                  if(modelBudget){assertBudgetCurrent();paidAdmission.assertCurrent(run.id);}
                  if (paidWirePermittedCall === modelCalls) throw Error('LOCAL_ACCEPTANCE_ACCOUNTING_REFUSED');
                  paidWirePermittedCall = modelCalls;
                }
                factReceiver=Object.freeze({...receiver});
                factFinalCalls=value.phase==='final:deliver'?value.modelCalls:null;
                result=true;
              }
              else if (message.method === 'saveSession') {
                if (brainFactsConfigured) {
                  const mapping=message.args?.[0];
                  if (!factControl || factSaveStarted || !Array.isArray(message.args) || message.args.length!==1 || !mapping
                    || Object.keys(mapping).sort().join(',')!=='agentSessionId,engineScope,sessionFile'
                    || mapping.agentSessionId!==factNativeId || mapping.engineScope!==engineScope
                    || savedSession && mapping.sessionFile!==savedSession.sessionFile) throw Error('Original fact-bound mapping required.');
                  factSaveStarted=true;
                }
                result = await saveSession(message.args[0]);nativeMapping=message.args[0];
                if(brainFactsConfigured)factSaved=true;
                if(enterpriseContext&&!enterpriseControl){enterpriseNativeId=message.args[0].agentSessionId;enterpriseControl=enterpriseContextHost.open(enterpriseNativeId,{conversationId:input.conversationId,runId:run.id,requestId:run.requestId});}
                if(enterpriseContext&&enterpriseNativeId!==message.args[0].agentSessionId)throw Error('Original native Session required.');
              }
              else if (message.method === 'modelRequest') {
                if(modelBudget){assertBudgetCurrent();paidAdmission.assertCurrent(run.id);}
                if (paidAdmission && (providerReportReceived || paidDisclosureStopped)) {
                  providerReport = null;
                  finish(new ProviderError('OMP_PROVIDER_ACCOUNTING_REFUSED', 'A terminal provider report cannot admit another model request; do not retry.'));
                  throw Error('LOCAL_ACCEPTANCE_ACCOUNTING_REFUSED');
                }
                if(brainFactsConfigured&&(!factControl||!factSaved||nativeMapping?.agentSessionId!==factNativeId||message.args?.[0]?.modelCalls!==modelCalls+1))throw Error('Original native fact binding must precede model requests.');
                if(enterpriseContext){if(++preparedCalls>4||message.args?.[0]?.modelCalls!==preparedCalls)throw Error('Original model request bound exceeded.');await input.onEvent?.({type:'pi.agent-session.admission',engine:'omp'});}else{if(++modelCalls>modelRequestLimit)throw Error('Original model request bound exceeded.');await input.onEvent?.({type:'pi.agent-session.request',engine:'omp'});}result=true;
              }
              else if(enterpriseContext&&message.method==='enterpriseContext'){
                const [nativeId,method,args=[]]=message.args||[];
                if(typeof nativeId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(nativeId)||!Array.isArray(args)||args.length>2
                  ||enterpriseNativeId&&nativeId!==enterpriseNativeId||savedSession&&savedSession.agentSessionId!==nativeId)throw Error('Original native Session required.');
                if(!enterpriseControl){enterpriseNativeId=nativeId;enterpriseControl=enterpriseContextHost.open(nativeId,{conversationId:input.conversationId,runId:run.id,requestId:run.requestId});}
                if(method==='authorizeDisclosure'){
                  if(args[0]?.modelCalls!==preparedCalls)throw Error('OSS_FINAL_DISCLOSURE_REQUIRED');
                  if(medusaEnterprise&&typeof args[0]?.wireBody==='string')onWorkerLifecycle({phase:'medusaEnterpriseWireCheck'});
                  result=enterpriseControl.assertDisclosureCurrent(args[0],args[1],rpcSignal);
                  if(medusaEnterprise)assertMedusaEnterpriseDisclosure(args[0].messages,{medusaClient,enterpriseControl,model:args[1],signal:rpcSignal,wireBody:args[0].wireBody});
                  permittedCall=preparedCalls;
                }
                else if(method==='refresh')result=await enterpriseControl.refresh(args[0],rpcSignal,args[1]);
                else if(method==='authorizeContext')result=await enterpriseControl.authorizeContext(rpcSignal,args[0]);
                else if(method==='check'){if(syntheticResponses)onWorkerLifecycle({phase:'enterpriseSourceCheck'});result=await enterpriseControl.check(args[0],rpcSignal,args[1]);}
                else if(method==='verifyBody')result=await enterpriseControl.verifyBody(args[0],args[1]);
                else if(medusaEnterprise&&['memorySearch','memoryAdd','memoryHistory','structuredMemoryLookup','structuredMemoryRemember'].includes(method))throw Error('MEDUSA_ENTERPRISE_READONLY_REQUIRED');
                else if(['status','memorySearch','memoryAdd','memoryHistory','parseUpload','structuredMemoryLookup','structuredMemoryRemember'].includes(method))result=await enterpriseControl[method](args[0],rpcSignal,args[1]);
                else throw Error('Original enterprise-context capability required.');
              }
              else if(freeTrade&&message.method==='freeTrade'){
                const [nativeId,method,args=[]]=message.args||[];
                if(typeof nativeId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(nativeId)||!Array.isArray(args)||args.length>3
                  ||freeNativeId&&nativeId!==freeNativeId||savedSession&&savedSession.agentSessionId!==nativeId)throw Error('Original native Session required.');
                if(!freeControl){freeNativeId=nativeId;freeControl=freeTradeHost.open(nativeId);}
                if(method==='authorize')result=await freeControl.authorize(args[0],rpcSignal,args[1]);
                else if(method==='authorizeContext')result=await freeControl.authorizeContext(rpcSignal,args[0],args[1]);
                else if(method==='read')result=await freeControl.erp.read(args[0],rpcSignal,args[1]);
                else if(method==='seal')result=await freeControl.seal(args[0],args[1],rpcSignal,args[2]);
                else if(method==='verifyBody')result=await freeControl.verifyBody(args[0],args[1]);
                else if(method==='check'){
                  if(syntheticResponses)onWorkerLifecycle({phase:'freeTradeCheck',boundary:args[2]?.phase});
                  result=await freeControl.check(args[0],rpcSignal,args[1],args[2]);
                }else if(method==='tenderSearch'){
                  await freeControl.authorize({tool:'workspace_tender_search',input:args[0]},rpcSignal,binding.model);
                  result=await freeControl.tenders.search(args[0],rpcSignal);
                  await freeControl.authorize({tool:'workspace_tender_search',input:args[0]},rpcSignal,binding.model);
                }else throw Error('Original free-trade read capability required.');
              }
              else if(nativeBusiness&&message.method==='marketplace'){
                const [method,value,model]=message.args||[];if(!marketplaceClient||!['status','find','propose','order','revalidateReceipt'].includes(method))throw Error('Original Marketplace method required.');
                result=await marketplaceClient[method](value,rpcSignal,model);
              }
              else if((nativeBusiness||medusaEnterprise)&&message.method==='medusaCatalog'){
                const [method,value,model]=message.args||[];
                if(!medusaClient||!['status','preview','reconcile','refresh'].includes(method))throw Error('Original Medusa method required.');
                result=method==='refresh'?await medusaClient.refresh(value,model,rpcSignal):await medusaClient[method](value,rpcSignal,model);
              }
              else if(documentToolsConfigured&&message.method==='businessDocuments'){
                const [method,value,model]=message.args||[];
                if(!factDocumentTools||!factSaved||!Array.isArray(message.args)||message.args.length!==3
                  ||!['parseUpload','structuredMemoryLookup','structuredMemoryRemember'].includes(method))throw Error('Original document capability required.');
                result=await factDocumentTools[method](value,rpcSignal,model);
              }
              else if(nativeBusiness&&message.method==='businessBrain'){
                const [method,value,model]=message.args||[];
                if(!brainClient||!['sourceCatalog','contextRead','contextSave','diagnose','decisionRead','decisionSave','reviewSave','brief','revalidateReceipt'].includes(method))throw Error('Original Brain method required.');
                result=await brainClient[method](value,rpcSignal,model);
              }
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
              if (paidAdmission && (message.method === 'modelRequest' || message.method === 'businessFactsDisclosure' && message.args?.[0]?.phase === 'model:disclose')) {
                if (!providerReportReceived && message.args?.[0]?.modelCalls === modelCalls && paidWirePermittedCall !== modelCalls) paidWireRefusedCall = modelCalls;
                paidDisclosureStopped = true;
              }
              if (syntheticResponses) onWorkerLifecycle({ phase: 'rpc-refused', method: message.method,
                ...(['freeTrade','enterpriseContext'].includes(message.method)?{operation:message.args?.[1]}:{}),code: error.code || error.name });
              // Preserve only reviewed business codes, never arbitrary Host error text.
              const codes = ['MARKETPLACE_SCOPE_REQUIRED','MARKETPLACE_SOURCE_CHANGED','MARKETPLACE_INPUT_INVALID','MARKETPLACE_CANCELLED','MARKETPLACE_UNCONFIGURED','SHOPIFY_PRODUCT_SKUS_NOT_SELECTED', 'SHOPIFY_PRODUCT_SKU_SOURCE_MISMATCH', 'SHOPIFY_PRODUCT_VARIANTS_INVALID', 'SHOPIFY_PRODUCT_SOURCE_CHANGED', 'SHOPIFY_PRODUCT_IMAGES_NOT_SELECTED', 'SHOPIFY_PRODUCT_IMAGE_NOT_SELECTED', 'SHOPIFY_PRODUCT_IMAGE_TOO_LARGE', 'SHOPIFY_PRODUCT_CACHE_REFUSED', 'SHOPIFY_PRODUCT_INPUT_INVALID', 'SUPPLIER_PUBLICATION_NOT_EXECUTABLE', 'SUPPLIER_PUBLICATION_STALE', 'SHOPIFY_SETUP_REQUIRED', 'SHOPIFY_PRODUCT_WRITE_NOT_AUTHORIZED', 'IDEMPOTENCY_CONFLICT', 'FACTORY_INQUIRY_SOURCE_CHANGED', 'FACTORY_INQUIRY_REQUEST_CHANGED', 'FACTORY_INQUIRY_ARTIFACT_CHANGED', 'FACTORY_INQUIRY_SOURCE_REFUSED',
                'FACTORY_INGESTION_UPLOAD_NOT_APPROVED', 'FACTORY_INGESTION_SOURCE_CHANGED', 'FACTORY_INGESTION_TARGET_CHANGED', 'FACTORY_INGESTION_REQUEST_CHANGED', 'FACTORY_INGESTION_QUERY_REAUTHORIZE', 'FACTORY_INGESTION_FIELD_NOT_APPROVED', 'FACTORY_INGESTION_SCOPE_REFUSED', 'FACTORY_INGESTION_CACHE_CHANGED',
                'REAL_LAUNCH_RECEIPT_REQUIRED', 'MARKET_PLAN_RECEIPT_MISMATCH', 'MONITOR_NOT_FOUND', 'MONITOR_SOURCE_OWNER_REQUIRED', 'MONITOR_SCOPE_CHANGED', 'APPROVAL_REQUIRED', 'APPROVAL_MISMATCH', 'APPROVAL_EXPIRED', 'APPROVAL_USED', 'MONITOR_STOPPED', 'MONITOR_WINDOW_ENDED', 'MONITOR_CANCELLED', 'LAUNCH_SCOPE_CHANGED', 'BUSINESS_EXECUTION_INTENT_REQUIRED',
                'MARKET_PLAN_SOURCE_CHANGED', 'MARKET_PLAN_REQUEST_CHANGED', 'MARKET_PLAN_CACHE_REFUSED', 'MARKET_PLAN_DOCUMENT_NOT_LINKED', 'MARKET_PLAN_SOURCE_REFUSED',
                'PUBLIC_DRAFT_REQUEST_CHANGED', 'PUBLIC_DRAFT_ARTIFACT_CHANGED', 'ORIGINAL_PUBLIC_SOURCE_RECEIPT_REQUIRED', 'PUBLIC_SOURCE_URL_REFUSED', 'PUBLIC_SOURCE_METADATA_LIMIT'];
              send({ type: 'reply', id: message.id, error: 'Original authorization or task operation refused; no replacement execution was admitted.',
                ...(codes.includes(error.code)||enterpriseContext&&/^(?:OSS|DOCLING)_[A-Z0-9_]+$/.test(error.code||'')||freeTrade&&(/^FREE_TRADE_[A-Z0-9_]+$/.test(error.code||'')||['ERP_REVIEWED_CONNECTION_REQUIRED','SAM_API_KEY_REQUIRED','ORIGINAL_AUTHORIZATION_REFUSED','REMOTE_AUTHORIZATION_REFUSED','ERP_RECORD_MISMATCH','ERP_FIELD_SHAPE_INVALID','NETWORK_UNAVAILABLE','REQUEST_TIMEOUT','SECRET_ECHO_REFUSED'].includes(error.code)) ? { errorCode: error.code } : {}),
                ...([400, 401, 403, 404, 409, 503].includes(error.status)||freeTrade&&['blocked','unavailable','unconfigured'].includes(error.status) ? { status: error.status } : {}) });
            } finally { operations.delete(message.id);if(factPendingRequest){factOperations--;factFinalCalls=null;} }
          } else if(message.type==='modelDispatched'&&paidAdmission){
            if(providerReportReceived || paidDisclosureStopped || message.modelCalls!==paidDispatchedCalls+1
              || message.modelCalls!==modelCalls || message.modelCalls!==paidWirePermittedCall) {
              providerReport=null;throw Error('LOCAL_ACCEPTANCE_ACCOUNTING_REFUSED');
            }
            paidDispatchedCalls=message.modelCalls;
          } else if(message.type==='modelDispatched'&&enterpriseContext){if(message.modelCalls!==permittedCall||message.modelCalls!==modelCalls+1)throw Error('OSS_FINAL_DISCLOSURE_REQUIRED');modelCalls++;await input.onEvent?.({type:'pi.agent-session.request',engine:'omp'});
          } else if (message.type === 'event') {
            const event = message.event;
            if (typeof event?.toolName === 'string' && event.toolName.startsWith('workspace_')) await input.onEvent?.({
              type: event.type === 'tool_execution_start' ? 'pi.tool.started' : event.isError ? 'pi.tool.failed' : 'pi.tool.finished',
              toolName: event.toolName, toolCallId: createHash('sha256').update(String(event.toolCallId)).digest('hex'), engine: 'omp' });
          } else if (message.type === 'providerAccounting') {
            if (!paidAdmission || providerReportReceived || paidFailurePending || pendingResult || operations.size
              || modelCalls !== paidDispatchedCalls && !(paidDisclosureStopped && paidWireRefusedCall === modelCalls && modelCalls === paidDispatchedCalls + 1)) {
              providerReport = null;
              throw Error('LOCAL_ACCEPTANCE_ACCOUNTING_REFUSED');
            }
            providerReportReceived = true;
            providerReport = validateLocalDeepseekReport(message.report, { modelCalls: paidDispatchedCalls });
          } else if (message.type === 'result') {
            if(brainFactsConfigured&&(pendingResult||!factSaved||factOperations))throw Error('One settled original fact result required.');
            pendingResult = message.result;
            try { await authorize(); const result = pendingResult; if (result?.runtime?.engineScope !== engineScope || result.runtime.originalRunId !== run.id || result.runtime.modelCalls !== modelCalls) throw new Error();
              if(brainFactsConfigured&&(!factControl||factFinalCalls!==modelCalls||result.runtime.agentSessionId!==factNativeId||nativeMapping?.agentSessionId!==factNativeId))throw Error('Original fact-bound result required.');
              resultVerified = true; finishSuccess(); }
            catch { finish(new ProviderError('OMP_RECEIPT_INVALID', 'OMP returned an invalid original-run receipt.')); }
          } else if (message.type === 'nativeModelAbort' && syntheticResponses) onWorkerLifecycle({ phase: 'nativeModelAbort', pid: child.pid });
          else if (message.type === 'nativeModelWaiting' && syntheticResponses) onWorkerLifecycle({ phase: 'nativeModelWaiting', pid: child.pid });
          else if (message.type === 'error') finish(message.errorCode==='MARKETPLACE_SOURCE_CHANGED'
            ?new ProviderError('OMP_CONTEXT_REFRESH_REQUIRED','Original business status changed. Confirm resetContext in this conversation human controls, then reread currently authorized data. Audit history and drafts remain; no authority is renewed.')
            :new ProviderError('OMP_SESSION_FAILED', message.error + (syntheticResponses && message.diagnostic ? ' Explicit synthetic fixture diagnostic: ' + message.diagnostic : '')));
        };
        lines.on('line', line => { activeHandlers++;void handleLine(line).catch(() => finish(new ProviderError('OMP_SESSION_FAILED','The original OMP host operation stopped.'))).finally(()=>{
          activeHandlers--;if(modelBudget&&activeHandlers===0&&childClosed&&cleanupComplete){if(paidFailurePending)finish(paidFailurePending);else finishSuccess();}
        }); });
        child.on('error', () => finish(new ProviderError('OMP_UNAVAILABLE', 'The reviewed OMP runtime could not start.')));
        child.on('close', code => { childClosed = true; for (const operation of operations.values()) operation.abort(); operations.clear(); clearTimeout(terminateTimer); clearTimeout(killTimer); lines.close();
          void cleanupSnapshots().then(() => {
            cleanupComplete = true; onWorkerLifecycle({ phase: 'exit', pid: child.pid, code });
            if (paidFailurePending) finish(paidFailurePending);
            else if (pendingResult && code === 0) finishSuccess();
            else if (!settled) finish(new ProviderError(input.signal?.aborted ? 'CANCELLED' : 'OMP_SESSION_FAILED', 'The official OMP session stopped without completion.'));
          }).catch(() => { if (paidAdmission) { providerReport = null; paidFailureFinalizing = true; }
            finish(new ProviderError('OMP_SNAPSHOT_CLEANUP_FAILED', 'The owned public Run snapshot could not be cleaned.')); }); });
        send({ type: 'start', config: { packageRoot: paths.packageRoot, cwd: isolationDirectory, agentDir, sessionDirectory, savedSession,
          configuration, engineScope, nativeBusiness, medusaEnterprise, ...(modelBudget?{boundedBusiness:true}:paidAdmission?{paidAcceptance:NATIVE_FACTS_PAID_ACCEPTANCE}:{}), resetBusinessContext:nativeBusiness&&run.businessAgentContext?.resetContext===true, medusaConfigured:!!medusaClient, brainConfigured:!!brainClient||brainFactsConfigured, ...(brainFactsConfigured?{brainFactsConfigured:true}:{}), ...(documentToolsConfigured?{documentToolsConfigured:true,maxModelCalls:modelRequestLimit}:{}), marketplaceConfigured:!!marketplaceClient, readOnlyBusiness: !nativeBusiness&&!scopedPlugin&&client.readOnlySession === true, enterpriseContext,enterpriseContextDescriptor:enterpriseContext?enterpriseContextHost.describe():null,freeTrade,freeTradeDescriptor:freeTrade?freeTradeHost.describe():null,pluginConfiguration:medusaEnterprise?{configuration:'config.medusa-enterprise-readonly.json',...pluginConfiguration}:nativeBusiness?{configuration:'config.business.json',...pluginConfiguration}:scopedPlugin?{configuration:enterpriseContext?'config.enterprise-context.json':'config.free-trade.json',...pluginConfiguration}:{},factoryMaterials, factoryCustomers, factoryInquiries, factoryIngestion, marketValidation, shopifyProduct, publicTools: publicToolConfiguration, syntheticResponses, syntheticPublicSearchResponses,
          content: user.content, runId: run.id, maxTokens: input.maxTokens } });
      }).catch(error => { paidAdmission?.stop(); throw error; });
    },
  });
}
