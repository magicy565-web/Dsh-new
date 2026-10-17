import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
const paths=workspaceOmpPaths({}), fixture=path.resolve('test/fixtures/workspace-omp-cloud-acceptance.mjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
function start(mode,root) {
  const child=spawn(paths.bun,[fixture,mode,root],{env:{PATH:path.dirname(paths.bun)+':/usr/bin:/bin',HOME:root,TMPDIR:root,NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
  let out='',err=''; child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
  const done=new Promise((resolve,reject)=>{child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{
    clearTimeout(timer);
    try {assert.ok(code===0 || mode==='cancel' && code===143,err+out+' exit='+code);
      resolve(out.trim()?{...JSON.parse(out.trim()),processExitCode:code}:{noReceipt:true,processExitCode:code});} catch(error){reject(error);}
  });});
  // The caller may still be watching the journal before awaiting completion.
  void done.catch(()=>{});
  return {child,done};
}
test('SIGTERM during a finite pending write stops writes, cleans locks and permits same-Session recovery in a new process',{timeout:25000},async t=>{
  const root=await fs.mkdtemp('/tmp/omp-cloud-cancel-');
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(root+'/out');await fs.writeFile(root+'/product.md','Synthetic cloud acceptance cup 500ml; delivery and capacity pending.\n');
  const running=start('cancel',root);t.after(()=>{if(running.child.exitCode===null)running.child.kill('SIGKILL');});
  let readSeen=false;
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) {
    const journal=await fs.readFile(root+'/conversation.jsonl','utf8').catch(()=>'');
    const rows=journal.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    if(rows.some(e=>e.message?.role==='toolResult' && e.message.toolName==='read' && !e.message.isError)){readSeen=true;break;}
    if(running.child.exitCode!==null)break;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(readSeen,true,'Cancellation must be reached after an actual successful native read.');
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(running.child.kill('SIGTERM'),true);
  const cancelled=await running.done;
  await assert.rejects(fs.access(root+'/conversation.jsonl.lock'),{code:'ENOENT'},'The local Session sidecar must be removed before signal exit.');
  assert.equal(cancelled.status,'stopped',JSON.stringify(cancelled));assert.equal(cancelled.modelRequests,2);
  assert.deepEqual(cancelled.toolReceipts.map(r=>r.tool),['read']);assert.deepEqual(cancelled.saved,[]);
  assert.deepEqual(await fs.readdir(root+'/out'),[]);
  await assert.rejects(fs.access(root+'/conversation.jsonl.lock'),{code:'ENOENT'});
  const afterCancel=await fs.readFile(root+'/conversation.jsonl');
  const rows=afterCancel.toString().trim().split('\n').map(JSON.parse);
  assert.ok(rows.some(e=>e.message?.role==='assistant' && e.message.stopReason==='aborted'));
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(hash(await fs.readFile(root+'/conversation.jsonl')),hash(afterCancel));
  assert.deepEqual(await fs.readdir(root+'/out'),[]);
  const recovered=await start('recover',root).done;
  assert.equal(recovered.status,'saved-local-drafts',JSON.stringify(recovered));
  assert.equal(recovered.evidenceKind,'official-omp-finite-synthetic-local-files');assert.equal(recovered.paidModelVerified,false);
  assert.equal(recovered.localSession.id,cancelled.localSession.id);assert.equal(recovered.localSession.resumed,true);
  assert.deepEqual(recovered.toolReceipts.map(r=>r.tool),['write']);assert.equal(recovered.revalidatedPriorSources.length,1);
  assert.equal(recovered.saved[0].sha256,hash(await fs.readFile(root+'/out/recovered.md')));
  await assert.rejects(fs.access(root+'/conversation.jsonl.lock'),{code:'ENOENT'});
  assert.deepEqual(await fs.readdir(root+'/out'),['recovered.md']);
  console.log(JSON.stringify({acceptance:'native-cancellation-recovery',passed:true,signal:'SIGTERM',cancelledModelRequests:2,
    cancelledProcessExitCode:cancelled.processExitCode,cancelledReason:cancelled.reason,
    toolReceipts:['read'],writesAfterCancel:0,sidecarRemoved:true,postExitJournalStable:true,sameSessionRecovered:true,
    recoverySourceRevalidated:true,realProviderRequests:0,crashRecoveryTested:false}));
});
test('each of fourteen plugins compiles, registers, disables and physically uninstalls with the original native loader',{timeout:30000},async t=>{
  const root=await fs.mkdtemp('/tmp/omp-cloud-lifecycle-');t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const result=await start('plugins',root).done;assert.equal(result.passed,true);assert.equal(result.plugins.length,14);
  console.log(JSON.stringify(result));
});
