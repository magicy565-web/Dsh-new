#!/usr/bin/env node
// Compile and load existing native plugins without running their business tools.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {workspaceOmpPaths,verifyWorkspaceOmpRuntime} from '../server/workspace-omp-runtime.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),paths=workspaceOmpPaths({});
await verifyWorkspaceOmpRuntime(paths);
await fs.mkdir(path.join(root,'.cache'),{recursive:true});
for(const file of ['scripts/workspace-omp.mjs','scripts/workspace-omp-native-tui.mjs','scripts/workspace-omp-preview-gate.mjs','scripts/workspace-omp-local.mjs','server/workspace-omp-session.mjs']) {
  const syntax=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  if(syntax.status!==0)throw Error(syntax.stderr);
}
const check=spawnSync(process.execPath,[path.join(root,'scripts/check-plugins.mjs'),'--pack'],{cwd:root,encoding:'utf8'});
if(check.status!==0)throw Error(check.stderr||check.stdout);process.stdout.write(check.stdout);
const child=spawnSync(paths.bun,[path.join(root,'scripts/build-omp-native.mjs')],{
  cwd:root,encoding:'utf8',env:{PATH:path.dirname(paths.bun)+':/usr/bin:/bin',HOME:root+'/.cache/build-home',NO_COLOR:'1'},
  timeout:60000,maxBuffer:1024*1024});
if(child.status!==0)throw Error(child.stderr||child.stdout);process.stdout.write(child.stdout);
