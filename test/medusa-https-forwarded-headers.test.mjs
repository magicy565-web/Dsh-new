// Offline configuration-contract checks, not a claim of actual nginx execution.
// The isolated real nginx echo check and the live Caddy peer check are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const conf=fs.readFileSync(new URL('../acceptance/medusa/nginx.conf',import.meta.url),'utf8');
function readMap(input,output){
 const heading=`map ${input} ${output} {`,start=conf.indexOf(heading);
 assert.ok(start>=0,heading);assert.equal(conf.indexOf(heading,start+1),-1);
 const body=conf.slice(start+heading.length,conf.indexOf('}',start));
 return body.split('\n').map(s=>s.trim()).filter(Boolean).map(line=>{
  const match=line.match(/^(?:"([^"]+)"|(\S+))\s+(\S+);$/);assert.ok(match,line);
  return [match[1]??match[2],match[3]];
 });
}
const edge=readMap('"$remote_addr|$http_host|$http_x_forwarded_proto"','$medusa_https_edge');
const host=readMap('$medusa_https_edge','$medusa_proxy_host');
const proto=readMap('$medusa_https_edge','$medusa_proxy_proto');
const port=readMap('$medusa_https_edge','$medusa_proxy_port');
// nginx literal map strings are case-insensitive. No regex/wildcard is allowed
// by this small test reader; actual nginx must independently validate the file.
const evaluate=(map,key)=>map.find(([k])=>k.toLowerCase()===key.toLowerCase())?.[1]??map.find(([k])=>k==='default')?.[1];
const projected=(peer,name,scheme)=>{const value=evaluate(edge,`${peer}|${name}|${scheme}`);return {host:evaluate(host,value),proto:evaluate(proto,value),port:evaluate(port,value)};};
const local={host:'127.0.0.1:9000',proto:'http',port:'9000'};
test('trust exactly the observed peer and single approved HTTPS origin',()=>{
 assert.deepEqual(edge,[['default','0'],['172.21.0.1|medusa.cnsubscribe.xyz|https','1']]);
 assert.deepEqual(projected('172.21.0.1','medusa.cnsubscribe.xyz','https'),{host:'medusa.cnsubscribe.xyz',proto:'https',port:'443'});
});
for(const [name,peer,nameHeader,scheme] of [
 ['other Docker peer','172.21.0.3','medusa.cnsubscribe.xyz','https'],
 ['direct loopback client','127.0.0.1','medusa.cnsubscribe.xyz','https'],
 ['another host','172.21.0.1','unselected.invalid','https'],
 ['unselected host port','172.21.0.1','medusa.cnsubscribe.xyz:444','https'],
 ['missing forwarded protocol','172.21.0.1','medusa.cnsubscribe.xyz',''],
 ['plain HTTP','172.21.0.1','medusa.cnsubscribe.xyz','http'],
 ['forwarded protocol list','172.21.0.1','medusa.cnsubscribe.xyz','https,http'],
 ['reversed protocol list','172.21.0.1','medusa.cnsubscribe.xyz','http, https'],
])test(name+' cannot claim the TLS origin',()=>assert.deepEqual(projected(peer,nameHeader,scheme),local));
test('both API locations replace forwarded identity headers and retain local XFF semantics',()=>{
 const sections=conf.split('server {').slice(1);assert.equal(sections.length,2);
 for(const section of sections){
  for(const header of ['Host','X-Forwarded-Host','X-Forwarded-Port','X-Forwarded-Proto','X-Forwarded-For','X-Real-IP','Forwarded'])assert.equal((section.match(new RegExp(`proxy_set_header ${header} `,'g'))||[]).length,1,header);
  assert.match(section,/proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(section,/proxy_set_header X-Real-IP \$remote_addr;/);
  assert.match(section,/proxy_set_header Forwarded "";/);
  assert.doesNotMatch(section,/proxy_set_header\s+\S+\s+\$http_/);
 }
 assert.match(sections[0],/proxy_set_header Host \$medusa_proxy_host;/);
 assert.match(sections[0],/proxy_set_header X-Forwarded-Host \$medusa_proxy_host;/);
 assert.match(sections[0],/proxy_set_header X-Forwarded-Proto \$medusa_proxy_proto;/);
 assert.match(sections[0],/proxy_set_header X-Forwarded-Port \$medusa_proxy_port;/);
 for(const [name,value] of [['Host','127.0.0.1:9000'],['X-Forwarded-Host','127.0.0.1:9000'],['X-Forwarded-Proto','http'],['X-Forwarded-Port','9000']])assert.ok(sections[1].includes(`proxy_set_header ${name} ${value};`));
});
test('existing ports and restricted route families remain; no Origin or cookie rewriting',()=>{
 assert.deepEqual([...conf.matchAll(/\blisten (\d+);/g)].map(m=>m[1]),['8080','9000']);
 assert.equal((conf.match(/location ~ \^\/\(admin\|auth\|store\|agent\|uploads\|static\)\(\/\|\$\)/g)||[]).length,2);
 assert.equal((conf.match(/location \/ \{ return 404; \}/g)||[]).length,2);
 assert.match(conf,/location = \/ \{ return 302 \/dashboard\/; \}/);
 assert.doesNotMatch(conf,/proxy_set_header (?:Origin|Cookie|Authorization)|proxy_cookie_|Access-Control-Allow-Origin|proxy_pass https:/i);
});
