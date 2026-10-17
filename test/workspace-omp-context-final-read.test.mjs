import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {contextHistory,mutateHistoricalSource,injectFinalContextRead,MODEL,mapping} from './fixtures/brain-context-final-read.mjs';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
for(const mode of ['control','version','revoke','delete'])test('actual SDK historical context final send-read race '+mode,{timeout:40000},async t=>{
 const f=await contextHistory(t);let armed=false,afterArm=0,injected=false,rejected=false,validationError=null,oracle;
 const proxy=createServer(async(req,res)=>{try{
  if(req.url==='/arm'){assert.equal(armed,false);armed=true;res.writeHead(200);res.end('{}');return;}
  if(req.url==='/authorize'){f.contextBinding.assertLive();res.writeHead(200);res.end('{}');return;}
  assert.equal(req.url,'/brain/revalidateReceipt');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert.ok(size<200000);chunks.push(chunk);}
  const {value,model}=JSON.parse(Buffer.concat(chunks));
  const target=armed&&value.kind==='context'&&value.recordRef?.recordRevision===1&&++afterArm===2;
  // permit(body) checks Brain twice. Inject in the second check, after actual
  // Request.text and immediately before dispatch, not in an earlier SDK check.
  if(target){assert.equal(injected,false);injected=true;oracle=injectFinalContextRead(f,()=>mutateHistoricalSource(f,mode));}
  let result;
  try{result=await f.contextBinding.brain.revalidateReceipt(value,undefined,model);}
  catch(error){if(target){rejected=true;validationError=error.code;}throw error;}
  finally{if(target){oracle.restore();oracle.assertReached();}}
  f.contextBinding.assertLive();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
 }catch{res.writeHead(403);res.end('{}');}});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));t.after(()=>{proxy.closeAllConnections();return new Promise(resolve=>proxy.close(resolve));});
 const savedSession=mapping(f),cwd=path.dirname(path.dirname(path.dirname(savedSession.sessionFile))),input=f.directory+'/context-wire-input.json';await fs.writeFile(input,JSON.stringify({savedSession,cwd,model:MODEL,originalProductName:f.product.name}));
 const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/brain-context-final-read-wire.mjs',mode,'http://127.0.0.1:'+proxy.address().port,input],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'}});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>child.kill(),28000);const status=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer);
 console.log(output.trim());assert.equal(status,0,output);assert.equal(injected,true);assert.equal(rejected,mode!=='control');if(rejected)assert.ok(['BRAIN_SOURCE_CHANGED','BRAIN_SOURCE_NOT_SELECTED'].includes(validationError),validationError);oracle.assertReached();
 const after=await fs.readFile(savedSession.sessionFile);assert.deepEqual(after.subarray(0,f.originalJournal.length),f.originalJournal,'Original journal/proof bytes stay unchanged');
});
