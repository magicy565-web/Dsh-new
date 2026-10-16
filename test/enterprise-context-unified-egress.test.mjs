import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
for(const mode of ['wire-safe','wire-error','source-model','policy-model','memory-model','source-authorize','wire-source-fetch','wire-memory-fetch','wire-revoke-fetch','legacy-plain','legacy-base64','legacy-hex','forged-proof','proof-native','proof-scope','proof-revision','proof-source','proof-statement','compact-current','compact-updated','compact-revoked','compact-race-updated-fetch','compact-empty-current','compact-empty-added','compact-empty-race-added-fetch'])test('unified original Host/SDK egress: '+mode,{timeout:25000},()=>{
 const result=spawnSync(workspaceOmpPaths({}).bun,['test/fixtures/enterprise-context-unified-egress.mjs',mode],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'},encoding:'utf8',timeout:23000});
 assert.equal(result.status,0,result.stdout+result.stderr);console.log(result.stdout.trim());
});

test('fresh Bun processes restore explicit synthetic proofs and refuse missing/rotated configuration or a new Host instance',{timeout:30000},async t=>{
 const directory=await fs.mkdtemp('/tmp/unified-cross-process-');t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const run=mode=>{const result=spawnSync(workspaceOmpPaths({}).bun,['test/fixtures/enterprise-context-unified-egress.mjs',mode,directory],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'},encoding:'utf8',timeout:23000});assert.equal(result.status,0,result.stdout+result.stderr);return JSON.parse(result.stdout.trim());};
 const seed=run('cross-seed'),restored=run('cross-resume');assert.notEqual(restored.pid,seed.pid);assert.equal(restored.nativeSessionId,seed.nativeSessionId);assert.equal(restored.blocked,false);assert.equal(restored.mockFetches,1);
 const mapping=JSON.parse(await fs.readFile(directory+'/synthetic-session-mapping.json','utf8'));
 for(const mode of ['cross-rotated','cross-unconfigured','cross-new-instance']){const before=await fs.readFile(mapping.sessionFile);const refused=run(mode);const after=await fs.readFile(mapping.sessionFile);
 assert.deepEqual(after.subarray(0,before.length),before,'Every original journal byte/proof must remain unchanged.');
 const appended=after.subarray(before.length).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
 assert.ok(appended.length<=1);for(const row of appended){assert.equal(row.type,'custom');assert.equal(row.customType,'session_exit','Only the official SDK exit record may be appended after refusal.');}
 assert.notEqual(refused.pid,seed.pid);assert.equal(refused.blocked,true);assert.equal(refused.mockFetches,0);assert.equal(refused.admittedModelCalls,0);}
 console.log(JSON.stringify({acceptance:'cross-process-proof-boundary',distinctProcesses:true,sameNativeSession:true,explicitSyntheticBindingRestored:true,rotatedKeyRefused:true,unconfiguredRefused:true,newHostInstanceRefused:true,realModelRequests:0}));
});
