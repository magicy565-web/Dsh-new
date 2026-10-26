import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
if (!process.env.DSH_RUNTIME_DIR || !process.argv[2]) throw new Error('Set DSH_RUNTIME_DIR and pass the packaged output directory.');
const packageDir=resolve(process.argv[2]);
const root=await mkdtemp(join(tmpdir(),'erp-packed-'));
const nativeRequire=createRequire(join(resolve(process.env.DSH_RUNTIME_DIR),'package.json'));
const native=name=>import(nativeRequire.resolve('@deepseek-ai/'+name));
let ctx;
try {
 await writeFile(join(root,'package.json'),JSON.stringify({name:'isolated-erp-acceptance',private:true,type:'module'}));
 execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',join(packageDir,'dsh-workspace-library-1.4.0.tgz'),join(packageDir,'dsh-mini-erp-0.4.1.tgz')],{cwd:root,stdio:'pipe'});
 const require=createRequire(join(root,'package.json'));
 const [{default:Library},{default:ERP},{Context},{default:Tools},{default:SystemPrompt},{default:Attachments}]=await Promise.all([import(require.resolve('dsh-workspace-library')),import(require.resolve('dsh-mini-erp')),native('cordis'),native('dsh-tools'),native('dsh-system-prompt'),native('dsh-attachment-local')]);
 ctx=new Context(); await ctx.plugin(SystemPrompt);await ctx.plugin(Tools);await ctx.plugin(Attachments,{dshHome:join(root,'home')});
 await ctx.plugin({apply(c){c.provide('workspaceRegistry',{list:()=>[{id:'packed-workspace',sessionIds:['packed-session']}]});}});
 await ctx.plugin(Library,{dataDir:join(root,'library')}); await ctx.plugin(ERP,{dataDir:join(root,'erp')});
 const doc=await ctx.workspaceLibrary.addDocument({title:'Temporary packaged bytes',slotKey:'other',fileName:'test.txt',data:Buffer.from('packed attachment'),mimeType:'text/plain'});
 assert.equal(doc.currentVersion,1);
 const result=await ctx.tools.execute({name:'mini_erp_read',arguments:{entity:'buyer',q:'missing'},agent:{session:{id:'packed-session'}},callId:'packed-read',signal:new AbortController().signal});
 assert.equal(result.isError,false,JSON.stringify(result));assert.equal(result.value.items.length,0);
 for(const name of ['dsh-workspace-library','dsh-mini-erp']) {
  const manifest=JSON.parse(await readFile(join(root,'node_modules',name,'package.json'),'utf8'));
  assert.ok(manifest.dsh.bundle.patch);assert.ok((await readFile(join(root,'node_modules',name,'client.js'),'utf8')).includes('window.__ModuleLoader__'));
 }
 console.log('OK: both npm tarballs installed offline in a clean directory; official Cordis/ToolRuntime/LocalAttachmentStore loaded packaged files, saved temporary bytes and read isolated ERP data. No model calls or live profile changes.');
} finally { await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true}); }
