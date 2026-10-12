// Local UI messages only; no assumed backend endpoint, live shop or grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{presentShopReadiness}=require('../../release/miniprogram/shared/shop-readiness-view.js');
test('original conversation readiness labels keep all blocking causes distinct and do not infer domain from handle',()=>{
 for(const kind of ['not_checked','unconfigured','insufficient_permissions','store_mismatch','authorization_expired']){const v=presentShopReadiness({kind,detail:'本地UI状态输入；不是商店观测',missingPermissions:kind==='insufficient_permissions'?['read_products']:[]});assert.equal(v.kind,kind);assert.equal(v.ready,false);assert.equal(v.shopLabel,'店铺身份未核验');assert.ok(!v.detail.includes('vubm17-ak.myshopify.com'));}
 assert.match(presentShopReadiness({kind:'store_mismatch'}).summary,/另一店铺/);assert.match(presentShopReadiness({kind:'insufficient_permissions'}).detail,/不申请或扩大/);
});
test('readable label needs explicit confirmed service read and actual domain; login/token-like data has no effect',()=>{
 for(const input of [{kind:'readable_ready'},{kind:'readable_ready',shopDomain:'supplier-fixture.myshopify.com',authenticated:true,tokenPresent:true},{kind:'readable_ready',readConfirmed:true,shopDomain:null}]){const v=presentShopReadiness(input);assert.equal(v.kind,'not_checked');assert.equal(v.ready,false);}
 const v=presentShopReadiness({kind:'readable_ready',readConfirmed:true,shopDomain:'supplier-fixture.myshopify.com',checkedAt:'2026-10-12T18:00:00Z'});assert.equal(v.ready,true);assert.match(v.summary,/仍需各自准确审批/);assert.match(v.detail,/读取时间/);
});
