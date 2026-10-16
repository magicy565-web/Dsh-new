// Bun compiles plugin entrypoints; the official OMP loader registers factories.
import fs from 'node:fs/promises';
import path from 'node:path';
import {projectPlugins} from '../server/workspace-plugin-config.mjs';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
import {loadWorkspaceOmpSdk} from '../server/workspace-omp-session.mjs';
globalThis.fetch=async()=>{throw Error('BUILD_NETWORK_FORBIDDEN');};
const plugins=await projectPlugins(),sdk=await loadWorkspaceOmpSdk(workspaceOmpPaths({}).packageRoot),results=[];
const temporary=await fs.mkdtemp(path.resolve('.cache/build-'));
try{
  for(const plugin of plugins.installed){
    const built=await Bun.build({entrypoints:plugin.extensions,target:'bun',format:'esm',packages:'external',write:false});
    if(!built.success)throw Error('NATIVE_PLUGIN_COMPILE_FAILED: '+plugin.id+' '+built.logs.join(' '));
    const discovered=await sdk.discoverExtensionPaths([plugin.directory],temporary,undefined,{ambient:false});
    const exact=discovered.filter(file=>plugin.extensions.includes(file));
    if(exact.length!==plugin.extensions.length)throw Error('NATIVE_PLUGIN_DISCOVERY_FAILED: '+plugin.id);
    const loaded=await sdk.loadExtensions(exact,temporary);
    if(loaded.errors.length)throw Error('NATIVE_PLUGIN_LOAD_FAILED: '+plugin.id+' '+JSON.stringify(loaded.errors));
    results.push({id:plugin.id,compiled:true,nativeDiscovered:true,nativeLoaded:true,registeredTools:loaded.extensions.flatMap(e=>[...e.tools.keys()]),businessToolsExecuted:0});
  }
  // Native loader lifecycle without persistent Session writes or business calls.
  const lifecycleRoot=path.join(temporary,'plugins');await fs.mkdir(lifecycleRoot);
  await fs.cp(path.resolve('plugins/workspace-plugin-info'),path.join(lifecycleRoot,'workspace-plugin-info'),{recursive:true});
  await fs.writeFile(path.join(lifecycleRoot,'config.json'),JSON.stringify({extensions:['./workspace-plugin-info'],disabledExtensions:[]}));
  const discover=async options=>{const selection=await projectPlugins({root:lifecycleRoot,...options});
    const allowed=new Set(selection.enabled.flatMap(p=>p.extensions));
    return (await sdk.discoverExtensionPaths(selection.paths,temporary,undefined,{ambient:false})).filter(file=>allowed.has(file));};
  const enabledFiles=await discover({});if(enabledFiles.length!==1)throw Error('LIFECYCLE_ENABLE_FAILED');
  const enabled=await sdk.loadExtensions(enabledFiles,temporary);if(enabled.errors.length||enabled.extensions.length!==1)throw Error('LIFECYCLE_LOAD_FAILED');
  if((await discover({disabled:['workspace-plugin-info']})).length)throw Error('LIFECYCLE_DISABLE_FAILED');
  if((await discover({none:true})).length)throw Error('LIFECYCLE_NO_PLUGINS_FAILED');
  await fs.rm(path.join(lifecycleRoot,'workspace-plugin-info'),{recursive:true});
  if((await discover({disabled:['workspace-plugin-info']})).length)throw Error('LIFECYCLE_UNINSTALL_FAILED');
  console.log(JSON.stringify({status:'passed',engine:'official-omp-18.10.4',plugins:results,modelRequests:0,workspaceHttpRequired:false,
    lifecycle:{nativeEnableLoad:true,disabledNotDiscovered:true,noPluginsNotDiscovered:true,uninstalledNotDiscovered:true},
    persistentSessionTests:'separate; not implied by compile/load success'}));
}finally{await fs.rm(temporary,{recursive:true,force:true});}
