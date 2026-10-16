// Original OMP SDK + upstream native read/write, finite synthetic model only.
// No HTTP Host, WS URL/token, real data, external sending or paid provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runLocalFactory, parseLocalArguments } from '../scripts/workspace-omp-local.mjs';
import { createLocalFactoryFiles } from '../server/workspace-omp-local-files.mjs';
import { workspaceOmpConfiguration } from '../server/workspace-omp-host.mjs';
import { DEEPSEEK_PRICES } from '../server/deepseek-acceptance-policy.mjs';
import { workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
const sha = text => createHash('sha256').update(text).digest('hex');
const configuration = { providerId: 'explicit-local-finite', model: 'finite', baseUrl: 'https://synthetic.invalid' };
const product = 'Synthetic local product: cup. Specification: 500ml. Capacity and delivery unprovided.\n';
async function fixture(t) {
  const directory=await fs.mkdtemp('/tmp/omp-local-factory-test-');await fs.mkdir(directory+'/out');
  await fs.writeFile(directory+'/product.md',product);
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  return {directory,inputs:[directory+'/product.md'],outputDirectory:directory+'/out',task:'Read selected synthetic material, prepare RFQ and matching gaps, save report.md.'};
}
const names=['read','write','workspace_factory_capabilities','workspace_factory_rfq_requirements','workspace_factory_match_prepare'];
const responses = () => [
  {tool:'read',arguments:{path:'input-1'},expectedToolNames:names,forbiddenContextText:product.trim()},
  {tool:'workspace_factory_rfq_requirements',arguments:{rfq:{product:'Synthetic local cup',quantity:100}},expectedContextText:product.trim()},
  {tool:'workspace_factory_match_prepare',arguments:{rfq:{product:'Synthetic local cup'},factoryOffer:{product:'Synthetic local cup',spec:'500ml',source:'input-1'}},expectedContextText:'requested_delivery'},
  {tool:'write',arguments:{path:'report.md',content:'# Synthetic local factory draft\nProduct: cup, 500ml.\nCapacity, quantity, delivery, customer identity and commercial terms: pending.\nSource: input-1.\n'},expectedContextText:'pendingFactoryFields'},
  {text:'Saved a local synthetic draft; no verified capacity, approval, sending or order.'},
];
test('no-Host original OMP reads selected local product, calls existing local factory tools and saves source-backed draft', {timeout:40000}, async t=>{
  const options=await fixture(t),result=await runLocalFactory({options,configuration,syntheticResponses:responses()});
  assert.equal(result.status,'saved-local-drafts',JSON.stringify(result));assert.equal(result.evidenceKind,'official-omp-finite-synthetic-local-files');
  assert.equal(result.workspaceHostUsed,false);assert.equal(result.wsBindingUsed,false);assert.equal(result.paidModelVerified,false);
  assert.equal(result.modelRequests,5);assert.equal(result.saved.length,1);assert.equal(result.saved[0].sources[0].sha256,sha(product));
  const content=await fs.readFile(options.outputDirectory+'/report.md','utf8');
  assert.match(content,/pending/);assert.match(content,/Source provenance/);assert.ok(content.includes(sha(product)));
  assert.equal(sha(content),result.saved[0].sha256);assert.equal(result.saved[0].humanApproved,false);assert.equal(result.saved[0].sent,false);
  assert.deepEqual(await fs.readdir(options.outputDirectory),['report.md']);
  const again=await runLocalFactory({options,configuration,syntheticResponses:responses()});
  assert.equal(again.status,'stopped');assert.equal(again.saved.length,0);assert.equal(await fs.readFile(options.outputDirectory+'/report.md','utf8'),content);
});
test('local CLI preflight works without any model key, Host or WS credentials and does not invoke a model', {timeout:20000}, async t=>{
  const options=await fixture(t);
  const result=await runLocalFactory({options:{...options,check:true},configuration});
  assert.equal(result.status,'model-unconfigured');assert.equal(result.localFilesReady,true);assert.equal(result.modelRequests,0);
  const refused=await runLocalFactory({options,configuration});assert.equal(refused.status,'stopped');assert.equal(refused.modelRequests,0);
  assert.equal(refused.reason,'LOCAL_MODEL_COST_AND_BUDGET_REQUIRED');assert.deepEqual(await fs.readdir(options.outputDirectory),[]);
  const child=spawn('npm',['run','factory:local','--','--input',options.inputs[0],'--output-dir',options.outputDirectory,'--check'],{
    cwd:path.resolve('.'),env:{PATH:process.env.PATH,HOME:options.directory,TMPDIR:options.directory,NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  assert.equal(await new Promise(resolve=>child.once('close',resolve)),0,output);
  const report=output.split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(v=>v?.localFilesReady);
  assert.equal(report.modelRequests,0);assert.equal(report.status,'model-unconfigured');
  assert.throws(()=>parseLocalArguments(['--input','one.md']),/SELECTION/);
  assert.throws(()=>parseLocalArguments(['--input','one.md','--output-dir','.','--execute-anything']),/UNKNOWN/);
});
test('selection rejects symlinks, unselected inputs, unsupported files and credential-like input text',async t=>{
  const options=await fixture(t);let i=0;
  async function select(overrides={}){const directory=options.directory+'/selection-'+(++i);await fs.mkdir(directory);return createLocalFactoryFiles({...options,...overrides,directory});}
  await fs.symlink(options.inputs[0],options.directory+'/linked.md');await assert.rejects(select({inputs:[options.directory+'/linked.md']}),/SYMLINK/);
  await fs.symlink(options.outputDirectory,options.directory+'/linked-out');await assert.rejects(select({outputDirectory:options.directory+'/linked-out'}),/SYMLINK/);
  await fs.writeFile(options.directory+'/credential.md','api_key=explicit-synthetic-credential-test');await assert.rejects(select({inputs:[options.directory+'/credential.md']}),/CREDENTIAL/);
  await fs.writeFile(options.directory+'/workspace.json','{}');await assert.rejects(select({inputs:[options.directory+'/workspace.json']}),/DATABASE_REFUSED/);
  await fs.symlink(options.directory,options.directory+'/linked-parent');await assert.rejects(select({inputs:[options.directory+'/linked-parent/product.md']}),/SYMLINK/);
  await fs.writeFile(options.directory+'/script.mjs','not selected data');await assert.rejects(select({inputs:[options.directory+'/script.mjs']}),/TYPE_OR_LIMIT/);
  const files=await select();try{await fs.writeFile(options.inputs[0],'Changed synthetic input');await assert.rejects(files.authorize(),/SOURCE_CHANGED/);}finally{await files.close();}
});
test('native local file guards reject traversal, symlink targets, overwrite and output-directory replacement', {timeout:20000},async t=>{
  const options=await fixture(t),paths=workspaceOmpPaths({});
  const child=spawn(paths.bun,[path.resolve('test/fixtures/workspace-omp-local-files.mjs')],{env:{PATH:process.env.PATH,HOME:options.directory,TMPDIR:options.directory,
    OMP_TEST_ROOT:options.directory,OMP_TEST_PACKAGE:paths.packageRoot},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const code=await new Promise(resolve=>child.once('close',resolve));assert.equal(code,0,output);assert.match(output,/NATIVE_LOCAL_FILE_BOUNDARIES_VERIFIED/);
});
test('a forged remote business tool in the local profile cannot create a task or fake a saved result',{timeout:20000},async t=>{
  const options=await fixture(t);const result=await runLocalFactory({options,configuration,syntheticResponses:[
    {tool:'workspace_business_task',arguments:{title:'Not authorized'}},{text:'The remote capability is unavailable.'},
  ]});assert.equal(result.status,'stopped');assert.deepEqual(result.saved,[]);assert.deepEqual(await fs.readdir(options.outputDirectory),[]);
});


test('one original OMP model response with five concurrent write calls saves at most four reports', {timeout:20000}, async t=>{
  const options=await fixture(t);
  const result=await runLocalFactory({options,configuration,syntheticResponses:[
    {tool:'read',arguments:{path:'input-1'},expectedToolNames:names},
    {parallelTools:Array.from({length:5},(_,i)=>({name:'write',arguments:{path:'batch-'+i+'.md',content:'Synthetic same-response draft '+i+'. Capacity pending. Source input-1.'}}))},
    {text:'Four local synthetic drafts saved; the fifth write was refused by the shared quota.',expectedContextText:'LOCAL_OUTPUT_REFUSED'},
  ]});
  assert.equal(result.status,'saved-local-drafts',JSON.stringify(result));assert.equal(result.modelRequests,3);assert.equal(result.saved.length,4);
  const files=await fs.readdir(options.outputDirectory);assert.equal(files.length,4);
  for(const receipt of result.saved){const content=await fs.readFile(options.outputDirectory+'/'+receipt.name);assert.equal(sha(content),receipt.sha256);assert.equal(receipt.sources[0].sha256,sha(product));}
  assert.equal(result.paidModelVerified,false);assert.equal(result.workspaceHostUsed,false);
});


test('DeepSeek local preflight reports provider/model and configuration booleans without contacting the model', {timeout:15000}, async t=>{
  const options={...await fixture(t),check:true};
  const selected={PI_PROVIDER:'deepseek',PI_MODEL:'deepseek-flash'};
  const missing=await runLocalFactory({options,configuration:workspaceOmpConfiguration(selected)});
  assert.equal(missing.status,'model-unconfigured');assert.equal(missing.modelRequests,0);
  assert.deepEqual(missing.modelConfiguration,{provider:'workspace-deepseek',model:'deepseek-flash',apiKeyPresent:false,costPresent:false,remainingBudgetReviewed:false});
  const configured=await runLocalFactory({options,configuration:workspaceOmpConfiguration({...selected,
    DEEPSEEK_API_KEY:'explicit-synthetic-preflight-only',WORKSPACE_OMP_PROVIDER_COST_JSON:JSON.stringify(DEEPSEEK_PRICES.ompUsdPerMillion),WORKSPACE_OMP_LIVE_BUDGET_VERIFIED:'1'})});
  assert.equal(configured.status,'configured-unverified');assert.equal(configured.modelRequests,0);
  assert.equal(configured.providerLimits.maxRequests,8);assert.equal(configured.providerLimits.maxRequestBytes,128*1024);
  assert.deepEqual(configured.modelConfiguration,{provider:'workspace-deepseek',model:'deepseek-flash',apiKeyPresent:true,costPresent:true,remainingBudgetReviewed:true});
  assert.ok(!JSON.stringify(configured).includes('explicit-synthetic-preflight-only'));assert.deepEqual(await fs.readdir(options.outputDirectory),[]);
  const unsupported=await runLocalFactory({options,configuration:{...workspaceOmpConfiguration({...selected,
    DEEPSEEK_API_KEY:'explicit-synthetic-preflight-only',WORKSPACE_OMP_PROVIDER_COST_JSON:JSON.stringify(DEEPSEEK_PRICES.ompUsdPerMillion),WORKSPACE_OMP_LIVE_BUDGET_VERIFIED:'1'}),model:'unsupported'}});
  assert.equal(unsupported.status,'provider-unsupported');assert.equal(unsupported.modelRequests,0);assert.equal(unsupported.providerLimits,null);
});

test('natural-language goals create and continue the same original OMP Session without a fixed report workflow', {timeout:30000}, async t=>{
  const options={...await fixture(t),sessionFile:null};options.sessionFile=options.directory+'/dialogue.jsonl';
  const first=await runLocalFactory({configuration,options:{...options,task:'先读取产品资料，只问我需要补充哪些交期信息，不要写报告。'},syntheticResponses:[
    {tool:'read',arguments:{path:'input-1'},expectedToolNames:names,expectedContextText:'不要写报告'},
    {text:'请补充客户希望的交期和数量。'},
  ]});
  assert.equal(first.status,'completed-local-turn',JSON.stringify(first));assert.deepEqual(first.saved,[]);
  assert.equal(first.answer,'请补充客户希望的交期和数量。');assert.equal(first.localSession.resumed,false);
  assert.equal(first.localSession.file,options.sessionFile);assert.equal(first.localSession.originalSdkPersisted,true);
  const second=await runLocalFactory({configuration,options:{...options,task:'数量为200，交期仍待确认。改为写一份简短产品介绍，保存intro.md。'},syntheticResponses:[
    {tool:'write',arguments:{path:'intro.md',content:'Synthetic introduction: 500ml cup. Quantity 200. Delivery pending. Source input-1.'},expectedContextText:'请补充客户希望的交期和数量。'},
    {text:'已保存产品介绍，交期仍待确认。'},
  ]});
  assert.equal(second.status,'saved-local-drafts',JSON.stringify(second));assert.equal(second.localSession.id,first.localSession.id);
  assert.equal(second.localSession.resumed,true);assert.equal(second.saved[0].name,'intro.md');
  assert.deepEqual(second.toolReceipts.map(r=>r.tool),['write']);
  assert.equal(second.revalidatedPriorSources[0].sha256,sha(product));assert.equal(second.saved[0].sources[0].sha256,sha(product));
  const lines=(await fs.readFile(options.sessionFile,'utf8')).split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  assert.ok(lines.some(e=>e.type==='session'&&e.id===first.localSession.id));
  assert.ok(lines.some(e=>e.type==='custom'&&e.customType==='workspace-local-binding'));
  assert.ok(!JSON.stringify(lines).includes('apiKey'));assert.equal((await fs.stat(options.sessionFile)).mode&0o777,0o600);
  assert.ok(!await fs.stat(options.sessionFile+'.lock').catch(()=>null));
  await fs.writeFile(options.inputs[0],product+'Changed source.\n');
  const changed=await runLocalFactory({configuration,options,syntheticResponses:[{text:'Must never run.'}]});
  assert.equal(changed.status,'stopped');assert.equal(changed.reason,'LOCAL_SESSION_SELECTION_OR_BILLING_REFUSED');assert.equal(changed.modelRequests,0);
  await fs.writeFile(options.inputs[0],product);
  // Use original JSONL custom metadata, not another session registry or DB.
  const lastTurn=lines.filter(e=>e.type==='custom'&&e.customType==='workspace-local-turn').at(-1);
  lastTurn.data.billingUncertain=true;
  await fs.writeFile(options.sessionFile,lines.map(e=>JSON.stringify(e)).join('\n')+'\n');
  const uncertain=await runLocalFactory({configuration,options,syntheticResponses:[{text:'Must never run.'}]});
  assert.equal(uncertain.reason,'LOCAL_SESSION_SELECTION_OR_BILLING_REFUSED');assert.equal(uncertain.modelRequests,0);
});

test('persistent local Session rejects symlink, foreign profile and concurrent continuation before model admission', {timeout:20000}, async t=>{
  const options=await fixture(t),sessionFile=options.directory+'/guarded.jsonl';
  const started=await runLocalFactory({configuration,options:{...options,sessionFile,task:'只追问缺项，不保存。'},syntheticResponses:[{text:'请提供交期。'}]});
  assert.equal(started.status,'completed-local-turn',JSON.stringify(started));assert.equal(started.toolReceipts.length,0);
  const unread=await runLocalFactory({configuration,options:{...options,sessionFile,task:'保存一份介绍。'},syntheticResponses:[
    {tool:'write',arguments:{path:'unread.md',content:'Must not use an unread source.'}},{text:'需要先读取明确选择的资料。'},
  ]});
  assert.deepEqual(unread.saved,[]);assert.deepEqual(unread.revalidatedPriorSources,[]);assert.equal(unread.toolReceipts[0].isError,true);
  assert.ok(!await fs.stat(options.outputDirectory+'/unread.md').catch(()=>null));
  await fs.symlink(sessionFile,options.directory+'/linked.jsonl');
  const linked=await runLocalFactory({configuration,options:{...options,sessionFile:options.directory+'/linked.jsonl'},syntheticResponses:[{text:'Must never run.'}]});
  assert.equal(linked.reason,'LOCAL_SYMLINK_REFUSED');assert.equal(linked.modelRequests,0);
  await fs.writeFile(sessionFile+'.lock','');
  const busy=await runLocalFactory({configuration,options:{...options,sessionFile},syntheticResponses:[{text:'Must never run.'}]});
  assert.equal(busy.reason,'LOCAL_SESSION_BUSY');assert.equal(busy.modelRequests,0);await fs.unlink(sessionFile+'.lock');
  const original=await fs.readFile(sessionFile,'utf8');
  await fs.writeFile(sessionFile,original.replace('omp:18.10.4:local-factory-v1','omp:18.10.4:public-v1'));
  const foreign=await runLocalFactory({configuration,options:{...options,sessionFile},syntheticResponses:[{text:'Must never run.'}]});
  assert.equal(foreign.reason,'LOCAL_SESSION_SELECTION_OR_BILLING_REFUSED');assert.equal(foreign.modelRequests,0);
  assert.equal(parseLocalArguments(['--input',options.inputs[0],'--output-dir',options.outputDirectory,'--session',sessionFile,'--task','任意一句话目标']).task,'任意一句话目标');
  assert.match(parseLocalArguments(['--input',options.inputs[0],'--output-dir',options.outputDirectory,'--session',sessionFile]).task,/Ask what goal/);
});

test('cached read provenance requires the current selected hash and matching successful native call receipt',async t=>{
  const options=await fixture(t);let count=0;
  const create=async()=>{const directory=options.directory+'/cached-'+count++;await fs.mkdir(directory);return createLocalFactoryFiles({...options,directory});};
  const messages=[{role:'assistant',content:[{type:'toolCall',id:'read-1',name:'read',arguments:{i:'Native SDK descriptive metadata only',path:'input-1'}}]},
    {role:'toolResult',toolCallId:'read-1',toolName:'read',isError:false,details:{privateLibrary:false,sources:[{kind:'user-selected-local-file',recordId:'input-1',name:'product.md',sha256:sha(product)}]}}];
  for(const mutate of [m=>m[1].details.sources[0].sha256='0'.repeat(64),m=>m[0].content[0].arguments.path='input-2',m=>m[1].toolCallId='unpaired',m=>m[1].details.privateLibrary=true]){
    const copy=structuredClone(messages);mutate(copy);const files=await create();
    try{await assert.rejects(files.restoreReadSources(copy),/LOCAL_CACHED_SOURCE_REFUSED/);assert.deepEqual(files.restoredSources,[]);}finally{await files.close();}
  }
  const files=await create();try{
    const failed=structuredClone(messages);failed[1].isError=true;await files.restoreReadSources(failed);assert.deepEqual(files.restoredSources,[]);
    await files.restoreReadSources(messages);assert.equal(files.restoredSources[0].sha256,sha(product));
    await fs.writeFile(options.inputs[0],product+'revoked');await assert.rejects(files.authorize(),/SOURCE_CHANGED/);
  }finally{await files.close();}
});
