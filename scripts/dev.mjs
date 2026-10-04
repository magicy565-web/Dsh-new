import { spawn } from 'node:child_process';
const children = [spawn(process.execPath, ['--env-file-if-exists=.env','server/index.mjs'],{stdio:'inherit',env:{...process.env,WORKSPACE_DEV_ORIGIN:'http://127.0.0.1:5173'}}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{stdio:'inherit'})];
let closing=false;
function close(code=0){if(closing)return;closing=true; for(const child of children)child.kill('SIGTERM'); setTimeout(()=>process.exit(code),200).unref();}
for(const child of children)child.on('exit',(code)=>close(code||0));
process.on('SIGINT',()=>close());process.on('SIGTERM',()=>close());
