// Pure input-contract checks; no SDK package is substituted or loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceOmpSession} from '../server/workspace-omp-session.mjs';
const native={nativeBusiness:true,factoryMaterials:true,marketValidation:true,shopifyProduct:true};
for(const [name,callbacks] of [
 ['ready callback without disclosure',{onNativeSessionReady:async()=>{}}],
 ['disclosure callback without ready',{onBusinessFactsDisclosure:async()=>{}}],
 ['nonfunction ready',{onNativeSessionReady:true,onBusinessFactsDisclosure:async()=>{}}],
 ['nonfunction disclosure',{onNativeSessionReady:async()=>{},onBusinessFactsDisclosure:true}],
])test('fact lifecycle rejects '+name+' before SDK initialization',async()=>{
 await assert.rejects(()=>createWorkspaceOmpSession({...native,...callbacks}),/Original native fact lifecycle callbacks required/);
});
test('fact callbacks do not enable a second profile',async()=>{
 await assert.rejects(()=>createWorkspaceOmpSession({onNativeSessionReady:async()=>{},onBusinessFactsDisclosure:async()=>{}}),/Original native fact lifecycle callbacks required/);
 await assert.rejects(()=>createWorkspaceOmpSession({...native,enterpriseContextHost:{},onNativeSessionReady:async()=>{},onBusinessFactsDisclosure:async()=>{}}),/NATIVE_BUSINESS_PROFILE_REQUIRED/);
});
