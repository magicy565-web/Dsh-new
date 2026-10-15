import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {workspaceOmpPaths} from '../server/workspace-omp-bridge.mjs';
test('fixed factory scalar schema, optional/default/empty fields agree with pinned OMP validation and real execution',{timeout:15000},async()=>{
 const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/workspace-factory-field-contract.mjs'],{env:{PATH:process.env.PATH,HOME:'/tmp'},stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
 assert.equal(await new Promise(resolve=>child.once('close',resolve)),0,err.slice(-3000)+out);
 const result=JSON.parse(out.trim());assert.equal(result.passed,true);assert.equal(result.cases,13);assert.equal(result.modelRequests,0);
});
