// Production chat bundle and actual save button; JSDOM is not real-browser
// layout evidence. Original default startup/SDK, finite services only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {startupFixture,STATEMENT} from './fixtures/native-document-startup.mjs';
import {bundleRenderer,wait,input,click,json} from './fixtures/conversation-ui.mjs';
test('native product/document reply saves with production chat button and continues the same original Session',{timeout:180000},async t=>{
  const f=await startupFixture(t,{mode:'native-medusa',nativeMedusa:true});
  const renderer=await bundleRenderer(t,async(path,options={})=>{
    assert.ok(!options.method||['GET','POST'].includes(options.method));
    const response=await f.workspace(path,{...(options.body===undefined?{}:{body:JSON.parse(options.body)})});return json(response.json,response.status);
  });
  const ui=await renderer.render('/chat/'+f.cid),byLabel=label=>ui.document.querySelector('[aria-label="'+label+'"]');
  async function send(text,expected){
    const composer=byLabel('输入消息');await wait(()=>composer&&!composer.disabled,'original input ready');await input(ui,composer,text);
    await wait(()=>byLabel('发送消息')&&!byLabel('发送消息').disabled,'original send ready');await click(ui,byLabel('发送消息'));
    for(let i=0;i<2600;i++){const runs=f.app.store.read().runs;if(runs.length===expected&&!['queued','running'].includes(runs.at(-1).status))return runs.at(-1);await new Promise(resolve=>setTimeout(resolve,25));}
    throw Error('Native chat Run did not settle');
  }
  const first=await send('Read the independently authorized native Medusa product and document.',1);assert.equal(first.status,'succeeded',JSON.stringify(first.error));
  const mapping=structuredClone(f.mapping()),message=f.app.store.read().messages.find(m=>m.runId===first.id&&m.role==='assistant'&&m.status==='complete');assert.ok(message);
  for(const value of [f.nativeState.title,f.nativeState.description,f.nativeState.summary,STATEMENT])assert.ok(message.content.includes(value));
  await wait(()=>byLabel('保存回复到资料库')&&!byLabel('保存回复到资料库').disabled,'native reply save button');await click(ui,byLabel('保存回复到资料库'));
  await wait(()=>f.app.store.read().artifacts.some(a=>a.sourceRunId===first.id),'native result committed');
  const artifact=f.app.store.read().artifacts.find(a=>a.sourceRunId===first.id),posts=renderer.requests.filter(r=>r.path==='/api/artifacts'&&r.method==='POST');
  assert.equal(posts.length,1);assert.equal(posts[0].body.content,message.content);assert.equal(posts[0].body.sourceRunId,first.id);assert.equal(artifact.sourceConversationId,f.cid);
  const saved=await f.workspace('/api/artifacts/'+artifact.id+'/download?version=1&sha256='+artifact.sha256);
  assert.equal(saved.status,200);assert.equal(saved.text,message.content);assert.equal(createHash('sha256').update(saved.text).digest('hex'),artifact.sha256);
  await f.writeFixture(2);const second=await send('Continue the same conversation and explain the remaining uncertainty.',2);assert.equal(second.status,'succeeded',JSON.stringify(second.error));
  assert.deepEqual(f.mapping(),mapping);assert.equal((await f.readProvider()).requests.length,1);assert.equal(f.parserCalls(),1);assert.equal((await f.readProvider()).externalModelRequests,0);
  assert.deepEqual(ui.errors,[]);assert.equal(f.app.store.read().businessLibrary.products.length,0);
});
