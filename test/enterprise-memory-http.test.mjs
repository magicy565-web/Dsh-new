import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryHttp } from '../server/library-http.mjs';

const admin={subject:'owner',role:'admin'};
const viewer={subject:'viewer',role:'viewer'};
const memoryId='11111111-1111-4111-8111-111111111111';
const memory={
 status:()=>({enabled:true,vectorSearch:false}),
 list:args=>({args,memories:[]}),
 history:id=>({memoryId:id,history:[]}),
 remember:async(body,actor)=>({memory:{body,actor}}),
 revoke:async(id,body,actor)=>({memory:{id,body,actor}})
};
test('memory management enumeration and history are admin-only',async()=>{
 await assert.rejects(()=>libraryHttp({library:{},memory,method:'GET',pathname:'/api/library/memory',query:{},actor:viewer}),e=>e.code==='ROLE_REQUIRED');
 assert.equal((await libraryHttp({library:{},memory,method:'GET',pathname:'/api/library/memory/status',query:{},actor:admin})).status,200);
 assert.equal((await libraryHttp({library:{},memory,method:'GET',pathname:`/api/library/memory/${memoryId}/history`,query:{},actor:admin})).body.memoryId,memoryId);
});
test('memory write and revoke use the same original memory service',async()=>{
 const created=await libraryHttp({library:{},memory,method:'POST',pathname:'/api/library/memory',body:{factKey:'customer.preference'},actor:admin});
 assert.equal(created.status,201);assert.equal(created.body.memory.body.factKey,'customer.preference');
 const revoked=await libraryHttp({library:{},memory,method:'POST',pathname:`/api/library/memory/${memoryId}/revoke`,body:{reason:'obsolete'},actor:admin});
 assert.equal(revoked.status,200);assert.equal(revoked.body.memory.id,memoryId);
});
