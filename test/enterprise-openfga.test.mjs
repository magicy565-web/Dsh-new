import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenFgaClient, customerPrincipal, resourceObject, relationForLevel, readRelationForLevel, DISCLOSURE_LEVELS } from '../server/enterprise-openfga.mjs';

test('principal/resource keys isolate workspace and customer boundaries', () => {
  assert.notEqual(customerPrincipal('a:b', 'c'), customerPrincipal('a', 'b:c'));
  assert.notEqual(resourceObject('product', 'a:b', 'c'), resourceObject('product', 'a', 'b:c'));
});
test('disclosure levels map to monotonic OpenFGA relations', () => {
  assert.equal(relationForLevel('commercial'), 'commercial_reader');
  assert.equal(readRelationForLevel('commercial'), 'can_read_commercial');
  assert.ok(DISCLOSURE_LEVELS.confidential > DISCLOSURE_LEVELS.public);
});
test('client uses high consistency and bounded tuple writes', async () => {
  const calls = [];
  const client = createOpenFgaClient({ baseURL:'https://fga.example.invalid', storeId:'store', authorizationModelId:'model', apiToken:'secret',
    fetchImpl: async (url, init) => { calls.push({url,init}); return new Response(JSON.stringify({allowed:true}), {status:200}); } });
  assert.equal(await client.check({user:customerPrincipal('w','c'),relation:'can_read_commercial',object:resourceObject('product','w','p')}), true);
  assert.equal(JSON.parse(calls[0].init.body).consistency, 'HIGHER_CONSISTENCY');
  await client.write({writes:[{user:'customer:x',relation:'commercial_reader',object:'product:y'}],deletes:[{user:'customer:z',relation:'channel_reader',object:'document:q'}]});
  const body=JSON.parse(calls[1].init.body);
  assert.equal(body.writes.on_duplicate,'ignore');
  assert.equal(body.deletes.on_missing,'ignore');
});
test('unsafe destination and malformed identities fail closed', () => {
  assert.throws(() => createOpenFgaClient({baseURL:'https://fga.example.invalid/path',storeId:'s',authorizationModelId:'m',apiToken:'x'}), /FGA_URL_UNSAFE/);
  assert.throws(() => customerPrincipal('w',''), /FGA_PRINCIPAL_INVALID/);
});
test('token screening rejects actual CR/LF while permitting ordinary r and n characters',()=>{
  const config={baseURL:'https://fga.example.invalid',storeId:'store',authorizationModelId:'model',fetchImpl:async()=>{throw Error('NO_REQUEST');}};
  assert.doesNotThrow(()=>createOpenFgaClient({...config,apiToken:'synthetic-token-with-r-and-n'}));
  for(const apiToken of ['synthetic\rvalue','synthetic\nvalue'])assert.throws(()=>createOpenFgaClient({...config,apiToken}),/FGA_TOKEN_REQUIRED/);
});
