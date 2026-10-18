#!/usr/bin/env node
// Finite fixtures only; no real model, account, service deployment or data deletion.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args=process.argv.slice(2);
if(args.length>1||args.length===1&&args[0]!=='--sdk')throw Error('Usage: node scripts/verify-plugin-backends.mjs [--sdk]');
const cwd=fileURLToPath(new URL('..',import.meta.url));
const tests=['test/plugin-service-boundary.test.mjs','test/plugin-backend-lifecycle.test.mjs',
 'test/enterprise-context-extension.test.mjs','test/enterprise-context-oss.test.mjs',
 'test/medusa-catalog.test.mjs','test/medusa-catalog-http.test.mjs','test/workspace-native-capability-discovery.test.mjs'];
const stages=[
 ['package-and-http',['--test','--test-timeout=30000',...tests]],
 ['original-host-guards',['--test','--test-timeout=20000','--test-name-pattern=Docling dispatch rechecks|original readonly Session|actual Session logout|original Agent bearer','test/enterprise-context-host.test.mjs']],
 ['original-native-build',['scripts/build-omp.mjs']],
 ...(args[0]==='--sdk'?[['original-persistent-sdk',['--test','--test-timeout=60000','test/enterprise-context-host.test.mjs','test/enterprise-context-unified-egress.test.mjs','test/workspace-omp-structured-memory.test.mjs','test/workspace-omp-medusa-enterprise.test.mjs','test/workspace-native-document-mainchain-sdk.test.mjs']]]:[]),
];
for(const [stage,command]of stages){
 console.log(JSON.stringify({stage,command:[process.execPath,...command],realModelRequests:0}));
 const result=spawnSync(process.execPath,command,{cwd,stdio:'inherit',timeout:600000});
 if(result.status!==0){console.error(JSON.stringify({stage,status:'failed',exitCode:result.status,signal:result.signal,error:result.error?.code}));process.exit(result.status||1);}
}
console.log(JSON.stringify({status:'passed',persistentSdk:args[0]==='--sdk'?'passed':'not-run',realServices:'not-run',productionReady:false}));
