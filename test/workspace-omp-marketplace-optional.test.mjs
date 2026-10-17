// Import actual core source copies without any optional Marketplace package.
// Existing unrelated dependencies retain their real modules through symlinks.
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
test('core Session and Node Marketplace Host import with Marketplace physically absent',async t=>{
 const root=await fs.mkdtemp('/tmp/marketplace-optional-');t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(root+'/server/marketplace',{recursive:true});
 for(const name of ['workspace-omp-session.mjs','workspace-plugin-config.mjs','workspace-omp-business-journal.mjs'])await fs.copyFile(path.resolve('server',name),root+'/server/'+name);
 for(const name of ['runtime.mjs','library-model-read-contract.mjs','security.mjs'])await fs.symlink(path.resolve('server',name),root+'/server/'+name);
 await fs.symlink(path.resolve('server/marketplace/contracts.mjs'),root+'/server/marketplace/contracts.mjs');await fs.copyFile(path.resolve('server/marketplace/model-host.mjs'),root+'/server/marketplace/model-host.mjs');
 await import(pathToFileURL(root+'/server/workspace-omp-session.mjs'));await import(pathToFileURL(root+'/server/marketplace/model-host.mjs'));
});
