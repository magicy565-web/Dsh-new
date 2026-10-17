// Original SDK appends a legitimate late usage row to an owned synthetic test
// Session. Existing journal bytes are not rewritten and no model is run.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
const {SessionManager}=await import(pathToFileURL(workspaceOmpPaths({}).packageRoot+'/src/session/session-manager.ts').href);
const manager=await SessionManager.open(process.argv[2],process.argv[3]);
const reset=manager.getBranch().findLast(e=>e.type==='reset_boundary');assert.ok(reset);
const active=manager.getLeafId();assert.notEqual(active,reset.id);
manager.appendModelUsage({purpose:'title',role:'default',api:'openai-completions',provider:'explicit-synthetic',model:'finite',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop'},{sessionId:manager.getSessionId(),parentId:reset.id});
await manager.flush();const usage=manager.getEntries().at(-1);assert.equal(usage.type,'model_usage');assert.equal(usage.parentId,reset.id);assert.equal(usage.activeLeafId,active);
console.log(JSON.stringify({originalSdkAppend:true,sameSessionId:manager.getSessionId(),currentToolResultRetained:manager.buildSessionContext().messages.some(m=>m.role==='toolResult')}));
