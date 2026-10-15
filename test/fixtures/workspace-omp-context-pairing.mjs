// Original native context/pruner, two selected inputs, colliding provider IDs.
// No model or HTTP transport is installed in this fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { createLocalContextExtension } from '../../server/workspace-omp-local-context.mjs';
import { workspaceOmpPaths } from '../../server/workspace-omp-bridge.mjs';
import {pairLocalToolHistory} from '../../server/workspace-omp-local-pairs.mjs';
import {runLocalFactorySession} from '../../scripts/workspace-omp-local.mjs';
import {acceptanceConfiguration} from '../../server/deepseek-acceptance-policy.mjs';
import {createLocalFactoryFiles} from '../../server/workspace-omp-local-files.mjs';
const manifest = [{ id:'input-1',name:'alpha.md',sha256:'a'.repeat(64) },{ id:'input-2',name:'beta.md',sha256:'b'.repeat(64) }];
const read = (source, id='reused') => [
 { role:'assistant',content:[{type:'toolCall',id,name:'read',arguments:{path:source.id,i:'Synthetic intent'}}],timestamp:1 },
 { role:'toolResult',toolCallId:id,toolName:'read',isError:false,content:[{type:'text',text:source.name+' unique selected facts. '.repeat(50)}],
   details:{privateLibrary:false,sources:[{kind:'user-selected-local-file',recordId:source.id,name:source.name,sha256:source.sha256}]},timestamp:2 },
];
let callback;
const context = await createLocalContextExtension({packageRoot:workspaceOmpPaths({}).packageRoot,files:{manifest},authorize:async()=>{}});
context.extension({on:(_name,handler)=>{callback=handler;}});
const messages=[{role:'user',content:'Read first selected input'},...read(manifest[0]),{role:'user',content:'Now read a different selected input'},...read(manifest[1])];
const result=(await callback({messages})).messages;
assert.equal(result[2].content[0].text,messages[2].content[0].text,'A later different input with the same provider ID must not supersede the first source.');
assert.equal(result[5].content[0].text,messages[5].content[0].text);
const third=[...messages,{role:'user',content:'Read the first input again'},...read(manifest[0])];
const projected=(await callback({messages:third})).messages;
assert.equal(projected[2].content[0].text,'[Superseded by a newer read of this file]');
assert.equal(projected[5].content[0].text,third[5].content[0].text);assert.equal(projected[8].content[0].text,third[8].content[0].text);
for(let i=0;i<third.length;i++)if(third[i].role==='toolResult')assert.equal(projected[i].toolCallId,third[i].toolCallId);
assert.equal(pairLocalToolHistory(third).length,3);
const ambiguous=[{role:'assistant',content:[...read(manifest[0])[0].content,...read(manifest[1])[0].content]},read(manifest[0])[1],read(manifest[1])[1]];
assert.equal(pairLocalToolHistory(ambiguous).length,0);
const ambiguousProjection=(await callback({messages:ambiguous})).messages;
assert.equal(ambiguousProjection[1].content[0].text,ambiguous[1].content[0].text);assert.equal(ambiguousProjection[2].content[0].text,ambiguous[2].content[0].text);

function wire(body,delta,finish){
 const frame={id:'explicit-mock-colliding-ids',model:body.model,choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]};
 const end={...frame,choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}};
 return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
const root=await fs.mkdtemp('/tmp/omp-pairing-cold-'),sha=x=>createHash('sha256').update(x).digest('hex');
let total=0,sessionId,nativeNormalizedIds=false,priorJournalIds=[];
try{
 await fs.mkdir(root+'/out');
 await fs.writeFile(root+'/alpha.md','ALPHA_UNIQUE_FACT_834650\nOnly selected input one contains this fact. Capacity unknown.\n');
 await fs.writeFile(root+'/beta.md','BETA_UNIQUE_FACT_709123\nOnly selected input two contains this fact. Delivery unknown.\n');
 for(let turn=0;turn<3;turn++){
  const directory=root+'/scratch-'+turn;await fs.mkdir(directory);let requests=0;
  const r=await runLocalFactorySession({directory,paths:workspaceOmpPaths({}),configuration:acceptanceConfiguration({DEEPSEEK_API_KEY:'explicit-mock-unused'}),
   options:{inputs:[root+'/alpha.md',root+'/beta.md'],outputDirectory:root+'/out',sessionFile:root+'/conversation.jsonl',
    task:['读取第一个明确选择的来源，等待下一句。','再读第二个来源，结合前轮来源保存both.md，不发送。','重新读取第一个来源，保留第二份来源事实，然后简短确认。'][turn]}},
   {fetchImpl:async request=>{
    requests++;total++;const body=JSON.parse(await request.text()),text=JSON.stringify(body.messages);
    assert.ok(Buffer.byteLength(JSON.stringify(body))<=12000);
    if(turn>0)assert.ok(text.includes('ALPHA_UNIQUE_FACT_834650'),'first unique source remains on the actual provider wire');
    if(turn===2||turn===1&&requests>1)assert.ok(text.includes('BETA_UNIQUE_FACT_709123'),'second unique source remains on the actual provider wire');
    if(turn===2&&requests===2)assert.equal(text.split('ALPHA_UNIQUE_FACT_834650').length-1,1);
    const tool=(name,args)=>wire(body,{tool_calls:[{index:0,id:'reused',type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
    if(requests===1)return tool('read',{path:turn===1?'input-2':'input-1'});
    if(turn===1&&requests===2)return tool('write',{path:'both.md',content:'Synthetic draft from both explicitly selected sources. Missing facts remain pending.'});
    return wire(body,{content:'Selected sources retained; no sending.'},'stop');
   }});
  assert.ok(['completed-local-turn','saved-local-drafts'].includes(r.status),JSON.stringify(r));assert.equal(r.paidModelVerified,false);
  sessionId||=r.localSession.id;assert.equal(r.localSession.id,sessionId);assert.equal(r.provider.actualProviderRequests,requests);
  assert.equal(r.revalidatedPriorSources.length,turn===0?0:turn===1?1:2);
  if(turn===1){assert.equal(r.saved.length,1);assert.equal(r.saved[0].sources.length,2);assert.equal(sha(await fs.readFile(root+'/out/both.md')),r.saved[0].sha256);}
  const current=(await fs.readFile(root+'/conversation.jsonl','utf8')).split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}})
    .filter(e=>e.type==='message'&&e.message.role==='assistant').flatMap(e=>e.message.content.filter(b=>b.type==='toolCall')).map(c=>c.id);
  assert.deepEqual(current.slice(0,priorJournalIds.length),priorJournalIds);priorJournalIds=current;
 }
 const journal=(await fs.readFile(root+'/conversation.jsonl','utf8')).split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
 const calls=journal.filter(e=>e.type==='message'&&e.message.role==='assistant').flatMap(e=>e.message.content.filter(b=>b.type==='toolCall'));
 assert.equal(calls.length,4);assert.ok(calls.filter(c=>c.name==='read').every(c=>c.id==='reused'));
 nativeNormalizedIds=calls.some(c=>c.id!=='reused');assert.equal(total,7);
 // An error consumes its call occurrence. A later success with the same ID
 // but no new call cannot revive source authorization from that old attempt.
 const directory=root+'/stale-result';await fs.mkdir(directory);
 const files=await createLocalFactoryFiles({inputs:[root+'/alpha.md',root+'/beta.md'],outputDirectory:root+'/out',directory});
 try{
  const failed=read(files.manifest[0],'stale');failed[1].isError=true;
  await assert.rejects(files.restoreReadSources([...failed,{role:'user',content:'A different turn'},read(files.manifest[0],'stale')[1]]),/LOCAL_CACHED_SOURCE_REFUSED/);
  assert.deepEqual(files.restoredSources,[]);
 }finally{await files.close();}
}finally{await fs.rm(root,{recursive:true,force:true});}
console.log(JSON.stringify({differentSourceWasPruned:false,validSameSourceSupersession:true,ambiguousBatchProtected:true,
 coldNativeTurns:3,actualMockHttpRequests:total,sameNativeSessionId:true,journalIdsUnchanged:true,nativeSdkNormalizedReusedResponseIds:nativeNormalizedIds,
 coldReadIdsActuallyCollided:true,staleUnpairedSuccessRefused:true,realProviderRequests:0}));
