// Actual original startup/HTTP/SDK, finite synthetic SSE/Docling only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {startupFixture,sendStartup,STATEMENT} from './fixtures/native-document-startup.mjs';
const options={timeout:180000};
const diagnostic=async(f,run)=>JSON.stringify({status:run.status,error:run.error,events:run.events.map(e=>e.type),session:await f.sessionDiagnostics(),provider:await f.readProvider().catch(()=>({observed:false}))});
test('trusted startup durable budget supports three original same-Session Runs and HTTP-created Goal',options,async t=>{
 const f=await startupFixture(t,{durableBudget:true});assert.equal(f.app.store.read().businessLibrary.enterpriseMemories.length,0);
 const first=await sendStartup(f);assert.equal(first.status,'succeeded',await diagnostic(f,first));const mapping=structuredClone(f.mapping());
 await f.writeFixture(2);const second=await sendStartup(f,'Continue with the saved Context and revise the Decision without execution.');assert.equal(second.status,'succeeded',await diagnostic(f,second));assert.deepEqual(f.mapping(),mapping);
 await f.writeFixture(3);const third=await sendStartup(f,'Continue a third time using the same saved Context.');assert.equal(third.status,'succeeded',await diagnostic(f,third));assert.deepEqual(f.mapping(),mapping);
 const runs=f.app.store.read().runs;assert.equal(runs.length,3);assert.deepEqual(runs.map(r=>r.modelBudgetReceipt.dispatchedCalls),[7,3,2]);assert.ok(runs.every(r=>r.modelBudgetReceipt.phase==='confirmed'&&r.modelBudgetReceipt.selection.budgetId==='synthetic-continuous'));
 assert.equal(runs.reduce((sum,r)=>sum+r.modelBudgetReceipt.chargedMicros,0),4320);assert.equal(f.parserCalls(),1);assert.equal((await f.readProvider()).externalModelRequests,0);
 const context=await f.workspace('/api/conversations/'+f.cid+'/brain/context');assert.equal(context.status,200,context.text);assert.equal(context.json.data.sources[0].values.statement,STATEMENT);
 const decision=await f.workspace('/api/conversations/'+f.cid+'/brain/decisions/synthetic-case');assert.equal(decision.status,200,decision.text);assert.equal(decision.json.data.decision.payload.goalId,f.goal.id);assert.equal(decision.json.executable,false);assert.equal(f.app.store.read().goals[0].status,'draft');assert.ok(runs.every(r=>(r.executionRefs||[]).length===0));
});
test('unknown provider usage durably retains full allowance and blocks a later original Run before send',options,async t=>{
 const f=await startupFixture(t,{durableBudget:true,mode:'unknown'}),first=await sendStartup(f);assert.equal(first.status,'failed',await diagnostic(f,first));
 const row=f.app.store.read().runs[0].modelBudgetReceipt;assert.equal(row.phase,'uncertain');assert.equal(row.chargedMicros,2700000);assert.equal(row.report,null);assert.equal((await f.readProvider()).requests.length,1);
 const second=await sendStartup(f,'Please continue without retrying unknown charges.');assert.equal(second.status,'failed',await diagnostic(f,second));assert.equal(second.error.code,'MODEL_BUDGET_UNCONFIRMED');assert.equal(second.events.filter(e=>e.type==='pi.agent-session.request').length,0);assert.equal(f.app.store.read().runs[1].modelBudgetReceipt,undefined);assert.equal((await f.readProvider()).requests.length,1);assert.equal((await f.readProvider()).externalModelRequests,0);assert.equal(f.app.store.read().messages.filter(m=>m.role==='assistant'&&m.status==='complete').length,0);
});
