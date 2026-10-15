import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {workspaceOmpPaths} from '../server/workspace-omp-bridge.mjs';
test('native context pairs reused provider IDs by occurrence without cross-source pruning',{timeout:15000},async()=>{
 const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/workspace-omp-context-pairing.mjs'],{env:{PATH:process.env.PATH,HOME:'/tmp'},stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
 assert.equal(await new Promise(resolve=>child.once('close',resolve)),0,out.slice(-2000)+err.slice(-3000));
 const report=JSON.parse(out.trim().split('\n').at(-1));assert.equal(report.differentSourceWasPruned,false);assert.equal(report.realProviderRequests,0);
});
