// Actual pinned SessionManager compaction only; the summary is finite synthetic.
import path from 'node:path';
import assert from 'node:assert/strict';
import {loadWorkspaceOmpSdk} from '../../server/workspace-omp-session.mjs';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const file=process.argv[2];assert.ok(file?.startsWith('/tmp/workspace-pi-task-test-')&&file.endsWith('.jsonl'));
const sdk=await loadWorkspaceOmpSdk(workspaceOmpPaths({}).packageRoot),manager=await sdk.SessionManager.open(file,path.dirname(file),undefined,{throwIfMissing:true});
const last=manager.getBranch().filter(entry=>entry.type==='message').at(-1);assert.ok(last);
manager.appendCompaction('SYNTHETIC_PRIVATE_SUMMARY_WITH_ORIGINAL_SOURCE_OBLIGATIONS',undefined,last.id,120,{fromExtension:true});
await manager.flush();
const privateToolMessages=manager.buildSessionContext().messages.filter(message=>message.toolName==='workspace_erpnext_read').length;
assert.equal(privateToolMessages,0);console.log(JSON.stringify({privateToolMessages,syntheticSummary:true,realModelRequests:0}));
