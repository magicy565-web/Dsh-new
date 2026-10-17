// Actual pinned CLI in a POSIX PTY. No HTTP Host/model/credentials are enabled.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const until=async(check,label)=>{for(let i=0;i<600;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error(label());};

test('default native preview starts, refuses model input, quits and restarts without inheriting HTTP or a saved Session',{timeout:60000},async t=>{
 let httpRequests=0;const server=createServer((_req,res)=>{httpRequests++;res.writeHead(503);res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const directory=await fs.mkdtemp('/tmp/native-preview-');t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 for(let turn=0;turn<2;turn++){
  const child=spawn('python3',[root+'test/fixtures/pi-tui-pty-driver.py',process.execPath,root+'scripts/workspace-omp.mjs'],{cwd:directory,env:{PATH:process.env.PATH,HOME:directory,TMPDIR:directory,LANG:'C.UTF-8',TERM:'xterm-256color',WS_AGENT_URL:'http://127.0.0.1:'+server.address().port},stdio:['pipe','pipe','pipe']});
  const exit=once(child,'close');let raw='',buffer='',terminalExit,stopped=false;
  child.stdin.on('error',e=>{if(e.code!=='EPIPE')throw e;});child.stdout.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const n=buffer.indexOf('\n'),event=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);if(event.type==='output')raw+=event.data;if(event.type==='exit')terminalExit=event.code;}});
  const command=text=>child.stdin.write(JSON.stringify({type:'write',text:'\x15'+text+'\r'})+'\n');
  try{
   await until(()=>raw.includes('model unconfigured · no HTTP'),()=> 'Native preview readiness missing: '+raw.slice(-1500));
   assert.ok(raw.includes('offline / no model'));assert.ok(!raw.includes('terminal model disabled'));
   command('Public synthetic question, model must remain unconfigured.');await until(()=>raw.includes('This native preview makes zero model requests'),()=> 'Preview refusal missing: '+raw.slice(-1500));
   command('/quit');await until(()=>terminalExit!==undefined,()=> 'Native /quit did not close: '+raw.slice(-1500));assert.equal(terminalExit,0);assert.equal((await exit)[0],0);stopped=true;
   assert.equal(httpRequests,0,'WS_AGENT_URL cannot implicitly select the HTTP terminal');
  }finally{if(!stopped&&child.exitCode===null)child.stdin.write('{"type":"stop"}\n');await exit;}
 }
 console.log(JSON.stringify({entry:'default-native-preview',starts:2,cleanExits:2,httpRequests,modelRequests:0,persistentPreviewSession:false}));
});

for(const [entry,args,environment,code] of [
 ['workspace-omp.mjs',[],{},'NATIVE_OMP_TTY_REQUIRED'],
 ['workspace-omp-legacy.mjs',['--terminal'],{},'OMP_TERMINAL_TTY_REQUIRED'],
 ['workspace-omp-legacy.mjs',['--terminal'],{WORKSPACE_OMP_PROFILE:'business'},'OMP_BUSINESS_TUI_UNAVAILABLE']
])test('entry fails explicitly before startup: '+code,()=>{
 const r=spawnSync(process.execPath,[root+'scripts/'+entry,...args],{cwd:root,env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1',...environment},encoding:'utf8',timeout:10000});assert.equal(r.status,1,r.stderr+r.stdout);assert.ok(r.stderr.includes(code),r.stderr);assert.ok(!r.stdout.includes('Workspace server:'));
});
