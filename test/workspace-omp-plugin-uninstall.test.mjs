import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
const repo=fileURLToPath(new URL('..',import.meta.url));
const packages=['workspace-factory-customers','workspace-factory-ingestion','workspace-factory-inquiries','workspace-factory-materials',
  'workspace-market-validation','workspace-procurement','workspace-shopify-product'];
test('fresh local entry and native Session survive each old business package being physically removed', {timeout:90000},async()=>{
  const root=await fs.mkdtemp('/tmp/omp-source-uninstall-'),results=[];
  const env={PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',NO_COLOR:'1'};
  const run=(binary,args)=>spawnSync(binary,args,{cwd:root,env,encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
  try{
    for(const dir of ['server','scripts','plugins'])await fs.cp(path.join(repo,dir),path.join(root,dir),{recursive:true});
    await fs.copyFile(path.join(repo,'package.json'),root+'/package.json');
    await fs.symlink(path.join(repo,'node_modules'),root+'/node_modules','dir');
    for(const name of ['omp-coding-agent','omp-bun-linux-x64']){
      await fs.mkdir(root+'/support/'+name,{recursive:true});
      for(const entry of await fs.readdir(path.join(repo,'support',name),{withFileTypes:true}))if(entry.isFile())
        await fs.copyFile(path.join(repo,'support',name,entry.name),root+'/support/'+name+'/'+entry.name);
      await fs.symlink(path.join(repo,'support',name,'node_modules'),root+'/support/'+name+'/node_modules','dir');
    }
    await fs.mkdir(root+'/data/output',{recursive:true});await fs.writeFile(root+'/data/product.md','Explicit offline synthetic cup 500ml; delivery pending.\n');
    const cli=['scripts/workspace-omp-local.mjs','--input',root+'/data/product.md','--output-dir',root+'/data/output','--check','Check selected local material.'];
    const paths=workspaceOmpPaths({});let sessionId;
    for(const name of packages){
      await fs.rm(root+'/plugins/'+name,{recursive:true});
      const checked=run(process.execPath,cli);assert.equal(checked.status,0,checked.stderr+checked.stdout);
      const report=JSON.parse(checked.stdout.trim());assert.equal(report.modelRequests,0);assert.equal(report.localFilesReady,true);
      assert.deepEqual(report.plugins.enabled,['workspace-local-materials']);
      const native=run(paths.bun,[repo+'/test/fixtures/workspace-omp-uninstalled-business.mjs',root,name,
        ...(name===packages.at(-1)?['--check-missing-profiles']:[])]);
      assert.equal(native.status,0,native.stderr+native.stdout);
      const lines=native.stdout.trim().split('\n').map(JSON.parse);const result=lines[0];
      assert.equal(result.passed,true);sessionId ||= result.sessionId;assert.equal(result.sessionId,sessionId);assert.equal(result.resumed,results.length>0);
      if(name===packages.at(-1))assert.equal(lines[1].missingBusinessProfiles,7);
      results.push(result);
    }
    // Missing explicitly requested package is an error; disable still wins.
    await fs.writeFile(root+'/plugins/config.json',JSON.stringify({extensions:['./workspace-local-materials','./workspace-factory-materials'],disabledExtensions:[]}));
    const missing=run(process.execPath,cli);assert.equal(missing.status,2);
    const error=JSON.parse(missing.stdout.trim());assert.equal(error.reason,'PROJECT_PLUGIN_REQUIRED');assert.equal(error.pluginError.id,'workspace-factory-materials');assert.equal(error.modelRequests,0);
    const disabled=run(process.execPath,[...cli,'--disable-plugin','workspace-factory-materials']);assert.equal(disabled.status,0,disabled.stderr+disabled.stdout);
    assert.deepEqual(JSON.parse(disabled.stdout.trim()).plugins.enabled,['workspace-local-materials']);
    const none=run(process.execPath,[...cli,'--no-plugins']);assert.equal(none.status,0);assert.deepEqual(JSON.parse(none.stdout.trim()).plugins.enabled,[]);
    assert.equal(results.length,7);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
