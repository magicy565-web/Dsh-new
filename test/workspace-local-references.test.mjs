import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
test('owner references parse real files, retain revisions and compose distinct native OMP tool trajectories', {timeout:120000},async()=>{
  const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/workspace-local-references.mjs'],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
  assert.equal(await new Promise(resolve=>child.once('close',resolve)),0,err.slice(-7000)+out.slice(-3000));
  const result=JSON.parse(out.trim());assert.equal(result.passed,true);assert.equal(result.realProviderRequests,0);assert.equal(result.customerSharing,false);
});
