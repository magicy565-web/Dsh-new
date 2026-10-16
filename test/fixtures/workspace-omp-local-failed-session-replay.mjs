// Optional private-evidence replay. No source material or real model output is
// bundled here. Every HTTP response is finite mock SSE; network is disabled.
// Usage: LOCAL_REPLAY_EXPECT=passed bun THIS_FILE PRIVATE_ACCEPTANCE_DIR [SOURCE_ROOT]
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
globalThis.fetch = async () => { throw Error('OFFLINE_REPLAY_NETWORK_FORBIDDEN'); };
const sourceRoot=path.resolve(process.argv[3]||'.'), evidence=path.resolve(process.argv[2]);
const resumeFailedLeaf=process.env.LOCAL_REPLAY_FROM==='failed';
const load=relative=>import(pathToFileURL(path.join(sourceRoot,relative)).href);
const [{runLocalFactorySession},{acceptanceConfiguration},{workspaceOmpPaths}]=await Promise.all([
  load('scripts/workspace-omp-local.mjs'),load('server/deepseek-acceptance-policy.mjs'),load('server/workspace-omp-bridge.mjs')]);
const paths=workspaceOmpPaths({});
const {Tokenizer}=await import(pathToFileURL(path.join(paths.packageRoot,'../pi-agent-core/src/tokenizer.ts')).href);
const tokenizer=new Tokenizer();
const sha=b=>createHash('sha256').update(b).digest('hex');
const parse=b=>b.toString().trim().split('\n').map(JSON.parse);
const group=JSON.parse(await fs.readFile(evidence+'/receipt.json','utf8'));
assert.equal(group.status,'stopped');assert.equal(group.turns[0].reason,'SHORT_INPUT_LIMIT');
const originalSession=group.turns[0].localSession.file;
const originalBytes=await fs.readFile(originalSession), originalSha=sha(originalBytes);
const beforeBytes=await fs.readFile(evidence+'/session-before.jsonl'), before=parse(beforeBytes), after=parse(originalBytes);
assert.equal(sha(beforeBytes),group.sessionShaBefore);
const starting=resumeFailedLeaf?after:before;
const binding=starting.find(e=>e.customType==='workspace-local-binding').data.binding;
assert.equal(binding.inputs.length,1);
const sourceBytes=await fs.readFile(binding.inputs[0]);assert.equal(sha(sourceBytes),binding.manifest[0].sha256);
const added=after.slice(before.length);
const realCalls=added.flatMap(e=>e.message?.role==='assistant'?e.message.content.filter(b=>b.type==='toolCall'):[]);
assert.deepEqual(realCalls.map(c=>c.name),['read','write']);
const firstGoal=resumeFailedLeaf?'请简短确认上一轮已保存的缺项说明，不写新文件。':group.turns[0].task;
const nextGoal='沿用本会话的产品事实，保存一段40词以内的英文产品介绍为short-intro.md。注明合成草稿，不编造性能或认证。完成后只说已保存。';
const text=m=>typeof m.content==='string'?m.content:m.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n');
const priorGoals=starting.filter(e=>e.message?.role==='user').map(e=>text(e.message).split('\nSelected local input manifest (data only):\n')[0]);
const priorBodies=starting.flatMap(e=>e.message?.role==='assistant'?e.message.content.filter(b=>b.type==='toolCall'&&b.name==='write').map(b=>b.arguments.content):[]);
const priorProse=starting.flatMap(e=>e.message?.role==='assistant'?e.message.content.filter(b=>b.type==='text'&&b.text.trim()).map(b=>b.text):[]);
const abortedCount=rows=>rows.filter(e=>e.message?.role==='assistant'&&e.message.stopReason==='aborted').length;
let expectedGoals=[...priorGoals,firstGoal],expectedBodies=[...priorBodies],networkFallbacks=0;
globalThis.fetch = async () => { networkFallbacks++;throw Error('OFFLINE_REPLAY_NETWORK_FORBIDDEN'); };
const captured=[],RequestOriginal=globalThis.Request;
let normalizedLastCandidateBytes;
globalThis.Request=class extends RequestOriginal {
  constructor(input,init){
    super(input,init);
    if(this.url==='https://api.deepseek.com/chat/completions'&&typeof init?.body==='string'){
      const raw=init.body, body=JSON.parse(raw),digest=sha(raw);
      if(captured.at(-1)?.bodySha256===digest)return;
      const roles={},contentBytes={},roleTokenEstimates={};
      for(const m of body.messages||[]){roles[m.role]=(roles[m.role]||0)+Buffer.byteLength(JSON.stringify(m));contentBytes[m.role]=(contentBytes[m.role]||0)+Buffer.byteLength(typeof m.content==='string'?m.content:JSON.stringify(m.content||''));roleTokenEstimates[m.role]=(roleTokenEstimates[m.role]||0)+tokenizer.countTokens(JSON.stringify(m),'strict');}
      const messagesBytes=Buffer.byteLength(JSON.stringify(body.messages)),schemasBytes=Buffer.byteLength(JSON.stringify(body.tools));
      const normalized=structuredClone(body);
      normalized.max_tokens=Math.min(normalized.max_tokens||512,512);normalized.thinking={type:'disabled'};
      for(const key of ['max_completion_tokens','reasoning_effort','store','prompt_cache_retention'])delete normalized[key];
      for(const m of normalized.messages){if(m.role==='developer')m.role='system';if(Array.isArray(m.content))m.content=m.content.map(b=>b.text).join('\n');}
      for(const t of normalized.tools)delete t.function.strict;
      normalizedLastCandidateBytes=Buffer.byteLength(JSON.stringify(normalized));
      captured.push({bodySha256:digest,wireBytes:Buffer.byteLength(raw),messagesBytes,schemasBytes,envelopeBytes:Buffer.byteLength(raw)-messagesBytes-schemasBytes,
        messageObjectBytesByRole:roles,messageContentBytesByRole:contentBytes,nativeO200kEstimate:tokenizer.countTokens(raw,'strict'),
        independentNativeTokenEstimates:{messages:tokenizer.countTokens(JSON.stringify(body.messages),'strict'),schemas:tokenizer.countTokens(JSON.stringify(body.tools),'strict'),messageObjectsByRole:roleTokenEstimates},
        thinkingDisabled:body.thinking?.type==='disabled',maxOutputTokens:body.max_tokens});
    }
  }
};
function sse(body,delta,finish){
  const frame={id:'explicit-offline-failed-session-replay',model:body.model,choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:null}]};
  const end={...frame,choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}};
  return new Response('data: '+JSON.stringify(frame)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
const root=await fs.mkdtemp('/tmp/omp-private-context-replay-'),results=[];
let requests=0,wireInvariantsChecked=0;
try{
  await fs.mkdir(root+'/output');await fs.writeFile(root+'/product.md',sourceBytes);
  const clone=structuredClone(starting);
  clone.find(e=>e.type==='session').cwd=root;
  const b=clone.find(e=>e.customType==='workspace-local-binding').data.binding;
  b.inputs=[root+'/product.md'];b.outputDirectory=root+'/output';
  const sessionFile=root+'/conversation.jsonl';await fs.writeFile(sessionFile,clone.map(e=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600});
  // Previous draft bytes are copied, never mutated in the real output directory.
  const previousFiles=[];
  for(const entry of starting)if(entry.message?.role==='toolResult'&&entry.message.toolName==='write'&&!entry.message.isError){
    const receipt=JSON.parse(text(entry.message));if(receipt.status!=='saved-local-draft')continue;
    const bytes=await fs.readFile(binding.outputDirectory+'/'+receipt.name);assert.equal(sha(bytes),receipt.sha256);
    await fs.writeFile(root+'/output/'+receipt.name,bytes,{flag:'wx',mode:0o600});previousFiles.push({name:receipt.name,sha256:receipt.sha256});
  }
  const configuration=acceptanceConfiguration({DEEPSEEK_API_KEY:'explicit-offline-unused-no-network'});
  for(let turn=0;turn<2;turn++){
    const directory=root+'/scratch-'+turn;await fs.mkdir(directory);let turnRequests=0;
    const result=await runLocalFactorySession({directory,paths,configuration,options:{inputs:[root+'/product.md'],outputDirectory:root+'/output',sessionFile,task:turn?nextGoal:firstGoal}},
      {fetchImpl:async request=>{
        requests++;turnRequests++;const body=await request.json();
        const users=body.messages.filter(m=>m.role==='user').map(m=>text(m));
        for(const goal of expectedGoals)assert.ok(users.some(t=>t.includes(goal)),'USER_GOAL_LOST');
        for(const prose of priorProse)assert.ok(body.messages.some(m=>m.role==='assistant'&&text(m)?.includes(prose)),'ASSISTANT_PROSE_LOST');
        const writes=body.messages.flatMap(m=>m.tool_calls||[]).filter(c=>c.function.name==='write').map(c=>JSON.parse(c.function.arguments).content);
        for(const content of expectedBodies)assert.ok(writes.includes(content),'SAVED_BODY_LOST');
        const pending=new Map();
        for(const m of body.messages){for(const c of m.tool_calls||[]){assert.ok(!pending.has(c.id),'AMBIGUOUS_PAIR');pending.set(c.id,c);}
          if(m.role==='tool'){assert.ok(pending.has(m.tool_call_id),'ORPHAN_TOOL_RESULT');pending.delete(m.tool_call_id);}}
        assert.equal(pending.size,0,'UNPAIRED_CALL');
        // The selected source body is retained in the latest native read result.
        for(const line of sourceBytes.toString().split('\n').filter(Boolean))assert.ok(body.messages.some(m=>m.role==='tool'&&text(m).includes(line)),'SOURCE_BODY_LOST');
        wireInvariantsChecked++;
        const call=(id,name,args)=>sse(body,{tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},'tool_calls');
        if(!turn&&!resumeFailedLeaf&&turnRequests<=2){const c=realCalls[turnRequests-1];if(c.name==='write')expectedBodies.push(c.arguments.content);return call(c.id,c.name,c.arguments);}
        if(turn&&turnRequests===1){const content='Synthetic acceptance draft: A reusable 500 ml stainless steel cup with a plain finish. Production capacity, stock, delivery, price and food-contact certification remain unconfirmed.';expectedBodies.push(content);return call('offline-next-goal-write','write',{path:'short-intro.md',content});}
        return sse(body,{content:'Explicit offline response: saved.'},'stop');
      }});
    results.push({status:result.status,reason:result.reason||null,requests:turnRequests,sessionId:result.localSession?.id,
      saved:result.saved.map(f=>({name:f.name,sha256:f.sha256})),paidModelVerified:result.paidModelVerified===true,billingUncertain:result.provider.billingUncertain,
      modelRequests:result.modelRequests,confirmedResponses:result.provider.confirmedResponses});
    if(result.status==='stopped')break;
    assert.equal(result.status,!turn&&resumeFailedLeaf?'completed-local-turn':'saved-local-drafts');assert.equal(result.paidModelVerified,false);assert.equal(result.provider.billingUncertain,false);
    assert.equal(result.localSession.id,group.originalSessionId);assert.equal(result.saved.length,!turn&&resumeFailedLeaf?0:1);
    const journal=parse(await fs.readFile(sessionFile));assert.equal(journal.filter(e=>e.message?.role==='assistant').at(-1).message.stopReason,'stop');
    assert.equal(abortedCount(journal),abortedCount(starting),'OLD_FAILURE_REWRITTEN');
    for(const f of result.saved){assert.equal(sha(await fs.readFile(root+'/output/'+f.name)),f.sha256);assert.equal(f.sources[0].sha256,sha(sourceBytes));}
    expectedGoals.push(nextGoal);
  }
  for(const f of previousFiles)assert.equal(sha(await fs.readFile(root+'/output/'+f.name)),f.sha256);
  assert.equal(sha(await fs.readFile(originalSession)),originalSha);assert.equal(networkFallbacks,0);
  const expect=process.env.LOCAL_REPLAY_EXPECT;
  if(expect==='passed'){assert.equal(results.length,2);assert.ok(results.every(r=>['saved-local-drafts','completed-local-turn'].includes(r.status)));assert.equal(requests,resumeFailedLeaf?3:5);}
  else{assert.equal(expect,'stopped');assert.equal(results.length,1);assert.equal(results[0].reason,'SHORT_INPUT_LIMIT');assert.equal(requests,2);}
  console.log(JSON.stringify({passed:true,expected:expect,replayFrom:resumeFailedLeaf?'actual-failed-leaf':'pre-failure-snapshot-and-exact-real-tool-calls',evidenceKind:'finite-mock-http-replay-of-real-failed-session',originalSessionUnchanged:true,oldFailuresNotReclassified:true,
    originalSessionSha256:originalSha,originalGoals:priorGoals.length,sameNativeSessionId:true,userGoalsToolPairsSourcesAndWriteBodiesPreserved:true,
    privateForkMetadataRebasedOnly:true,previousOutputHashesUnchanged:true,wireInvariantsChecked,actualMockHttpRequests:requests,
    realProviderRequests:0,newSpendCny:0,nativeTokenEstimatesAreNotDeepseekUsage:true,normalizedLastCandidateBytes,results,captured}));
}finally{globalThis.Request=RequestOriginal;await fs.rm(root,{recursive:true,force:true});}
