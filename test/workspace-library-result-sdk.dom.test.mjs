// Production web bundle, original signed Host/Library/Artifact and official
// Bun/OMP Session. Only model SSE and loopback Docling are finite fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startupFixture,STATEMENT,LIBRARY_PRODUCT} from './fixtures/native-document-startup.mjs';
import {bundleRenderer,wait,input,click,json} from './fixtures/conversation-ui.mjs';

test('signed Library import, authorized SDK read, explicit result save and next-message same-Session continuation',{timeout:180000},async t=>{
 const f=await startupFixture(t,{mode:'library-flow'});
 assert.equal(f.app.store.read().businessLibrary.products.length,1);
 assert.equal(f.app.store.read().businessLibrary.documents.length,1);
 assert.equal(f.app.store.read().runs.length,0);
 const renderer=await bundleRenderer(t,async(path,options={})=>{
  assert.ok(!options.method||['GET','POST'].includes(options.method),'Use the existing bounded UI flow');
  const response=await f.workspace(path,{...(options.body===undefined?{}:{body:JSON.parse(options.body)})});
  return json(response.json,response.status);
 });
 const ui=await renderer.render('/chat/'+f.cid);
 const byLabel=label=>ui.document.querySelector('[aria-label="'+label+'"]');
 async function send(text,expectedRuns){
  const composer=byLabel('输入消息');await wait(()=>composer&&!composer.disabled,'ordinary conversation input');
  await input(ui,composer,text);await wait(()=>byLabel('发送消息')&&!byLabel('发送消息').disabled,'send enabled');
  await click(ui,byLabel('发送消息'));
  const deadline=Date.now()+65000;
  while(Date.now()<deadline){const runs=f.app.store.read().runs;if(runs.length===expectedRuns&&!['queued','running'].includes(runs.at(-1).status))return runs.at(-1);await new Promise(resolve=>setTimeout(resolve,25));}
  throw Error('The original UI/SDK Run did not settle');
 }
 const first=await send('Read only my selected reviewed product and document. Summarize their facts without external actions.',1);
 assert.equal(first.status,'succeeded',JSON.stringify({status:first.status,error:first.error,session:await f.sessionDiagnostics(),provider:await f.readProvider().catch(()=>({observed:false}))}));
 const mapping=structuredClone(f.mapping()),firstProvider=await f.readProvider();
 assert.equal(firstProvider.requests.length,4);assert.equal(firstProvider.externalModelRequests,0);assert.equal(f.parserCalls(),1);
 assert.equal(firstProvider.requests[0].withSource,false);assert.equal(firstProvider.requests[0].withProduct,false);
 assert.equal(firstProvider.requests.at(-1).withSource,true);assert.equal(firstProvider.requests.at(-1).withProduct,true);
 const message=f.app.store.read().messages.find(m=>m.runId===first.id&&m.role==='assistant'&&m.status==='complete');assert.ok(message);
 for(const value of [LIBRARY_PRODUCT.name,LIBRARY_PRODUCT.description,STATEMENT])assert.ok(message.content.includes(value));
 assert.ok(!message.content.includes(LIBRARY_PRODUCT.category));
 await wait(()=>byLabel('保存回复到资料库')&&!byLabel('保存回复到资料库').disabled,'generated reply can be explicitly saved');
 await click(ui,byLabel('保存回复到资料库'));
 await wait(()=>f.app.store.read().artifacts.some(a=>a.sourceRunId===first.id),'original Artifact committed');
 const artifact=f.app.store.read().artifacts.find(a=>a.sourceRunId===first.id);
 assert.equal(artifact.sourceConversationId,f.cid);assert.equal(artifact.filename,'Workspace-'+message.id+'.md');
 const saved=await f.workspace('/api/artifacts/'+artifact.id+'/download?version=1&sha256='+artifact.sha256);
 assert.equal(saved.status,200);assert.equal(saved.text,message.content);assert.equal(createHash('sha256').update(saved.text).digest('hex'),artifact.sha256);
 const posts=renderer.requests.filter(r=>r.path==='/api/artifacts'&&r.method==='POST');assert.equal(posts.length,1);
 assert.equal(posts[0].body.content,message.content);assert.equal(posts[0].body.sourceRunId,first.id);
 await f.writeFixture(2);
 const second=await send('Continue the same conversation using the selected sources. What remains uncertain?',2);
 assert.equal(second.status,'succeeded',JSON.stringify({status:second.status,error:second.error,session:await f.sessionDiagnostics()}));
 assert.deepEqual(f.mapping(),mapping);assert.equal(f.parserCalls(),1);assert.equal((await f.readProvider()).requests.length,1);assert.equal((await f.readProvider()).externalModelRequests,0);
 assert.ok(f.app.store.read().messages.find(m=>m.runId===second.id&&m.role==='assistant'&&m.status==='complete')?.content.includes('Same-session continuation:'));
 const denied=await f.workspace('/api/conversations/'+f.cid+'/messages',{subject:'member-b'});assert.equal(denied.status,404);
 assert.ok(f.app.store.read().runs.every(r=>r.conversationId===f.cid&&!(r.executionRefs||[]).length));
 assert.equal(f.app.store.read().businessLibrary.enterpriseMemories.length,0,'No new memory write permission or mandatory remember sequence');
 assert.deepEqual(ui.errors,[]);
});
