import fs from 'node:fs/promises';
import path from 'node:path';
import { openStore } from '../server/store.mjs';
const root=path.resolve('.data');await fs.mkdir(root,{recursive:true});
const directory=await fs.mkdtemp(path.join(root,'muse-durability-probe-'));
try {
 const store=await openStore(directory);
 await store.update(state=>{state.activity.push({id:'durability-probe',type:'probe',title:'Local probe'})});
 const diagnostics=store.diagnostics();await store.close();
 console.log(JSON.stringify({kind:'original-workspace-store',passed:true,diagnostics}));
} catch(error) {
 console.log(JSON.stringify({kind:'original-workspace-store',passed:false,node:process.version,platform:process.platform,arch:process.arch,directory,code:error.code,errno:error.errno,syscall:error.syscall,phase:error.phase,message:error.message}));
 process.exitCode=1;
}