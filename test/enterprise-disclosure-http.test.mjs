import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryHttp } from '../server/library-http.mjs';

const admin={subject:'owner',role:'admin'};
const viewer={subject:'viewer',role:'viewer'};
const grant={id:'11111111-1111-4111-8111-111111111111'};
const disclosure={
 status:()=>({enabled:false}),
 list:args=>({args,grants:[]}),
 explain:args=>({args,decisions:[]}),
 grant:async(body,actor)=>({grant:{body,actor}}),
 revoke:async(id,body,actor)=>({grant:{id,body,actor}})
};

test('disclosure management routes require admin',async()=>{
 await assert.rejects(
  ()=>libraryHttp({library:{},disclosure,method:'GET',pathname:'/api/library/disclosure/grants',query:{},actor:viewer}),
  e=>e.code==='ROLE_REQUIRED'
 );
 assert.equal((await libraryHttp({library:{},disclosure,method:'GET',pathname:'/api/library/disclosure/status',query:{},actor:admin})).status,200);
});
test('grant and revoke route through one disclosure service',async()=>{
 const created=await libraryHttp({library:{},disclosure,method:'POST',pathname:'/api/library/disclosure/grants',body:{x:1},actor:admin});
 assert.equal(created.status,201); assert.equal(created.body.grant.body.x,1);
 const revoked=await libraryHttp({library:{},disclosure,method:'POST',pathname:`/api/library/disclosure/grants/${grant.id}/revoke`,body:{reason:'ended'},actor:admin});
 assert.equal(revoked.status,200); assert.equal(revoked.body.grant.id,grant.id);
});
