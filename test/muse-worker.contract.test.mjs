import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const doc = JSON.parse(await readFile(new URL('../docs/muse-worker-openapi.json', import.meta.url), 'utf8'));
const operations = [
  ['get','/identity','identity'],
  ['get','/inbox','inbox'],
  ['get','/tasks/{taskRef}','read'],
  ['post','/tasks/{taskRef}/claim','claim'],
  ['get','/tasks/{taskRef}/status','status'],
  ['post','/tasks/{taskRef}/heartbeat','heartbeat'],
  ['post','/tasks/{taskRef}/upload-file','upload'],
  ['post','/tasks/{taskRef}/submit-result','submit'],
  ['post','/tasks/{taskRef}/report-blocked','report-blocked'],
  ['post','/tasks/{taskRef}/confirm-stop','confirm-stop'],
  ['post','/tasks/{taskRef}/events/{eventId}/ack','ack-event'],
];
test('Muse contract is the exact independently scoped 11-operation REST API', () => {
  assert.equal(doc.openapi,'3.1.0');
  assert.equal(doc.info.version,'1.0.0-dev');
  assert.ok(doc.servers.every(x=>x.url.endsWith('/api/muse-worker/v1')));
  assert.ok(doc.servers.every(x=>!x.url.includes('/api/dot-worker') && !x.url.endsWith('/mcp')));
  assert.deepEqual(doc.security,[{MuseBearer:[]}]);
  assert.deepEqual(Object.keys(doc.components.securitySchemes),['MuseBearer']);
  assert.equal(doc.components.securitySchemes.MuseBearer.scheme,'bearer');
  const actual=Object.entries(doc.paths).flatMap(([path,routes])=>
    Object.entries(routes).filter(([verb])=>['get','post','put','patch','delete'].includes(verb))
      .map(([verb,op])=>[verb,path,op.operationId]));
  assert.deepEqual(actual.sort(),operations.map(x=>[...x]).sort());
  const seen=new Set();
  for(const [verb,path,name] of operations){
    assert.ok(doc.paths[path]?.[verb],name+' endpoint exists');
    assert.equal(doc.paths[path][verb].operationId,name);
    assert.ok(!seen.has(name),'no duplicate names');
    seen.add(name);
  }
});

test('Muse Skill limits must match the published server contract',()=>{
  const schemas=doc.components.schemas;
  const submit=schemas.SubmitRequest;
  assert.ok(submit.required.includes('attemptId') && submit.required.includes('fence') &&
    submit.required.includes('requestId') && submit.required.includes('sources'));
  assert.equal(submit.properties.summary.maxLength,8000);
  assert.equal(submit.properties.evidenceNote.maxLength,2000);
  assert.equal(submit.properties.sources.minItems,1);
  assert.equal(submit.properties.sources.maxItems,20);
  assert.equal(submit.properties.toolEvidence.maxItems,20);
  assert.ok(!submit.required.includes('toolEvidence'),'Muse supports evidenceNote when no receipts exist');
  assert.ok(!submit.required.includes('evidenceNote'),'verified receipts remain an alternative');
  assert.equal(schemas.HeartbeatRequest.properties.fence.minimum,1);
  assert.equal(schemas.UploadRequest.properties.base64.maxLength,1398104);
  assert.equal(schemas.ClaimRequest.properties.requestId.maxLength,128);
  assert.deepEqual(schemas.EventAck.required ?? [],[],'event acknowledgment is an empty object');
  assert.equal(schemas.EventAck.additionalProperties,false);
  const id=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
  for(const [verb,path] of operations){
    const params=doc.paths[path][verb].parameters||[];
    for(const param of params.filter(x=>x.in==='path')){
      assert.equal(param.schema.pattern,id.source);
      assert.equal(param.schema.maxLength,128);
    }
  }
});

test('Every Muse operation uses the dedicated bearer and no unreviewed private RFQ route',()=>{
  for(const [verb,path] of operations){
    const op=doc.paths[path][verb];
    assert.ok(!/rfq-recovery|private-rfq/i.test(path));
    assert.ok(!op.security || JSON.stringify(op.security).includes('MuseBearer'));
  }
  assert.equal(doc.components.schemas.UploadRequest.properties.filename.maxLength,160);
  assert.ok(!doc.paths['/api/worker-orders']);
});
