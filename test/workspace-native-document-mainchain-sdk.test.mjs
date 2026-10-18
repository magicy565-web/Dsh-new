import test from 'node:test';
import assert from 'node:assert/strict';
import {startupFixture,sendStartup,QUERY,STATEMENT} from './fixtures/native-document-startup.mjs';
const options={timeout:180000};
const calls=run=>run.events.filter(e=>e.type==='pi.agent-session.request').length;
const successful=f=>f.app.store.read().messages.filter(m=>m.role==='assistant'&&m.status==='complete');
// Preserve only the finite fixture's whitelisted shape summary on assertion
// failure; original production errors remain sanitized and unchanged.
const diagnostic=async(f,run)=>JSON.stringify({run,provider:await f.readProvider().catch(error=>{if(error.code==='ENOENT')return {observed:false};throw error;})});

test('original startup upload -> SDK document read/remember -> Brain -> same-session continuation and page GET',options,async t=>{
 const f=await startupFixture(t),goals=structuredClone(f.app.store.read().goals);
 assert.equal(f.app.store.read().businessLibrary.enterpriseMemories.length,0,'No preseeded facts');
 const first=await sendStartup(f);assert.equal(first.status,'succeeded',await diagnostic(f,first));assert.equal(calls(first),7);assert.equal(f.parserCalls(),1);
 const provider=await f.readProvider();assert.ok(provider.requests.length>0);
 for(const request of provider.requests){assert.equal(request.toolNames.length,12);assert.ok(request.toolNames.every(name=>name==='workspace_skill'||name.startsWith('workspace_brain_')||name.startsWith('workspace_enterprise_context_')));}
 const memory=f.app.store.read().businessLibrary.enterpriseMemories.find(m=>m.status==='active');assert.ok(memory);
 assert.equal(memory.statement,STATEMENT);assert.equal(memory.factKey,QUERY.factKey);assert.equal(memory.source.kind,'conversation');assert.equal(memory.source.ref,f.cid);assert.equal(memory.source.runId,first.id);
 assert.equal(memory.source.dependencies.length,1);assert.equal(memory.source.dependencies[0].ref,f.document.id);assert.equal(memory.source.dependencies[0].sha256,f.asset.sha256);
 const journal=await f.messages();assert.ok(journal.some(m=>m.toolName==='workspace_skill'&&!m.isError));const remembered=journal.find(m=>m.toolName==='workspace_enterprise_context_structured_memory_remember');assert.ok(remembered&&!remembered.isError);assert.equal(remembered.details.memory.id,memory.id);
 const saved=structuredClone(f.mapping());assert.equal(saved.brainDocumentTools,true);assert.ok(saved.brainMemoryFactsScopeHash);
 const brief=await f.workspace('/api/conversations/'+f.cid+'/brain/brief');assert.equal(brief.status,200,brief.text);assert.ok(brief.json.data.cards.some(c=>c.action.goalId===f.goal.id&&c.decisionDraft?.status==='persisted'));
 const context=await f.workspace('/api/conversations/'+f.cid+'/brain/context');assert.equal(context.status,200,context.text);assert.equal(context.json.data.sources[0].values.statement,STATEMENT);
 const forbidden=await f.workspace('/api/conversations/'+f.cid+'/brain/brief',{subject:'member-b'});assert.equal(forbidden.status,404,forbidden.text);assert.ok(!forbidden.text.includes(STATEMENT));
 await f.writeFixture(2);const second=await sendStartup(f,'Continue the same investigation using the saved fact and same Context. Update the Decision, without starting an action.');
 assert.equal(second.status,'succeeded',await diagnostic(f,second));assert.equal(calls(second),3);assert.deepEqual(f.mapping(),saved);assert.equal(f.parserCalls(),1);
 const decision=await f.workspace('/api/conversations/'+f.cid+'/brain/decisions/synthetic-case');assert.equal(decision.status,200,decision.text);assert.equal(decision.json.data.decision.revision,2);assert.equal(decision.json.data.decision.payload.contextRevision,1);assert.equal(decision.json.data.decision.payload.goalId,f.goal.id);assert.equal(decision.json.humanReviewed,false);assert.equal(decision.json.executable,false);
 assert.deepEqual(f.app.store.read().goals,goals);assert.deepEqual(first.executionRefs||[],[]);assert.deepEqual(second.executionRefs||[],[]);assert.equal((await f.readProvider()).externalModelRequests,0);assert.equal(successful(f).length,2);
 const beforeRuns=f.app.store.read().runs.length,revoke=await f.workspace('/api/library/memory/'+memory.id+'/revoke',{body:{reason:'Synthetic normal revocation'}});assert.equal(revoke.status,200,revoke.text);
 const refused=await f.workspace('/api/conversations/'+f.cid+'/brain/context');assert.ok([403,409].includes(refused.status),refused.text);assert.ok(!refused.text.includes(STATEMENT));assert.equal(f.app.store.read().runs.length,beforeRuns);
});

test('initial reviewed document capability retains original eight-call limit and refuses ninth provider send',options,async t=>{
 const f=await startupFixture(t,{mode:'limit'}),run=await sendStartup(f);assert.equal(run.status,'failed',JSON.stringify(run));
 const report=await f.readProvider();assert.equal(report.requests.length,8,JSON.stringify(report));assert.equal(report.externalModelRequests,0);assert.equal(calls(run),8);assert.equal(f.parserCalls(),0);assert.equal(f.app.store.read().businessLibrary.enterpriseMemories.length,0);assert.equal(successful(f).length,0);
});

test('ordinary startup without document capability keeps four-call default and no document tools',options,async t=>{
 const f=await startupFixture(t,{documents:false,mode:'limit'}),run=await sendStartup(f);assert.equal(run.status,'failed',JSON.stringify(run));
 const report=await f.readProvider();assert.equal(report.requests.length,4);assert.equal(report.externalModelRequests,0);assert.equal(calls(run),4);assert.ok(report.requests.every(r=>r.toolNames.every(n=>!n.startsWith('workspace_enterprise_context_'))));assert.equal(f.parserCalls(),0);assert.equal(successful(f).length,0);
});

for(const mode of ['clarify','lookup'])test('model may choose '+mode+' without parsing, writing or a mandatory Brain sequence',options,async t=>{
 const f=await startupFixture(t,{mode}),goals=structuredClone(f.app.store.read().goals),run=await sendStartup(f,'Help me decide what information is needed. Ask if unclear; do not assume a mandatory tool sequence.');
 assert.equal(run.status,'succeeded',await diagnostic(f,run));assert.equal(calls(run),mode==='clarify'?1:2);
 assert.equal(f.parserCalls(),0);assert.equal(f.app.store.read().businessLibrary.enterpriseMemories.length,0);
 assert.deepEqual(f.app.store.read().goals,goals);assert.equal((await f.readProvider()).externalModelRequests,0);
 const journal=await f.messages();assert.equal(journal.some(m=>m.toolName?.endsWith('memory_remember')||m.toolName?.endsWith('parse_upload')||m.toolName?.endsWith('_save')),false);
 if(mode==='clarify')assert.equal(journal.some(m=>m.role==='toolResult'),false);
});
