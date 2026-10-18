import {createRequire} from 'node:module'
import {isAbsolute} from 'node:path'

export const POLICY='medusa-product-context-current-source-v1'
export const MAX_VERSION=2147483647
const loopbacks=['127.0.0.1','localhost','::1','[::1]']
const fail=()=>{throw Error('EXPLICIT_DISPOSABLE_LOOPBACK_CONFIG_REQUIRED')}

// No .env, cloud login, credential discovery, URL credentials or default target.
export function validateConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail()
 if(Object.keys(value).some(key=>!['backendUrl','adminToken','agentToken','postgres','isolation','pgRequireFrom'].includes(key)))fail()
 const {backendUrl,adminToken,agentToken,postgres:pg,isolation}=value
 let url;try{url=new URL(backendUrl)}catch{fail()}
 if(url.protocol!=='http:'||!loopbacks.includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)fail()
 if(isolation?.acknowledgement!=='DISPOSABLE_ISOLATED_MEDUSA_ONLY'||isolation.backendUrl!==backendUrl||isolation.database!==pg?.database||isolation.cleanup!=='operator-destroys-instance'||!/^medusa-live-[a-z0-9-]{8,80}$/.test(isolation.instance??''))fail()
 if(!pg||!loopbacks.includes(pg.host)||!Number.isInteger(pg.port)||pg.port<1||pg.port>65535||!/^medusa_live_[a-z0-9_]{8,80}$/.test(pg.database??'')||typeof pg.user!=='string'||!pg.user||typeof pg.serverRole!=='string'||!pg.serverRole||typeof pg.password!=='string'||!pg.password)fail()
 if(Object.keys(pg).some(key=>!['host','port','database','user','password','serverRole'].includes(key)))fail()
 for(const token of [adminToken,agentToken])if(typeof token!=='string'||token.length<16||token.length>4096||!(/^[\x21-\x7e]+$/).test(token))fail()
 if(adminToken===agentToken)fail()
 if(value.pgRequireFrom!==undefined&&(!isAbsolute(value.pgRequireFrom)||!value.pgRequireFrom.endsWith('/package.json')))fail()
 return {...value,backendUrl:url.origin}
}

export async function readConfig(stream){
 const chunks=[];let size=0
 for await(const chunk of stream){size+=Buffer.byteLength(chunk);if(size>32768)throw Error('CONFIG_TOO_LARGE');chunks.push(chunk)}
 let parsed;try{parsed=JSON.parse(Buffer.concat(chunks.map(x=>Buffer.from(x))).toString('utf8'))}catch{fail()}
 return validateConfig(parsed)
}

export function loadPg(config){
 const require=createRequire(config.pgRequireFrom??new URL('../../apps/medusa-acceptance/package.json',import.meta.url))
 // Use the existing official host dependency; never install or substitute a driver.
 return require('pg').Client
}

export function redact(report,secrets){
 const forms=new Set()
 for(const secret of secrets.filter(x=>typeof x==='string'&&x.length)){
  for(const form of [secret,JSON.stringify(secret).slice(1,-1),Buffer.from(secret).toString('base64'),Buffer.from(secret).toString('base64url')])forms.add(form)
  try{forms.add(encodeURIComponent(secret))}catch{} // Lone surrogates remain covered by literal/JSON forms.
 }
 const sensitive=value=>[...forms].some(form=>String(value).includes(form))
 const scrub=value=>{
  if(Array.isArray(value))return value.map(scrub)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!sensitive(key)).map(([key,item])=>[key,scrub(item)]))
  // Remove the whole contaminated value; no replacement string can safely cover
  // every allowed one-character password. JSON syntax is added only afterwards.
  return value!==null&&value!==undefined&&sensitive(value)?null:value
 }
 return JSON.stringify(scrub(report),null,2)
}
