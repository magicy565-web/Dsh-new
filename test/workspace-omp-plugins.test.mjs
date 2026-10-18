import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
import {expectedPluginIds} from './fixtures/workspace-plugin-inventory.mjs';
test('native OMP loads outside-repo plugin packages and preserves disable, uninstall, coexistence and Session recovery', {timeout:60000}, async()=>{
  const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/workspace-omp-plugins.mjs'],{
    env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
  const exit=await new Promise(resolve=>child.once('close',resolve));assert.equal(exit,0,err.slice(-6000)+out.slice(-3000));
  const result=JSON.parse(out.trim());assert.equal(result.passed,true);assert.equal(result.realProviderRequests,0);assert.deepEqual(result.loaded.map(p=>p.id).sort(),expectedPluginIds);
  assert.equal(result.sameSessionId,true);assert.equal(result.disabledHasNoFactoryTools,true);assert.equal(result.uninstalledHasNoFactoryTools,true);
});
