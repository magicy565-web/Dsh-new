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
