import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
test('free-trade actual pinned OMP schemas, tools, public Session and native package lifecycle', {timeout:90000},async()=>{
 const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/free-trade-native.mjs'],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
 assert.equal(await new Promise(resolve=>child.once('close',resolve)),0,err.slice(-7000)+out.slice(-3000));
 const result=JSON.parse(out.trim());assert.equal(result.passed,true);assert.equal(result.realModelRequests,0);assert.equal(result.privateLocalOutboundBlocked,true);
});
