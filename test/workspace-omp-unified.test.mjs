import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {projectPlugins} from '../server/workspace-plugin-config.mjs';
import {inspectNativeWorkspace} from '../scripts/workspace-omp.mjs';
import {expectedPluginIds} from './fixtures/workspace-plugin-inventory.mjs';
test('single default entry verifies native runtime and all plugin states without Workspace HTTP',async()=>{
  const r=await inspectNativeWorkspace({});
  assert.equal(r.workspaceHttpRequired,false);assert.equal(r.workspaceHostStarted,false);assert.equal(r.wsBindingUsed,false);
  assert.equal(r.modelRequests,0);assert.equal(r.model.status,'unconfigured');assert.deepEqual(r.plugins.map(p=>p.id).sort(),expectedPluginIds);
  assert.equal(r.status,'offline-preview-ready');assert.equal(r.readinessScope,'pinned-runtime-and-plugin-manifests-only');
  const local=r.localSessionPrerequisites;
  assert.equal(local.modelStatus,'model-unconfigured');assert.equal(local.preflightReady,false);
  assert.equal(local.status,local.environment.nativeLock.ready?'model-unconfigured':'environment-unavailable');
  assert.equal(local.persistentSessionVerified,false);assert.equal(local.paidModelVerified,false);
  assert.equal(local.modelRequests,0);assert.equal(local.credentialFilesRead,false);assert.equal(local.selectedFilesChecked,false);
  assert.equal(local.configurationScope,'supplied-process-environment-only');
  assert.deepEqual(r.plugins.filter(p=>p.enabled).map(p=>p.id),['workspace-local-materials']);
  for(const p of r.plugins.filter(p=>!['workspace-local-materials','workspace-plugin-info'].includes(p.id)))assert.match(p.capability,/unconfigured/);
});
test('default npm and shell shortcuts never launch old server',async()=>{
  const p=JSON.parse(await fs.readFile('package.json','utf8'));
  for(const name of ['start','dev','workspace','agent:dev'])assert.equal(p.scripts[name],'node scripts/workspace-omp.mjs');
  for(const file of ['start.sh','START.command','START.bat']) {
    const s=await fs.readFile(file,'utf8');assert.ok(s.includes('scripts/workspace-omp.mjs'));assert.ok(!s.includes('server/index.mjs'));
  }
  const r=spawnSync(process.execPath,['scripts/workspace-omp.mjs','--serve'],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.cwd()+'/.cache/test-home'}});
  assert.equal(r.status,1);assert.match(r.stderr,/LEGACY_HTTP_REQUIRES_EXPLICIT_LEGACY_COMMAND/);
});
test('disable wins, physical uninstall is optional, explicitly missing package fails closed',async()=>{
  const root=await fs.mkdtemp(path.resolve('.cache/plugin-lifecycle-'));
  try {
    await fs.cp('plugins/workspace-plugin-info',root+'/workspace-plugin-info',{recursive:true});
    const config={extensions:['./workspace-plugin-info'],disabledExtensions:[]};
    await fs.writeFile(root+'/config.json',JSON.stringify(config));
    assert.equal((await projectPlugins({root})).enabled.length,1);
    assert.equal((await projectPlugins({root,disabled:['workspace-plugin-info']})).enabled.length,0);
    assert.equal((await projectPlugins({root,none:true})).enabled.length,0);
    await fs.rm(root+'/workspace-plugin-info',{recursive:true});
    assert.equal((await projectPlugins({root,disabled:['workspace-plugin-info']})).enabled.length,0);
    await assert.rejects(projectPlugins({root}),e=>e.code==='PROJECT_PLUGIN_REQUIRED');
    config.extensions=[];await fs.writeFile(root+'/config.json',JSON.stringify(config));
    assert.deepEqual((await projectPlugins({root})).installed,[]);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('native TUI preview gates model input and cannot use ambient auth',async()=>{
  const entry=await fs.readFile('scripts/workspace-omp.mjs','utf8'),gate=await fs.readFile('scripts/workspace-omp-preview-gate.mjs','utf8');
  assert.match(entry,/--trusted-extension/);assert.match(entry,/--no-session/);assert.match(entry,/--no-tools/);
  assert.ok(!entry.includes('server/index.mjs'));assert.ok(!entry.includes('WS_AGENT_TOKEN'));
  const handlers=new Map(),statuses=[],notices=[];
  (await import('../scripts/workspace-omp-preview-gate.mjs')).default({on:(event,fn)=>handlers.set(event,fn),getAllTools:()=>['workspace_factory_capabilities','workspace_factory_rfq_requirements','workspace_factory_match_prepare'].map(name=>({name}))});
  const ctx={ui:{setStatus:(...a)=>statuses.push(a),notify:(...a)=>notices.push(a)}};
  handlers.get('session_start')({},ctx);
  assert.deepEqual(handlers.get('input')({text:'hello'},ctx),{handled:true});assert.equal(notices.length,1);assert.equal(handlers.get('input')({text:'/quit'},ctx),undefined);assert.equal(notices.length,1);
  assert.throws(()=>handlers.get('before_agent_start')(),/NATIVE_PREVIEW_MODEL_UNCONFIGURED/);assert.equal(statuses.length,1);
});
test('same entry exposes combined business manifest without claiming a configured Host',async()=>{
 const r=await inspectNativeWorkspace({},'business');
 assert.equal(r.status,'unconfigured');assert.equal(r.modelRequests,0);assert.equal(r.model.credentialsRead,false);assert.equal(r.workspaceHostStarted,false);
 assert.equal(r.hostBinding,'original-signed-Session-and-reviewed-Library-policy-required');
 assert.deepEqual(r.plugins.filter(p=>p.enabled).map(p=>p.id).sort(),['workspace-factory-materials','workspace-goal-intelligence','workspace-market-validation','workspace-marketplace','workspace-medusa-catalog','workspace-shopify-product']);
});
