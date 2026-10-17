// Differential against pinned SDK-generated entries, plus stricter malformed
// journal admission. Only synthetic entries cross local pipes; no model runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readBusinessContext} from '../server/workspace-omp-business-journal.mjs';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
const paths=workspaceOmpPaths({}),result=spawnSync(paths.bun,['test/fixtures/business-context-native.mjs'],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'},encoding:'utf8',timeout:20000,maxBuffer:1000000});
assert.equal(result.status,0,result.stderr);const original=JSON.parse(result.stdout);
assert.equal(original.constructedByOriginalManager,true);assert.equal(original.originalSdkVersion,'18.10.4');
for(const row of original.cases)test('original SDK context differential '+row.name,async()=>{
 const before=JSON.stringify(row.entries);
 if(row.supported)assert.deepEqual(await readBusinessContext(row.entries,{leafId:row.leafId}),row.oracle);
 else await assert.rejects(readBusinessContext(row.entries,{leafId:row.leafId}),e=>e.code==='NATIVE_BUSINESS_CONTEXT_UNSUPPORTED');
 assert.equal(JSON.stringify(row.entries),before);
});
for(const mode of ['duplicate','missing-parent','cycle','bad-active-leaf','bad-notes','missing-id','unknown-entry'])test('malformed original journal fails closed '+mode,async()=>{
 const rows=structuredClone(original.cases[0].entries);
 if(mode==='duplicate')rows.push(structuredClone(rows.at(-1)));
 if(mode==='missing-parent')rows.at(-1).parentId='nonexistent-parent';
 if(mode==='cycle')rows.at(-1).parentId=rows.at(-1).id;
 if(mode==='bad-active-leaf')rows.at(-1).activeLeafId={untrusted:'value'};
 if(mode==='missing-id')delete rows.at(-1).id;
 if(mode==='unknown-entry')rows.at(-1).type='unreviewed_private_data_channel';
 if(mode==='bad-notes')rows.push({type:'custom',id:'bad-note',parentId:rows[0].id,customType:'experimental_context_notes',data:{version:1,text:'Synthetic data',hidden:'unreviewed'}});
 await assert.rejects(readBusinessContext(rows),e=>e.code==='NATIVE_BUSINESS_JOURNAL_INVALID');
});
