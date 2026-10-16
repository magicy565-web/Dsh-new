// Fresh process against an isolated SOURCE copy. No real model or network.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]),removed=process.argv[3];
globalThis.fetch=async()=>{throw Error('REGRESSION_NETWORK_FORBIDDEN');};
const load=file=>import(pathToFileURL(path.join(root,file)).href);
const {createWorkspaceOmpSession}=await load('server/workspace-omp-session.mjs');
const {createLocalSelection}=await load('server/workspace-local-selection.mjs');
const {workspaceOmpPaths}=await load('server/workspace-omp-runtime.mjs');
const configuration={providerId:'explicit-offline-uninstall',model:'finite',baseUrl:'https://invalid.example'};
const names=['read','write','workspace_factory_capabilities','workspace_factory_rfq_requirements','workspace_factory_match_prepare'];
const directory=root+'/runs/'+removed;await fs.mkdir(directory,{recursive:true});
const cwd=root+'/data',file=cwd+'/conversation.jsonl',inputs=[cwd+'/product.md'],outputDirectory=cwd+'/output';
const files=await createLocalSelection({inputs,outputDirectory,directory});let created;
try{
  let resume=false;try{await fs.stat(file);resume=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  const basename=removed+'.md';
  created=await createWorkspaceOmpSession({packageRoot:workspaceOmpPaths({}).packageRoot,cwd,agentDir:directory+'/agent',sessionDirectory:cwd,
    configuration,localFactory:files,pluginConfiguration:{root:root+'/plugins'},authorize:()=>files.authorize(),
    localSession:{file,resume,binding:{manifest:files.manifest,inputs,outputDirectory,provider:configuration.providerId,model:configuration.model}},
    syntheticResponses:[{tool:'read',arguments:{path:'input-1'},expectedToolNames:names},
      {tool:'write',arguments:{path:basename,content:'Explicit offline synthetic cup draft; delivery pending.'}},
      {text:'Explicit offline Session remains available.'}]});
  assert.deepEqual(created.session.getActiveToolNames().sort(),[...names].sort());
  assert.deepEqual(created.selectedSkillNames,['workspace-local-materials']);
  await created.session.prompt('Read selected synthetic material and save a new draft; then confirm.');
  assert.equal(created.session.agent.state.messages.at(-1).stopReason,'stop');
  assert.equal(files.saved.length,1);assert.equal(files.saved[0].name,basename);
  await created.manager.flush();
  console.log(JSON.stringify({passed:true,removed,sessionId:created.manager.getSessionId(),resumed:resume,nativeTools:created.session.getActiveToolNames().length,
    nativeFileSaved:true,normalStop:true,finiteSyntheticResponses:created.modelCalls(),realProviderRequests:0}));
}finally{await created?.close();await files.close();}

if(process.argv.includes('--check-missing-profiles')){
  const selected={
    'workspace-procurement':{},
    'workspace-factory-materials':{factoryMaterials:true,materialsClient:{}},
    'workspace-factory-customers':{factoryCustomers:true,customerClient:{}},
    'workspace-factory-inquiries':{factoryMaterials:true,factoryInquiries:true,materialsClient:{},inquiryClient:{}},
    'workspace-factory-ingestion':{factoryIngestion:true,ingestionClient:{}},
    'workspace-market-validation':{factoryMaterials:true,marketValidation:true,materialsClient:{},planClient:{},monitorClient:{}},
    'workspace-shopify-product':{factoryMaterials:true,shopifyProduct:true,materialsClient:{},productClient:{}}
  };
  let requests=0;
  for(const[name,flags]of Object.entries(selected)){
    await assert.rejects(createWorkspaceOmpSession({packageRoot:workspaceOmpPaths({}).packageRoot,cwd,agentDir:directory+'/missing-agent',sessionDirectory:cwd,
      configuration,syntheticResponses:[{text:'must not execute'}],onModelRequest:()=>{requests++;},...flags}),
      error=>{
        assert.equal(error.code,'WORKSPACE_PLUGIN_REQUIRED','Missing '+name+': '+error.message);
        assert.equal(error.pluginId,name);assert.ok(error.message.includes(name));return true;
      });
  }
  assert.equal(requests,0);console.log(JSON.stringify({missingBusinessProfiles:7,usefulErrors:true,realProviderRequests:0}));
}
