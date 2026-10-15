import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { workspaceOmpPaths } from '../server/workspace-omp-bridge.mjs';
import { LOCAL_DEEPSEEK_LIMITS } from '../server/workspace-omp-local-deepseek.mjs';
test('local HTTP fee reservations are below the existing remaining CNY5 authorization',()=>{
 assert.equal(LOCAL_DEEPSEEK_LIMITS.normalCompletionUpperCny,0.544768);
 assert.equal(LOCAL_DEEPSEEK_LIMITS.failureInclusiveUpperCny,2.680768);
 assert.ok(LOCAL_DEEPSEEK_LIMITS.failureInclusiveUpperCny<LOCAL_DEEPSEEK_LIMITS.maxTaskReserveCny);
 assert.ok(LOCAL_DEEPSEEK_LIMITS.maxTaskReserveCny<5-0.000162);
});
for(const mode of ['happy','cached','http500','network-error','stream-error','truncated','missing-usage','partial-usage','inconsistent-usage','oversized-usage','empty-response','output-contract','oversize-first','oversize-after-read','bad-tool','exhausted']){
 test('actual original OMP HTTP guard: '+mode,{timeout:20000},async()=>{
  const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/workspace-omp-local-wire.mjs'],{env:{PATH:process.env.PATH,HOME:'/tmp',LOCAL_WIRE_MODE:mode},stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
  const code=await new Promise(resolve=>child.once('close',resolve));assert.equal(code,0,err.slice(-4000)+out.slice(-1000));
  const report=JSON.parse(out.trim().split('\n').at(-1));assert.equal(report.passed,true);assert.equal(report.realProviderRequests,0);
 });
}
