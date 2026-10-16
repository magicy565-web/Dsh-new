// Explicit, local-only historical reproduction; never part of default tests.
// No journal, synthetic credential, model payload or upstream body is printed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url));
const legacy='ba4f3789174b36ba7497eed707efe6ac513b1f14';
const directory=await fs.mkdtemp('/tmp/enterprise-context-legacy-repro-');
try{
 const archive=path.join(directory,'source.tar');
 const handle=await fs.open(archive,'w');
 try{execFileSync('git',['archive',legacy],{cwd:root,stdio:['ignore',handle.fd,'pipe']});}finally{await handle.close();}
 execFileSync('tar',['-xf',archive,'-C',directory]);await fs.unlink(archive);
 for(const relative of ['node_modules','support/omp-coding-agent/node_modules','support/omp-bun-linux-x64/node_modules'])
  await fs.symlink(path.join(root,relative),path.join(directory,relative),'dir');
 const suite=await fs.readFile(path.join(root,'test/enterprise-context-host.test.mjs'),'utf8');
 const setup=suite.slice(0,suite.indexOf("test('original Host/SDK"));
 const compact=suite.slice(suite.indexOf('async function compact('),suite.indexOf("test('legacy unscreened credential"));
 assert.ok(setup&&compact);
 await fs.copyFile(path.join(root,'test/fixtures/enterprise-context-compact.mjs'),path.join(directory,'test/fixtures/enterprise-context-compact.mjs'));
 await fs.writeFile(path.join(directory,'test/enterprise-context-legacy-repro.test.mjs'),setup+compact+`
test('actual 0.2.0 credential compaction reproduction',{timeout:60000},async t=>{
 const f=await fixture(t),cid=await conversation(f);f.state.responseText='SYNTHETIC_LEGACY_REAL_PARSE '+f.state.doclingSecret;
 assert.equal((await send(f,cid)).status,'succeeded');
 const receipt=(await journal(f,cid)).find(row=>row.message?.toolName==='workspace_enterprise_context_parse_upload').message;
 assert.equal(receipt.details.text.includes(f.state.doclingSecret),true);assert.equal(receipt.details.authorization.sources,undefined);
 await compact(f,cid,true);
 f.responses.splice(0,f.responses.length,{text:'SYNTHETIC legacy replay observed',expectedContextText:'SYNTHETIC_LEGACY_REAL_PARSE'});
 const run=await send(f,cid);assert.equal(run.status,'succeeded');assert.equal(calls(run),1);assert.equal(f.state.calls,1);
 console.log(JSON.stringify({legacyVersion:'0.2.0',originalSdkCompaction:true,summaryContainsSyntheticCredential:true,restoredModelRequests:calls(run),realModelRequests:0}));
});
`);
 // No inherited provider/service credentials or dotenv loader in this process.
 const output=execFileSync(process.execPath,['--test','test/enterprise-context-legacy-repro.test.mjs'],{
  cwd:directory,env:{PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',NO_COLOR:'1'},encoding:'utf8',timeout:70000,maxBuffer:1024*1024});
 process.stdout.write(output);
}finally{await fs.rm(directory,{recursive:true,force:true});}
