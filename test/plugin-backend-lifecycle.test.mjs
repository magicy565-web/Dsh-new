import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ApiError } from '../server/runtime.mjs';
import { createApp } from '../server/index.mjs';
import { backendPluginSelection, backendPluginsFromEnvironment } from '../server/workspace-backend-plugins.mjs';
import { createMedusaBackendModule } from '../plugins/workspace-medusa-catalog/src/module.mjs';
const ids = ['workspace-medusa-catalog', 'workspace-enterprise-context'];
const root = path.resolve(import.meta.dirname, '..');
const actor = { workspaceId:'local', subject:'owner', role:'admin' };
const product = { id:randomUUID(), revision:1, name:'Synthetic product', description:'Synthetic description', category:'fabric', status:'draft', source:{kind:'user_provided'} };
const environment = { WORKSPACE_MEDUSA_SINGLE_TENANT_ACK:'1', WORKSPACE_MEDUSA_WORKSPACE_ID:'local', WORKSPACE_MEDUSA_BASE_URL:'http://127.0.0.1:9000', WORKSPACE_MEDUSA_SECRET_API_KEY:'synthetic-only' };
const library = { getProduct: () => ({product:structuredClone(product)}) };
const deferred = () => { let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve}; };
test('backend selection rejects unknown config and snapshots disabled IDs', () => {
  for (const config of [null,[],{}, {disabled:['unknown']},{disabled:[ids[0],ids[0]]},{disabled:[],url:'file:///tmp/other'}]) assert.throws(()=>backendPluginSelection(config));
  assert.deepEqual(backendPluginsFromEnvironment({}),{disabled:[]});
  assert.deepEqual(backendPluginsFromEnvironment({WORKSPACE_BACKEND_DISABLED_PLUGINS_JSON:JSON.stringify(ids)}),{disabled:ids});
  for(const raw of ['bad','{}','["unknown"]'])assert.throws(()=>backendPluginsFromEnvironment({WORKSPACE_BACKEND_DISABLED_PLUGINS_JSON:raw}));
  const config={disabled:[ids[0]]},selected=backendPluginSelection(config);config.disabled.length=0;
  assert.equal(selected.enabled(ids[0]),false);assert.equal(selected.enabled(ids[1]),true);
});
test('module is inert; close cancels admitted reads and prevents all later calls', async () => {
  const entered=deferred();let calls=0;
  const module=createMedusaBackendModule({ApiError,library,environment,fetchImpl:async(url,{signal})=>{
    calls++;entered.resolve();return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  }});
  assert.equal(calls,0);
  const operation=module.service.reconcile(product.id,actor);
  const rejected=assert.rejects(operation,{code:'MEDUSA_MODULE_STOPPED'});
  await entered.promise;const closing=module.close();assert.equal(module.close(),closing);await closing;await rejected;
  for(const call of [()=>module.service.status(),()=>module.service.preview(product.id,actor),()=>module.service.reconcile(product.id,actor)]) assert.throws(call,{code:'MEDUSA_MODULE_STOPPED'});
  assert.equal(calls,1);
});
test('close after a possible remote commit never retries or returns a success receipt', async () => {
  const entered=deferred(),release=deferred();let writes=0;
  const module=createMedusaBackendModule({ApiError,library,environment,fetchImpl:async(url,init)=>{
    if(init.method==='GET')return Response.json({products:[],count:0});
    writes++;entered.resolve();await release.promise;
    return Response.json({product:{id:'prod_synthetic',...JSON.parse(init.body)}});
  }});
  const preview=module.service.preview(product.id,actor).preview;
  const operation=module.service.saveDraft(product.id,{requestId:randomUUID(),confirmed:true,expectedRevision:preview.revision,sourceHash:preview.sourceHash},actor);
  const rejected=assert.rejects(operation,{code:'MEDUSA_MODULE_STOPPED'});
  await entered.promise;const closing=module.close();release.resolve();await closing;await rejected;assert.equal(writes,1);
});
test('original app disabled backends have no Medusa routes, retain Library and refuse enterprise binding', async t => {
  const dir=await fs.mkdtemp('/tmp/backend-disabled-');
  const app=await createApp({dataDirectory:dir,capabilityEnvironment:{},backendPlugins:{disabled:ids}});
  t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true});});
  const {port}=await app.listen(0);const base='http://127.0.0.1:'+port;
  for(const suffix of ['/api/medusa/catalog/status','/api/medusa/products/'+product.id+'/preview','/api/medusa/products/'+product.id+'/remote'])assert.equal((await fetch(base+suffix)).status,404);
  const post=await fetch(base+'/api/medusa/products/'+product.id+'/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});assert.equal(post.status,404);
  assert.equal((await fetch(base+'/api/library/products')).status,200);
  await assert.rejects(app.enterpriseContextSessionBinding(actor,{}),{code:'BACKEND_PLUGIN_DISABLED'});
});
function child(cwd,script,args) {
  return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',script,...args],{cwd,env:{PATH:process.env.PATH,HOME:cwd},stdio:['ignore','pipe','pipe']});let out='',err='';
    p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>code===0?resolve(out):reject(Error(err||out)));
  });
}
test('physical removal boots original app without both modules and preserves products across reinstall', {timeout:30000}, async t => {
  const dir=await fs.mkdtemp('/tmp/backend-uninstall-'),checkout=path.join(dir,'checkout'),data=path.join(dir,'data');
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(checkout);
  for(const name of ['server','plugins','presets','scripts','pi','tui'])await fs.cp(path.join(root,name),path.join(checkout,name),{recursive:true,filter:source=>!source.split(path.sep).includes('node_modules')});
  await fs.copyFile(path.join(root,'package.json'),path.join(checkout,'package.json'));
  await fs.symlink(path.join(root,'node_modules'),path.join(checkout,'node_modules'),'dir');
  const original=await createApp({dataDirectory:data,capabilityEnvironment:{}});
  const saved=await original.businessLibrary.createProduct({requestId:randomUUID(),name:'Retained synthetic product',description:'Retain through uninstall'},actor);
  await original.close();
  for(const id of ids)await fs.rm(path.join(checkout,'plugins',id),{recursive:true});
  await child(checkout,`
    import assert from 'node:assert/strict';import {createApp} from './server/index.mjs';
    const app=await createApp({dataDirectory:process.argv[1],capabilityEnvironment:{},backendPlugins:{disabled:${JSON.stringify(ids)}}});
    try { const {port}=await app.listen(0);assert.equal((await fetch('http://127.0.0.1:'+port+'/api/medusa/catalog/status')).status,404);
      assert.equal(app.businessLibrary.getProduct(process.argv[2]).product.name,'Retained synthetic product');
      await assert.rejects(app.enterpriseContextSessionBinding({},{}),{code:'BACKEND_PLUGIN_DISABLED'});
    } finally {await app.close();}
    await assert.rejects(createApp({dataDirectory:process.argv[1],capabilityEnvironment:{}}),{code:'BACKEND_PLUGIN_REQUIRED'});
  `,[data,saved.product.id]);
  const restored=await createApp({dataDirectory:data,capabilityEnvironment:{}});
  try{assert.deepEqual(restored.businessLibrary.getProduct(saved.product.id).product,saved.product);}finally{await restored.close();}
});
