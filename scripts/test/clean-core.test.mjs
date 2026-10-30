import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { billingApi } from '../../integrations/dsh/dsh-commerce-network/src/billing-api.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const pluginNames = ['dsh-commerce-network','dsh-service-billing','dsh-shopify-admin','dsh-workspace-library','dsh-workspace-brand'].sort();
const domainNames = ['domain-commerce-network','dsh-commerce-contracts'].sort();
async function files(dir) {
  const result=[];
  for(const item of await readdir(dir,{withFileTypes:true})) {
    if(['node_modules','.git','dist'].includes(item.name))continue;
    const path=join(dir,item.name);
    if(item.isDirectory())result.push(...await files(path));else result.push(path);
  }
  return result;
}
const exists=async p=>Boolean(await stat(p).catch(()=>null));
test('only reviewed native bundles and shared domains remain',async()=>{
  assert.deepEqual((await readdir(join(root,'integrations/dsh'),{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>x.name).sort(),pluginNames);
  assert.deepEqual((await readdir(join(root,'packages'))).sort(),domainNames);
  const pkg=JSON.parse(await readFile(join(root,'package.json')));
  const lock=JSON.parse(await readFile(join(root,'package-lock.json')));
  assert.deepEqual(pkg.workspaces.sort(),[...pluginNames.map(n=>`integrations/dsh/${n}`),...domainNames.map(n=>`packages/${n}`)].sort());
  assert.deepEqual(lock.packages[''].workspaces.sort(),pkg.workspaces);
  for(const name of pkg.workspaces)assert.ok(await exists(join(root,name,'package.json')));
  assert.equal(pkg.devDependencies['lucide-react'],'1.61.0','Commerce icons must not depend on removed ERP workspace');
  for(const name of Object.keys(lock.packages)) {
    if(name.startsWith('integrations/')||name.startsWith('packages/'))assert.ok(pkg.workspaces.includes(name),`stale workspace: ${name}`);
  }
});
test('retained static relative imports and local Markdown links resolve',async()=>{
  for(const file of await files(root)) {
    if(!['.js','.mjs','.jsx','.md'].includes(extname(file)))continue;
    const text=await readFile(file,'utf8');
    const pattern=extname(file)==='.md'?/!?\[[^\]]*\]\(([^)]+)\)/g:/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g;
    for(const match of text.matchAll(pattern)){
      const target=match[1].split('#')[0];
      if(!target||/^[a-z]+:/i.test(target))continue;
      assert.ok(await exists(resolve(dirname(file),target)),`${file}: missing ${target}`);
    }
  }
});
test('retired transaction routes, service lookups and UI are absent',async()=>{
  const base=join(root,'integrations/dsh/dsh-commerce-network');
  for(const p of ['trade.js','src/TradeInspector.jsx','src/projection/trade.mjs'])assert.equal(await exists(join(base,p)),false);
  for(const p of ['index.js','http.js','service.js','src/CommerceApp.jsx','src/model.mjs','client.js']){
    const text=await readFile(join(base,p),'utf8');
    for(const marker of ['rfqDesk','miniErpQuotes','miniErpTrade','commerce_trade_read','assign_customer','resolve_customer_dispute','TradeInspector','ImportRfq','/trade?','导入询盘'])assert.equal(text.includes(marker),false,`${p}: ${marker}`);
  }
  const model=await readFile(join(base,'src/model.mjs'),'utf8');
  for(const marker of ['rfq:', 'sample:', 'erp_order:', 'submitted_rfq:', 'sample_request:', 'independent_order:', 'ready_for_quote:', 'feedback_received:'])assert.equal(new RegExp(`(?:^|[,{])${marker}`).test(model),false,`obsolete model label/rank: ${marker}`);
  const manifest=JSON.parse(await readFile(join(base,'package.json')));
  assert.equal(manifest.files.includes('trade.js'),false);
});
test('Billing fetch helper preserves authentication, cancellation and errors',async()=>{
  const original=globalThis.fetch;
  try{
    const controller=new AbortController();let seen;
    globalThis.fetch=async(path,opts)=>{seen={path,opts};return{ok:true,text:async()=>JSON.stringify({ok:true,data:{id:'bill'}})}};
    assert.deepEqual(await billingApi('/service-billing-api/read',{signal:controller.signal}),{id:'bill'});
    assert.equal(seen.opts.credentials,'same-origin');assert.equal(seen.opts.cache,'no-store');assert.equal(seen.opts.method,'GET');assert.equal(seen.opts.signal,controller.signal);
    await billingApi('/service-billing-api/command',{body:{command:'review'}});
    assert.equal(seen.opts.method,'POST');assert.deepEqual(JSON.parse(seen.opts.body),{command:'review'});
    globalThis.fetch=async()=>({ok:false,status:403,text:async()=>JSON.stringify({ok:false,error:{code:'FORBIDDEN',message:'Denied'}})});
    await assert.rejects(()=>billingApi('/service-billing-api/read'),e=>e.code==='FORBIDDEN'&&e.status===403);
    globalThis.fetch=async()=>({ok:true,text:async()=>'<html>bad</html>'});await assert.rejects(()=>billingApi('/service-billing-api/read'),/有效数据/);
    globalThis.fetch=async()=>({ok:true,text:async()=>'x'.repeat(4*1024*1024+1)});await assert.rejects(()=>billingApi('/service-billing-api/read'),/过大/);
  }finally{globalThis.fetch=original;}
});
