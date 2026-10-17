// Explicit Docker integration check: finite HTTP stand-ins, no service secrets,
// no database/parser/model, no image pulls/builds and only an owned test project.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..');
const nodeImage = 'node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df';
const nginxImage = 'nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8';
const env = { PATH: process.env.PATH, HOME: '/tmp', DOCKER_CONFIG: process.env.DOCKER_CONFIG || '/tmp/workspace-deployment-docker-20261017', WORKSPACE_SERVICES_STATE_DIR: '/workspace/fixture-no-service-secrets' };
function docker(args) {
  const r = spawnSync('docker', args, { cwd: root, env, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
  if (r.status !== 0) throw Error('DOCKER_CHECK_COMMAND_FAILED: ' + (r.stderr || r.error?.code || '').slice(0,1000));
  return r.stdout;
}
const read = file => JSON.parse(docker(['compose','-f',file,'config','--format','json']));
// These are fixed public test literals, never production credentials.
const parserToken = 'synthetic-ingress-parser', adminToken = 'synthetic-ingress-admin', agentToken = 'synthetic-ingress-agent';
const mock = `const http=require('node:http');const role=process.argv[1];http.createServer((q,s)=>{s.setHeader('content-type','application/json');
if(q.url==='/health'||q.url==='/ready')return s.end(JSON.stringify({role,ok:true}));
if(role==='docling'){if(q.url!=='/v1/convert/file'){s.statusCode=404;return s.end('{}')}if(q.headers['x-api-key']!=='${parserToken}'){s.statusCode=401;return s.end('{}')}q.resume();return q.on('end',()=>s.end(JSON.stringify({role,status:'success',document:{md_content:'finite proxy fixture'}})))}
const expected=q.url.startsWith('/agent/')?'${agentToken}':'${adminToken}';if(q.headers.authorization!=='Bearer '+expected){s.statusCode=401;return s.end('{}')}
q.resume();q.on('end',()=>s.end(JSON.stringify({role,method:q.method,path:q.url})));}).listen(role==='docling'?5001:9000,'0.0.0.0');`;
const report = { ok:false, scope:'Actual pinned nginx/Docker networking; synthetic HTTP backends, not Medusa or Docling engine acceptance', checks:[] };
let directory, compose, project, started = false;
try {
  for (const image of [nodeImage,nginxImage]) docker(['image','inspect',image,'--format','{{.Id}}']); // Missing images refuse; no automatic pull.
  const medusa = read('acceptance/medusa/compose.yaml'), parser = read('acceptance/docling/compose.yaml');
  directory = await fs.mkdtemp(path.join(os.tmpdir(),'workspace-ingress-check-'));
  project = 'workspace-ingress-check-' + process.pid + '-' + Date.now();
  const proxy = (original, ingress) => {
    const s = structuredClone(original); delete s.build; delete s.depends_on; delete s.healthcheck;
    s.image = nginxImage; s.restart = 'no';
    s.ports = s.ports.map(p => ({ ...p, published:'0' }));
    s.networks = Object.fromEntries(Object.entries(s.networks).map(([n,v])=>[n==='ingress'?ingress:n,v]));
    return s;
  };
  const backend = (role, network) => ({ image:nodeImage, user:'1000:1000', read_only:true, cap_drop:['ALL'], security_opt:['no-new-privileges:true'], networks:[network], entrypoint:['node'], command:['-e',mock,role] });
  const fixture = { services:{ api:backend('api','frontend'), docling:backend('docling','parser'), ui:proxy(medusa.services.ui,'medusa_entry'), ingress:proxy(parser.services.ingress,'docling_entry') },
    configs:{ ...medusa.configs, ...parser.configs }, networks:{ frontend:medusa.networks.frontend, private:medusa.networks.private, parser:parser.networks.parser, medusa_entry:medusa.networks.ingress, docling_entry:parser.networks.ingress } };
  compose = path.join(directory,'compose.json'); await fs.writeFile(compose,JSON.stringify(fixture));
  const dc = (...args) => docker(['compose','-p',project,'-f',compose,...args]);
  started = true; dc('up','-d','--no-build','--pull','never');
  const inspect = service => JSON.parse(docker(['inspect',dc('ps','-q',service).trim()]))[0];
  const port = (service,target) => { const ports=inspect(service).NetworkSettings.Ports[target+'/tcp']; assert.equal(ports?.length,1); assert.equal(ports[0].HostIp,'127.0.0.1'); return 'http://127.0.0.1:'+ports[0].HostPort; };
  const urls = { parser:port('ingress',8080), ui:port('ui',8080), api:port('ui',9000) };
  for (const service of ['api','docling']) {
    const s = inspect(service), networks=Object.values(s.NetworkSettings.Networks);
    assert.equal(networks.length,1); assert.equal(networks[0].Gateway,'');
    assert.ok(Object.values(s.NetworkSettings.Ports || {}).every(p=>p===null));
    const routes=docker(['exec',s.Id,'node','-e',"process.stdout.write(require('node:fs').readFileSync('/proc/net/route','utf8'))"]);
    assert.ok(!routes.split('\n').slice(1).some(line=>line.trim().split(/\s+/)[1]==='00000000'));
  }
  report.checks.push('only proxies publish actual loopback ports; backends have one internal interface, no gateway/default route or published port');
  async function request(url, options={}) {
    const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(3000)});return {status:r.status,text:await r.text()};
  }
  async function ready(url) {
    const end=Date.now()+15000;
    while(Date.now()<end) { try { if((await request(url)).status===200) return; } catch {} await new Promise(r=>setTimeout(r,200)); }
    throw Error('PROXY_NOT_READY');
  }
  await Promise.all([ready(urls.parser+'/health'),ready(urls.api+'/health'),ready(urls.ui+'/')]);
  for(const endpoint of ['/health','/ready']) { const r=await request(urls.parser+endpoint);assert.equal(r.status,200);assert.equal(JSON.parse(r.text).role,'docling'); }
  assert.equal((await request(urls.parser+'/v1/convert/file',{method:'POST',body:'fixture'})).status,401);
  const converted=await request(urls.parser+'/v1/convert/file',{method:'POST',headers:{'X-API-Key':parserToken},body:'finite synthetic body'});
  assert.equal(converted.status,200);assert.equal(JSON.parse(converted.text).document.md_content,'finite proxy fixture');
  assert.equal((await request(urls.parser+'/v1/convert/file')).status,405);
  assert.equal((await request(urls.parser+'/health',{method:'POST'})).status,405);
  for(const endpoint of ['/docs','/openapi.json','/v1/convert/source','/v1/convert/file/','/admin/products']) assert.equal((await request(urls.parser+endpoint)).status,404);
  assert.equal((await request(urls.parser+'/v1/convert/file',{method:'POST',headers:{'X-API-Key':parserToken},body:Buffer.alloc(6*1024*1024+1)})).status,413);
  report.checks.push('Docling exact paths/methods, upstream auth preserved, approved synthetic header/body forwarded, unrelated routes and oversized body denied');
  assert.equal((await request(urls.api+'/admin/products')).status,401);
  for(const endpoint of ['/admin/products','/auth/user/emailpass','/store/products','/agent/product-contexts','/uploads/fixture','/static/fixture']) {
    const headers={Authorization:'Bearer '+(endpoint.startsWith('/agent/')?agentToken:adminToken)};
    for(const origin of [urls.api,urls.ui]) { const r=await request(origin+endpoint,{headers});assert.equal(r.status,200);assert.equal(JSON.parse(r.text).role,'api'); }
  }
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']) {
    const r=await request(urls.api+'/admin/products',{method,headers:{Authorization:'Bearer '+adminToken}});assert.equal(r.status,200);assert.equal(JSON.parse(r.text).method,method);
  }
  for(const endpoint of ['/postgres','/redis','/arbitrary-service']) assert.equal((await request(urls.api+endpoint)).status,404);
  report.checks.push('both Medusa loopback listeners route only fixed native API prefixes, preserve auth and CRUD methods; no DB/Redis/general destination routing');
  dc('restart','ui','ingress');
  // Docker may reallocate this fixture's published=0 ports on restart.
  urls.parser=port('ingress',8080);urls.ui=port('ui',8080);urls.api=port('ui',9000);
  await Promise.all([ready(urls.parser+'/health'),ready(urls.api+'/health')]);
  const logs=dc('logs','--no-color','--no-log-prefix');for(const literal of [parserToken,adminToken,agentToken]) assert.ok(!logs.includes(literal));
  report.checks.push('proxy restart has actual loopback mappings/config and no synthetic credential appears in container logs');
  report.dockerVersion=docker(['version','--format','{{.Server.Version}}']).trim();report.ok=true;
} catch(error) { report.error=String(error.message).slice(0,1200); }
finally {
  if(started) { try { docker(['compose','-p',project,'-f',compose,'down','--remove-orphans']);report.cleanup='owned fixture containers/networks removed; no volumes'; } catch { report.ok=false;report.cleanup='failed; inspect owned project '+project; } }
  if(directory && report.cleanup?.startsWith('owned')) await fs.rm(directory,{recursive:true,force:true});
}
console.log(JSON.stringify(report,null,2));process.exitCode=report.ok?0:1;
