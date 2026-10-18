// Actual pinned Bun compiler + OMP loader; synthetic packages only. Never execute
// a business tool, create a Session, discover credentials or access the network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {compileAndLoadPlugins} from '../../scripts/build-omp-native.mjs';
import {projectPlugins} from '../../server/workspace-plugin-config.mjs';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
import {loadWorkspaceOmpSdk} from '../../server/workspace-omp-session.mjs';
globalThis.fetch=async()=>{throw Error('SYNTHETIC_BUILD_NETWORK_FORBIDDEN');};
const scenario=process.argv[2],directory=await fs.mkdtemp('/tmp/omp-build-lifecycle-');
try{
  const root=path.join(directory,'plugins');await fs.mkdir(root);
  const good='export default function(pi){pi.registerTool({name:"synthetic_build_probe",label:"Synthetic probe",description:"No execution",parameters:{type:"object",properties:{},additionalProperties:false},async execute(){throw Error("BUILD_MUST_NOT_EXECUTE_TOOLS");}});}';
  const missing='import "@synthetic-workspace-build/absent-peer"; export default function(){}';
  for(const [name,source] of [['fixture-ok',good],['fixture-optional-peer',scenario==='syntax'?'export default {':missing]]){
    const folder=path.join(root,name);await fs.mkdir(path.join(folder,'skills'),{recursive:true});
    await fs.writeFile(path.join(folder,'package.json'),JSON.stringify({name:'@synthetic-workspace-build/'+name,version:'0.0.0',type:'module',pi:{extensions:['./extension.js'],skills:['./skills']}}));
    for(const [file,content] of [['extension.js',source],['README.md','Synthetic build fixture.'],['AGENTS.md','Synthetic build fixture.'],['skills/SKILL.md','Synthetic build fixture.']])await fs.writeFile(path.join(folder,file),content);
  }
  const both=['./fixture-ok','./fixture-optional-peer'];
  await fs.writeFile(path.join(root,'config.json'),JSON.stringify({extensions:scenario==='unselected'?both.slice(0,1):both,disabledExtensions:['disabled','uninstalled','syntax'].includes(scenario)?['fixture-optional-peer']:[]}));
  if(scenario==='uninstalled')await fs.rm(path.join(root,'fixture-optional-peer'),{recursive:true});
  const selection=await projectPlugins({root,none:scenario==='none'});
  const sdk=await loadWorkspaceOmpSdk(workspaceOmpPaths({}).packageRoot);
  if(['enabled','syntax'].includes(scenario)){
    await assert.rejects(compileAndLoadPlugins(selection,sdk,directory),error=>scenario==='syntax'
      ? error instanceof AggregateError||/^NATIVE_PLUGIN_COMPILE_FAILED/.test(error.message)
      : /^NATIVE_PLUGIN_LOAD_FAILED/.test(error.message));
  }else{
    const rows=await compileAndLoadPlugins(selection,sdk,directory);
    assert.equal(rows.length,selection.installed.length);
    for(const row of rows){
      const selected=selection.enabled.some(plugin=>plugin.id===row.id);
      assert.equal(row.compiled,true);assert.equal(row.nativeLoaded,selected);assert.equal(row.nativeDiscovered,selected);
      assert.deepEqual(row.registeredTools,selected?['synthetic_build_probe']:[]);assert.equal(row.businessToolsExecuted,0);
    }
  }
  console.log(JSON.stringify({scenario,passed:true,engine:'official-omp-18.10.4',modelRequests:0,businessToolsExecuted:0}));
}finally{await fs.rm(directory,{recursive:true,force:true});}
