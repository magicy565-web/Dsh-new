import fs from 'node:fs/promises';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
const root=path.resolve('.data');await fs.mkdir(root,{recursive:true});
const directory=await fs.mkdtemp(path.join(root,'muse-durability-probe-'));
try {
 const store=await openStore(directory);
 await store.update(state=>{state.activity.push({id:'durability-probe',type:'probe',title:'Local probe'})});
 const diagnostics=store.diagnostics();await store.close();
 const reopened=await openStore(directory), persisted=reopened.read();await reopened.close();
 if(persisted.meta.sequence!==1||persisted.activity[0]?.id!=='durability-probe')throw Error('Original store reload mismatch');
 console.log(JSON.stringify({kind:'original-workspace-store',passed:true,node:process.version,platform:process.platform,directory,diagnostics,reloadedSequence:persisted.meta.sequence}));
} catch(error) {
 console.log(JSON.stringify({kind:'original-workspace-store',passed:false,node:process.version,platform:process.platform,arch:process.arch,directory,code:error.code,errno:error.errno,syscall:error.syscall,phase:error.phase,message:error.message,cause:error.cause&&{code:error.cause.code,errno:error.cause.errno,syscall:error.cause.syscall,message:error.cause.message},preservedNames:await fs.readdir(directory)}));
 process.exitCode=1;
}
