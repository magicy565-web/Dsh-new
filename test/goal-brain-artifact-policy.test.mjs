import test from 'node:test';
import assert from 'node:assert/strict';
import { isBrainArtifact, mayWriteBrainArtifact } from '../server/brain-artifact-policy.mjs';

const metadata = () => ({ businessLibrary:{ visibility:'internal' }, businessBrain:{schema:1,scopeKey:'a'.repeat(64),key:'context',bodyHash:'b'.repeat(64)} });
const trusted = {brainProtectedWrite:true,check:()=>true};
test('ordinary artifacts continue through the original service unchanged',()=>{
  assert.equal(mayWriteBrainArtifact(null,{},{}),true);
  assert.equal(mayWriteBrainArtifact({metadata:{}},{title:'regular'},{}),true);
});
test('arbitrary request metadata cannot impersonate an enterprise brain context',()=>{
  assert.equal(mayWriteBrainArtifact(null,metadata(),{}),false);
  assert.equal(mayWriteBrainArtifact(null,metadata(),{brainProtectedWrite:true}),false);
  assert.equal(mayWriteBrainArtifact(null,metadata(),{check:()=>true}),false);
  assert.equal(mayWriteBrainArtifact(null,metadata(),trusted),true);
});
test('existing brain metadata is protected from arbitrary updates and erasure',()=>{
  const old={metadata:metadata()};
  assert.equal(isBrainArtifact(old),true);
  assert.equal(mayWriteBrainArtifact(old,old.metadata,{}),false);
  assert.equal(mayWriteBrainArtifact(old,{},trusted),false);
  assert.equal(mayWriteBrainArtifact(old,old.metadata,trusted),true);
});
test('trusted updates still cannot rebind a brain artifact to another enterprise or record',()=>{
  const old={metadata:metadata()};
  const next=metadata();next.businessBrain.scopeKey='c'.repeat(64);
  assert.equal(mayWriteBrainArtifact(old,next,trusted),false);
  next.businessBrain.scopeKey='a'.repeat(64);next.businessBrain.key='decision:other';
  assert.equal(mayWriteBrainArtifact(old,next,trusted),false);
});
test('invalid key/hash/schema, extra metadata or external visibility are refused',()=>{
  const values=[
    x=>{x.businessBrain.key='../../payload';},
    x=>{x.businessBrain.bodyHash='missing';},
    x=>{x.businessBrain.schema=2;},
    x=>{x.businessBrain.admin=true;},
    x=>{x.businessLibrary.visibility='public';},
  ];
  for(const mutate of values){const value=metadata();mutate(value);assert.equal(mayWriteBrainArtifact(null,value,trusted),false);}
});
