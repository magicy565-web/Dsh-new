import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=process.env.ERP_ADAPTER_REPO_ROOT;
const {projectPlugins}=await import(pathToFileURL(repo+'/server/workspace-plugin-config.mjs'));
test('packed external package enables, loads, disables, re-enables and uninstalls with existing discovery',async()=>{
  const root=await fs.mkdtemp(process.env.ERP_ADAPTER_EXTERNAL_ROOT+'/lifecycle-'),id='workspace-erpnext-enterprise';
  const source=fileURLToPath(process.env.ERP_ADAPTER_PACKAGE_URL),directory=path.join(root,id);
  try{
    await fs.cp(source,directory,{recursive:true});
    const config=async entries=>fs.writeFile(path.join(root,'config.json'),JSON.stringify({extensions:entries,disabledExtensions:[]}));
    await config([]);assert.equal((await projectPlugins({root})).enabled.length,0);
    await config(['./'+id]);let selection=await projectPlugins({root});assert.equal(selection.enabled.length,1);
    assert.equal(selection.skills.length,1);const entry=selection.enabled[0].extensions[0];
    const registered=[],hooks=[];
    const extension=await import(pathToFileURL(entry));extension.default({registerTool:t=>registered.push(t),on:(name,handler)=>hooks.push({name,handler})});
    assert.deepEqual(registered.map(t=>t.name),['workspace_erpnext_enterprise_status','workspace_erpnext_enterprise_read']);
    assert.equal((await registered[1].execute('fixture',{},undefined,undefined,{model:{}})).details.status,'unconfigured');
    assert.equal((await projectPlugins({root,disabled:[id]})).enabled.length,0);
    assert.equal((await projectPlugins({root,none:true})).enabled.length,0);
    assert.equal((await projectPlugins({root})).enabled.length,1);
    await fs.rm(directory,{recursive:true});
    assert.equal((await projectPlugins({root,disabled:[id]})).enabled.length,0);
    await config([]);assert.equal((await projectPlugins({root})).installed.length,0);
    // This deliberately uses existing discovery + native JS module import, not an SDK substitute.
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
