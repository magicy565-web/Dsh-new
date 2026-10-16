#!/usr/bin/env node
// The single default entry uses official OMP. Legacy HTTP startup is explicit.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {workspaceOmpPaths,verifyWorkspaceOmpRuntime} from '../server/workspace-omp-runtime.mjs';
import {projectPlugins} from '../server/workspace-plugin-config.mjs';
import {workspaceOmpConfiguration} from '../server/workspace-omp-configuration.mjs';
import {inspectNativeLock,localSessionPreflight} from '../server/workspace-omp-local-environment.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
export {verifyWorkspaceOmpRuntime} from '../server/workspace-omp-runtime.mjs';
export async function inspectNativeWorkspace(environment={}) {
  const paths=workspaceOmpPaths(environment),runtime=await verifyWorkspaceOmpRuntime(paths);
  const plugins=await projectPlugins();
  const nativeLock=await inspectNativeLock(paths);
  let localSessionPrerequisites;
  try { localSessionPrerequisites=localSessionPreflight(workspaceOmpConfiguration(environment),nativeLock); }
  catch { localSessionPrerequisites={status:nativeLock.ready?'configuration-invalid':'environment-unavailable',
    modelStatus:'configuration-invalid',preflightReady:false,persistentSessionVerified:false,paidModelVerified:false,
    environment:{nativeLock},blockers:[...(nativeLock.ready?[]:[nativeLock.reason]),'LOCAL_MODEL_CONFIGURATION_INVALID']}; }
  return {status:'offline-preview-ready',readinessScope:'pinned-runtime-and-plugin-manifests-only',runtime,entry:'official-native-omp',workspaceHttpRequired:false,
    workspaceHostStarted:false,wsBindingUsed:false,modelRequests:0,
    model:{status:'unconfigured',nativePreview:'offline-no-model',credentialsRead:false},
    localSessionPrerequisites:{...localSessionPrerequisites,configurationScope:'supplied-process-environment-only',
      credentialFilesRead:false,selectedFilesChecked:false,modelRequests:0},
    plugins:plugins.installed.map(p=>({id:p.id,package:p.name,discovered:true,enabled:p.enabled,
      loading:'manifest-validated; run npm run build:omp for native-loader verification',
      capability:p.id==='workspace-local-materials'?'public-drafts; exact local file selection required for file access'
        :p.id==='workspace-plugin-info'?'identity-only':'unconfigured: reviewed external/Host capabilities are not attached'}))};
}
export async function main(args=process.argv.slice(2),environment=process.env) {
  if(args.includes('--help')){
    console.log('npm start / npm run workspace: official OMP 18.10.4 native TUI, offline no-model preview.\n'
      +'npm run workspace -- --check: pinned runtime/plugin manifests plus separately scoped native-lock and supplied-process model configuration checks; zero model calls.\n'
      +'npm run workspace -- --input /ABS/material.md --output-dir /ABS/output "一句话目标" [--check]: existing bounded local native Session.\n'
      +'Native TUI has no credentials, HTTP Host, model calls or persistent Session. Local execution retains its original explicit model/cost/budget requirements.\n'
      +'Old HTTP frontend: npm run legacy:workspace -- --serve (explicit only).');return;
  }
  if(args.length===1&&args[0]==='--check'){console.log(JSON.stringify(await inspectNativeWorkspace(environment)));return;}
  if(args.length && !(args.length===1&&args[0]==='--terminal')){
    if(args.includes('--serve'))throw Error('LEGACY_HTTP_REQUIRES_EXPLICIT_LEGACY_COMMAND');
    return (await import('./workspace-omp-local.mjs')).main(args);
  }
  const paths=workspaceOmpPaths(environment);await verifyWorkspaceOmpRuntime(paths);
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('NATIVE_OMP_TTY_REQUIRED: use --check in non-interactive shells.');
  const plugins=await projectPlugins();
  const directory=await fs.mkdtemp(path.join(root,'.cache','native-tui-'));
  let child;
  try{
    for(const name of ['home','agent'])await fs.mkdir(path.join(directory,name),{mode:0o700});
    const config=path.join(directory,'config.json');
    await fs.writeFile(config,JSON.stringify({startup:{checkUpdate:false,setupWizard:false},telemetry:{otlpExportEnabled:false},compaction:{enabled:false}}),{mode:0o600});
    const env={PATH:path.dirname(paths.bun)+':/usr/bin:/bin',HOME:path.join(directory,'home'),TMPDIR:directory,
      PI_CODING_AGENT_DIR:path.join(directory,'agent'),PI_NO_TITLE:'1',TERM:environment.TERM||'xterm-256color',
      WORKSPACE_OMP_PACKAGE_ROOT:paths.packageRoot};
    const argv=['--preload',path.join(root,'scripts/workspace-omp-native-tui.mjs'),path.join(paths.packageRoot,'dist/cli.js'),
      '--no-session','--no-tools','--no-extensions','--no-skills','--no-rules','--no-lsp','--config',config,
      ...[path.join(root,'scripts/workspace-omp-preview-gate.mjs'),...plugins.enabled.flatMap(p=>p.extensions)]
        .flatMap(file=>['--trusted-extension',file])];
    console.log('Official OMP native TUI · offline / no model · '+plugins.installed.length+' plugins discovered · '+plugins.enabled.length+' enabled · no Workspace HTTP');
    child=spawn(paths.bun,argv,{cwd:directory,env,stdio:'inherit'});
    const stop=()=>child.kill('SIGTERM');process.once('SIGTERM',stop);process.once('SIGINT',stop);
    try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('NATIVE_OMP_EXIT_'+code)));});}
    finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
  }finally{child?.kill('SIGTERM');await fs.rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await fs.mkdir(path.join(root,'.cache'),{recursive:true});
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
