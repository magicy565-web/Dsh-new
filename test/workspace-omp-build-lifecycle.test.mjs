import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {workspaceOmpPaths,verifyWorkspaceOmpRuntime} from '../server/workspace-omp-runtime.mjs';

for(const scenario of ['unselected','disabled','none','uninstalled','enabled','syntax'])test('native build respects plugin selection without hiding defects: '+scenario,{timeout:30000},async()=>{
  const paths=workspaceOmpPaths({});await verifyWorkspaceOmpRuntime(paths);
  const child=spawnSync(paths.bun,['test/fixtures/omp-build-plugin-lifecycle.mjs',scenario],{
    encoding:'utf8',timeout:25000,env:{PATH:path.dirname(paths.bun)+':/usr/bin:/bin',HOME:'/tmp',NO_COLOR:'1'},
  });
  assert.equal(child.status,0,child.stderr||child.stdout);
  const result=JSON.parse(child.stdout.trim());assert.equal(result.passed,true);assert.equal(result.scenario,scenario);
  assert.equal(result.modelRequests,0);assert.equal(result.businessToolsExecuted,0);
});
