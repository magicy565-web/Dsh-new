#!/usr/bin/env node
// No credentials, service probe, Host data, model call or grant is created.
import {projectPlugins} from '../server/workspace-plugin-config.mjs';
import {workspaceOmpPaths,verifyWorkspaceOmpRuntime} from '../server/workspace-omp-runtime.mjs';
if(process.argv.length!==2)throw Error('PREFLIGHT_TAKES_NO_CREDENTIAL_OR_URL_ARGUMENT');
const runtime=await verifyWorkspaceOmpRuntime(workspaceOmpPaths({}));
const plugins=await projectPlugins({configuration:'config.enterprise-context.json'});
console.log(JSON.stringify({status:'runtime-and-package-ready',runtime,enabledPlugins:plugins.enabled.map(row=>row.id),nativeHostRequired:true,
 productionReady:false,serviceConnection:'unconfigured-by-default',canonicalFacts:'Workspace Library',mem0:'disabled',modelRequests:0,serviceRequests:0,credentialRead:false}));
