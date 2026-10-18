// Durable admission on the original Store.runs only. No model loop, account
// balance lookup, new Store or second billing ledger. Prices/report checks are
// the same reviewed bounded transport primitives used by finite acceptance.
import {createHash} from 'node:crypto';
import {LOCAL_DEEPSEEK_LIMITS, localDeepseekConfigured, validateLocalDeepseekReport} from './workspace-omp-local-deepseek.mjs';
import {DEEPSEEK_PRICES} from './deepseek-acceptance-policy.mjs';
import {ProviderError} from './provider.mjs';
export const WORKSPACE_MODEL_BUDGET = 'workspace-deepseek-budget-v1';
const fail = (code='MODEL_BUDGET_INVALID') => { throw new ProviderError(code,
 code==='MODEL_BUDGET_UNCONFIRMED'?'An earlier model charge is unconfirmed. Further sends are stopped until the operator reconciles the existing budget.'
 :code==='MODEL_BUDGET_EXHAUSTED'?'The reviewed model allowance cannot reserve this turn. Ask the operator to review the existing budget; no model request was sent.'
 :'The reviewed model budget or current Run is unavailable. Review the original configuration and accounting; do not automatically retry.'); };
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/.test(v);
const units=(value,round=Math.ceil)=>{if(!Number.isFinite(value)||value<0)fail();const n=round(value*1000000);if(!Number.isSafeInteger(n))fail();return n;};
const reserveUnits=units(LOCAL_DEEPSEEK_LIMITS.maxTaskReserveCny);
const scopeHash=selection=>createHash('sha256').update(JSON.stringify({selection,prices:DEEPSEEK_PRICES,limits:LOCAL_DEEPSEEK_LIMITS})).digest('hex');
export function normalizeWorkspaceModelBudget(value) {
 if(!exact(value,['kind','reviewed','budgetId','workspaceId','subject','expiresAt','limitCny','historicalUpperCny','receiver'])
  ||value.kind!==WORKSPACE_MODEL_BUDGET||value.reviewed!==true||![value.budgetId,value.workspaceId,value.subject].every(id)
  ||typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.expiresAt))
  ||!exact(value.receiver,['provider','id','baseUrl'])||!localDeepseekConfigured({providerId:value.receiver.provider,model:value.receiver.id,baseUrl:value.receiver.baseUrl}))fail();
 if(units(value.limitCny,Math.floor)<reserveUnits||units(value.historicalUpperCny)>units(value.limitCny,Math.floor))fail();
 return {kind:value.kind,reviewed:true,budgetId:value.budgetId,workspaceId:value.workspaceId,subject:value.subject,expiresAt:value.expiresAt,
  limitCny:value.limitCny,historicalUpperCny:value.historicalUpperCny,receiver:{provider:value.receiver.provider,id:value.receiver.id,baseUrl:value.receiver.baseUrl}};
}
export function validateWorkspaceModelBudgetState(state) {
 const groups=new Map();
 for(const run of state.runs||[]) {
  const row=run.modelBudgetReceipt;if(row===undefined)continue;
  if(!exact(row,['version','scopeHash','selection','phase','reservedMicros','chargedMicros','dispatchedCalls','report'])||row.version!==1)fail();
  const selection=normalizeWorkspaceModelBudget(row.selection),scope=scopeHash(selection);
  if(row.scopeHash!==scope||row.reservedMicros!==reserveUnits||!Number.isSafeInteger(row.chargedMicros)||row.chargedMicros<0
   ||row.chargedMicros>reserveUnits||!Number.isSafeInteger(row.dispatchedCalls)||row.dispatchedCalls<0||row.dispatchedCalls>LOCAL_DEEPSEEK_LIMITS.maxRequests
   ||!['reserved','confirmed','uncertain'].includes(row.phase))fail();
  if(row.phase==='reserved'&&(row.chargedMicros!==reserveUnits||row.report!==null||row.dispatchedCalls!==0))fail();
  if(row.phase==='uncertain'&&(row.chargedMicros!==reserveUnits||row.report!==null))fail();
  if(row.phase==='confirmed') {
   const report=validateLocalDeepseekReport(row.report,{modelCalls:row.dispatchedCalls});
   if(report.billingUncertain||report.chargeUpperCny===null||units(report.chargeUpperCny)!==row.chargedMicros)fail();
  }
  if(run.businessAgentContext?.workspaceId!==selection.workspaceId||run.businessAgentContext?.subject!==selection.subject)fail();
  const key=selection.budgetId,group=groups.get(key)||{scope,total:units(selection.historicalUpperCny),limit:units(selection.limitCny,Math.floor)};
  if(group.scope!==scope)fail('MODEL_BUDGET_POLICY_CHANGED');group.total+=row.chargedMicros;
  if(!Number.isSafeInteger(group.total)||group.total>group.limit)fail('MODEL_BUDGET_EXHAUSTED');groups.set(key,group);
 }
 return true;
}
export function createWorkspaceModelBudget({store,selection:input,configuration,clock=Date.now}) {
 const selection=normalizeWorkspaceModelBudget(input),scope=scopeHash(selection);let stopped=false;
 if(!store?.read||!store?.update||typeof clock!=='function'||!localDeepseekConfigured(configuration)
  ||!exact(configuration.cost,Object.keys(DEEPSEEK_PRICES.ompUsdPerMillion))||Object.entries(DEEPSEEK_PRICES.ompUsdPerMillion).some(([key,value])=>configuration.cost[key]!==value))fail('MODEL_BUDGET_RECEIVER_CHANGED');
 const stateRows=state=>{
  validateWorkspaceModelBudgetState(state);
  const rows=(state.runs||[]).filter(run=>run.modelBudgetReceipt?.selection.budgetId===selection.budgetId);
  if(rows.some(run=>run.modelBudgetReceipt.scopeHash!==scope))fail('MODEL_BUDGET_POLICY_CHANGED');
  return rows;
 };
 const active=(state,runId)=>{
  if(clock()>=Date.parse(selection.expiresAt))fail('MODEL_BUDGET_EXPIRED');
  const run=state.runs.find(r=>r.id===runId),conversation=state.conversations.find(c=>c.id===run?.conversationId);
  if(!run||run.status!=='running'||conversation?.activeRunId!==runId
   ||run.businessAgentContext?.workspaceId!==selection.workspaceId||run.businessAgentContext?.subject!==selection.subject)fail('MODEL_BUDGET_RUN_CHANGED');
  return run;
 };
 const available=(rows)=>{
  if(rows.some(run=>run.modelBudgetReceipt.phase==='uncertain'||run.modelBudgetReceipt.phase==='reserved'&&run.status!=='running'))fail('MODEL_BUDGET_UNCONFIRMED');
 };
 return Object.freeze({
  stop(){stopped=true;},
  async begin(runId,assertCurrent=()=>{}) {
   if(stopped)fail('MODEL_BUDGET_STOPPED');
   await store.update(state=>{
    assertCurrent();const run=active(state,runId),rows=stateRows(state);available(rows);
    if(run.modelBudgetReceipt)fail('MODEL_BUDGET_RUN_ALREADY_RESERVED');
    const charged=rows.reduce((sum,r)=>sum+r.modelBudgetReceipt.chargedMicros,units(selection.historicalUpperCny));
    if(charged+reserveUnits>units(selection.limitCny,Math.floor))fail('MODEL_BUDGET_EXHAUSTED');
    run.modelBudgetReceipt={version:1,scopeHash:scope,selection,phase:'reserved',reservedMicros:reserveUnits,chargedMicros:reserveUnits,dispatchedCalls:0,report:null};
   });
  },
  assertCurrent(runId) {
   if(stopped)fail('MODEL_BUDGET_STOPPED');const state=store.read(),run=active(state,runId),rows=stateRows(state);available(rows);
   if(run.modelBudgetReceipt?.scopeHash!==scope||run.modelBudgetReceipt.phase!=='reserved')fail('MODEL_BUDGET_RESERVATION_REQUIRED');
   return true;
  },
  async finish(runId,{report,modelCalls,successful}) {
   if(typeof successful!=='boolean')fail();
   let validated=null;try{validated=validateLocalDeepseekReport(report,{modelCalls,requireConfirmed:successful});}catch{}
   const confirmed=Boolean(validated&&!validated.billingUncertain&&validated.chargeUpperCny!==null);
   await store.update(state=>{
    stateRows(state);const run=state.runs.find(r=>r.id===runId),row=run?.modelBudgetReceipt;
    if(row?.scopeHash!==scope||row.phase!=='reserved')fail('MODEL_BUDGET_SETTLEMENT_CHANGED');
    row.phase=confirmed?'confirmed':'uncertain';row.chargedMicros=confirmed?units(validated.chargeUpperCny):reserveUnits;
    row.dispatchedCalls=Number.isSafeInteger(modelCalls)&&modelCalls>=0&&modelCalls<=LOCAL_DEEPSEEK_LIMITS.maxRequests?modelCalls:0;
    row.report=confirmed?validated:null;
   });
   return {phase:'provider-accounting',runId,status:confirmed?'confirmed':'unconfirmed',report:confirmed?validated:null,reservedUpperCny:confirmed?validated.chargeUpperCny:LOCAL_DEEPSEEK_LIMITS.maxTaskReserveCny};
  },
 });
}
