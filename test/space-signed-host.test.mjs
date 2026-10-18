import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { accessConfigFromEnvironment, validateAccessConfig } from '../server/access.mjs';
import { signWorkspaceRequest } from '../server/auth-ingress.mjs';

function httpFetch(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, response => resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers })));
    request.on('error', reject); request.end(body);
  });
}
const pair = generateKeyPairSync('ed25519'); // Disposable, offline test fixture only.
const publicOrigin = 'https://workspace.example';
function config(overrides = {}) { return { mode: 'enterprise', publicOrigin, workspaceId: 'fixture-workspace', issuer: 'fixture-gateway', keyId: 'fixture-key', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), members: [{ subject: 'admin', role: 'admin' }, { subject: 'operator', role: 'operator' }, { subject: 'reader', role: 'viewer' }], ...overrides }; }
function token(route, method = 'GET', body = '', subject = 'admin', now = Date.now()) { return signWorkspaceRequest({ privateKey: pair.privateKey, ...config(), subject, method, target: route, body, now }); }
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-access-'));
  let clock = Date.now();
  const settings = { dataDirectory: directory, access: config(options.access), accessClock: () => clock, spaceOptions: { enabled: true } };
  let app = await createApp(settings), address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  async function api(route, { method = 'GET', body, subject = 'admin', session, headers = {}, assertion, unsigned = false } = {}) {
    const bytes = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const response = await httpFetch(`http://127.0.0.1:${address.port}${route}`, { method, headers: { Host: 'workspace.example', ...(['GET', 'HEAD'].includes(method) ? {} : { Origin: publicOrigin }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...(unsigned ? {} : { 'X-Workspace-Assertion': assertion || token(route, method, bytes, subject, clock) }), ...headers }, ...(body === undefined ? {} : { body: bytes }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { response, status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function login(subject = 'admin') { const result = await api('/api/session/login', { method: 'POST', body: {}, subject, headers: { 'X-Workspace-Login': '1' } }); assert.equal(result.status, 200, JSON.stringify(result.data)); return { ...result.data, cookie: result.cookie, subject }; }
  return { get app() { return app; }, directory, api, login, get base() { return `http://127.0.0.1:${address.port}`; }, now: () => clock, advance: milliseconds => { clock += milliseconds; }, async restart() { await app.close(); app = await createApp(settings); address = await app.listen(0); } };
}


test('Space original signed Host + Store: CSRF, sharing, CAS, revoke, expiry and cold restart', async t => {
 const f=await fixture(t);let owner=await f.login(), editor=await f.login('operator');
 const call=(route,body,session=owner,headers={})=>f.api(route,{method:body?'POST':'GET',body,session,subject:session.subject,headers});
 const command=x=>({requestId:randomUUID(),...x});
 const added=await call('/api/library/spaces',command({name:'Signed acceptance'}));assert.equal(added.status,201,JSON.stringify(added.data));
 const base='/api/library/spaces/'+added.data.operation.receipt.spaceId;
 let p=await call(base+'/nodes',command({kind:'page',parentId:null,title:'Persistent',content:'v1'}));assert.equal(p.status,201,JSON.stringify(p.data));
 const page=base+'/nodes/'+p.data.operation.receipt.entityId;
 assert.equal((await call(page+'/save',command({expectedRevision:1,title:'Persistent',content:'CSRF denied'}),owner,{'X-CSRF-Token':'invalid'})).status,403);
 assert.equal((await call(page,undefined,editor)).status,404);
 const revision=async()=> (await call(base)).data.space.revision;
 assert.equal((await call(base+'/share',command({expectedRevision:await revision(),subject:'operator',role:'editor',expiresAt:null}))).status,200);
 assert.equal((await call(page,undefined,editor)).status,200);
 const writes=await Promise.all(['a','b'].map(content=>call(page+'/save',command({expectedRevision:1,title:'Persistent',content}),editor)));
 assert.deepEqual(writes.map(x=>x.status).sort(),[200,409]);
 assert.equal((await call(base+'/revoke',command({expectedRevision:await revision(),subject:'operator'}))).status,200);
 assert.equal((await call(page,undefined,editor)).status,404);
 assert.equal((await call(page+'/save',command({expectedRevision:2,title:'Denied',content:'denied'}),editor)).status,404);
 await f.restart();owner=await f.login();editor=await f.login('operator');
 assert.equal((await call(page)).data.page.history.length,2);
 assert.equal((await call(page+'/save',command({expectedRevision:2,title:'Persistent',content:'owner resumes after restart'}))).status,200);
 assert.equal((await call(page,undefined,editor)).status,404);
 assert.equal((await call(base+'/share',command({expectedRevision:await revision(),subject:'operator',role:'viewer',expiresAt:new Date(f.now()+1000).toISOString()}))).status,200);
 assert.equal((await call(page,undefined,editor)).status,200);f.advance(1500);
 assert.equal((await call(page,undefined,editor)).status,404);
});

test('final revoked delivery appends a correlated refusal after the original audit completion', async t => {
 const f=await fixture(t), session=await f.login();
 const create=await f.api('/api/library/spaces',{method:'POST',body:{requestId:randomUUID(),name:'Audit race'},session});
 const id=create.data.operation.receipt.spaceId, route='/api/library/spaces/'+id;
 const begin=f.app.access.begin;let requestId;
 f.app.access.begin=async (...args)=>{
  const context=await begin(...args);const [req,res]=args;
  if(req.url===route){requestId=context.requestId;const finish=res.accessFinish;let revoked=false;
   res.accessFinish=async status=>{await finish(status);if(!revoked){revoked=true;await f.app.access.revokeSession(context,context.session.id);}};
  }return context;
 };
 const response=await f.api(route,{session});assert.ok([401,403,404,503].includes(response.status),JSON.stringify(response.data));
 const record=f.app.access.listAudit({limit:100}).records.find(x=>x.type==='request.finished'&&x.requestId===requestId);
 assert.equal(record.status,200,'Original append-only completion is preserved, not rewritten');
 const refusal=f.app.access.listAudit({limit:100}).records.find(x=>x.type==='request.delivery_refused'&&x.requestId===requestId);
 assert.equal(refusal.status,response.status);assert.equal(refusal.code,'SPACE_SESSION_REQUIRED');
 assert.ok(refusal.sequence>record.sequence,'Final refusal corrects the earlier completion');
 assert.equal(JSON.stringify(refusal).includes('Audit race'),false);
});
