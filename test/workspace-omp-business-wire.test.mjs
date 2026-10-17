import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {productFixture} from './fixtures/shopify-product.mjs';
import {createMedusaProductClient} from '../server/medusa-product-client.mjs';
import {createMedusaCatalogService,medusaDraftHandle,medusaSourceHash} from '../server/medusa-catalog.mjs';
import {workspaceOmpPaths} from '../server/workspace-omp-runtime.mjs';
for(const mode of ['control','hook-source','hook-revoke','text-source','text-revoke','medusa-private'])test('native business actual SDK send boundary '+mode,{timeout:30000},async t=>{
 const privateMode=mode==='medusa-private';let f;
 f=await productFixture(t,{configured:false,...(privateMode?{policy:p=>({...p,factoryMaterials:{...p.factoryMaterials,productFields:['name','description','category','status','provenance']}}),appOptions:{capabilityEnvironment:{WORKSPACE_MEDUSA_SINGLE_TENANT_ACK:'1',WORKSPACE_MEDUSA_WORKSPACE_ID:'pi-enterprise-test',WORKSPACE_MEDUSA_BASE_URL:'http://127.0.0.1:9000',WORKSPACE_MEDUSA_SECRET_API_KEY:'explicit-synthetic-only'},medusaFetch:async()=>Response.json({products:[{id:'prod_synthetic',handle:medusaDraftHandle(f.actor.workspaceId,f.product.id),status:'draft',title:'REMOTE_PRIVATE_TITLE',description:'REMOTE_PRIVATE_DESCRIPTION',metadata:{workspace_catalog_schema:'workspace-medusa-draft-v1',workspace_id:f.actor.workspaceId,workspace_source_product_id:f.product.id,workspace_source_revision:1,workspace_source_hash:medusaSourceHash(f.product)}}],count:1})}}:{})});
 const medusa=privateMode?createMedusaProductClient({identity:f.actor,authorize:async()=>true,assertCurrent:()=>true,materialsClient:{materials:()=>f.materials()},medusaCatalog:createMedusaCatalogService({library:f.app.businessLibrary,workspaceId:f.actor.workspaceId,environment:{WORKSPACE_MEDUSA_SINGLE_TENANT_ACK:'1',WORKSPACE_MEDUSA_WORKSPACE_ID:f.actor.workspaceId,WORKSPACE_MEDUSA_BASE_URL:'http://127.0.0.1:9000',WORKSPACE_MEDUSA_SECRET_API_KEY:'explicit-synthetic-only'},fetchImpl:async()=>Response.json({products:[{id:'prod_synthetic',handle:medusaDraftHandle(f.actor.workspaceId,f.product.id),status:'draft',title:'REMOTE_PRIVATE_TITLE',description:'REMOTE_PRIVATE_DESCRIPTION',metadata:{workspace_catalog_schema:'workspace-medusa-draft-v1',workspace_id:f.actor.workspaceId,workspace_source_product_id:f.product.id,workspace_source_revision:1,workspace_source_hash:medusaSourceHash(f.product)}}],count:1})})}):null;
 const proxy=createServer(async(req,res)=>{try{
  if(req.url==='/medusa/reconcile'){const r=await f.workspace('/api/medusa/products/'+f.product.id+'/remote',{subject:'member-a'});assert.equal(r.status,200,r.text);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(await medusa.reconcile({productId:f.product.id})));return;}
  if(req.url.startsWith('/mutate/')){if(mode.includes('source'))await f.app.businessLibrary.updateProduct(f.product.id,{requestId:randomUUID(),expectedRevision:1,changes:{name:'Changed during send boundary'}},f.actor);else{const r=await f.workspace('/api/session/logout',{subject:'member-a',body:{}});assert.ok(r.status<300,r.text);}res.writeHead(200);res.end('mutated');return;}
  const r=await f.workspace(req.url,{subject:'member-a',headers:{'X-Workspace-Library-Recipient':req.headers['x-workspace-library-recipient']}});res.writeHead(r.status,{'content-type':'application/json'});res.end(r.text);
 }catch(e){res.writeHead(500);res.end(e.message);}});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>proxy.close(resolve)));
 const child=spawn(workspaceOmpPaths({}).bun,['test/fixtures/business-wire-boundary.mjs',mode,'http://127.0.0.1:'+proxy.address().port,f.product.id],{env:{PATH:process.env.PATH,HOME:'/tmp',NO_COLOR:'1'}});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>child.kill(),28000);const status=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer);assert.equal(status,0,output);console.log(output.trim());
});
