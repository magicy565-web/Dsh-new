// Read-only projection through the pinned original SDK. No Session, auth store,
// model, queue or alternate leaf rules are created here. Node uses the same
// parser in a bounded Bun process; the live Bun worker imports it directly.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const parsers=new WeakSet(),cache=new Map(),limit=32_000_000;
const refused=()=>Object.assign(Error('NATIVE_BUSINESS_JOURNAL_INVALID'),{code:'NATIVE_BUSINESS_JOURNAL_INVALID'});
export async function loadNativeBusinessParser(packageRoot){
 if(!globalThis.Bun)throw refused();
 if(!cache.has(packageRoot))cache.set(packageRoot,(async()=>{
  const manifest=JSON.parse(await fs.readFile(path.join(packageRoot,'package.json'),'utf8'));
  if(manifest.name!=='@oh-my-pi/pi-coding-agent'||manifest.version!=='18.10.4')throw refused();
  const {buildSessionContext}=await import(pathToFileURL(path.join(packageRoot,'src/session/session-context.ts')).href);
  const parser=Object.freeze({buildSessionContext});parsers.add(parser);return parser;
 })());
 return cache.get(packageRoot);
}
function validate(entries){
 if(!Array.isArray(entries)||Buffer.byteLength(JSON.stringify(entries))>limit)throw refused();
 const rows=entries.filter(e=>e&& !['session','title'].includes(e.type)),byId=new Map();
 if(rows.length!==entries.filter(e=>!['session','title'].includes(e?.type)).length)throw refused();
 for(const row of rows){
  if(typeof row.id!=='string'||!row.id||row.id.length>128||byId.has(row.id)||!(row.parentId===null||typeof row.parentId==='string'&&row.parentId))throw refused();
  if(!['message','model_usage','thinking_level_change','model_change','service_tier_change','compaction','branch_summary','custom','custom_message','label','title_change','ttsr_injection','session_init','mode_change','credential_pin','reset_boundary'].includes(row.type))throw refused();
  if(row.type==='message'&&(!row.message||typeof row.message.role!=='string'))throw refused();
  if('activeLeafId' in row&&(row.type!=='model_usage'||!(row.activeLeafId===null||typeof row.activeLeafId==='string'&&row.activeLeafId)))throw refused();
  if(row.type==='custom'&&row.customType==='experimental_context_notes'&&(!row.data||row.data.version!==1||typeof row.data.text!=='string'||Object.keys(row.data).some(k=>!['version','text'].includes(k))||Buffer.byteLength(row.data.text)>16384))throw refused();
  if(['compaction','branch_summary'].includes(row.type)&&typeof row.summary!=='string')throw refused();
  byId.set(row.id,row);
 }
 // Strict structural admission, not leaf selection. The SDK tolerates corrupt
 // parents for recovery; private model disclosure must reject them instead.
 const done=new Set();
 for(const row of rows){let current=row;const visiting=new Set();while(current&&!done.has(current.id)){
  if(visiting.has(current.id))throw refused();visiting.add(current.id);
  if(current.parentId===null)break;current=byId.get(current.parentId);if(!current)throw refused();
 }for(const id of visiting)done.add(id);}
 return rows;
}
export function nativeBusinessMessages(entries,parser,{leafId}={}){
 if(!parsers.has(parser))throw refused();
 if(leafId!==undefined&&leafId!==null&&typeof leafId!=='string')throw refused();
 const rows=validate(entries);let messages;
 try{messages=parser.buildSessionContext(rows,leafId).messages;}catch{throw refused();}
 // Native opaque summaries/notes lack the original private source receipts.
 // Compaction is disabled for this profile. Never silently admit or discard a
 // native-emitted data channel that the original business guards cannot prove.
 if(!Array.isArray(messages)||messages.some(m=>!['user','assistant','toolResult'].includes(m?.role)))throw Object.assign(Error('NATIVE_BUSINESS_CONTEXT_UNSUPPORTED'),{code:'NATIVE_BUSINESS_CONTEXT_UNSUPPORTED'});
 return messages;
}
export async function readBusinessContext(entries,{paths,signal,leafId}={}){
 if(!paths){const {workspaceOmpPaths}=await import('./workspace-omp-runtime.mjs');paths=workspaceOmpPaths({});}
 signal?.throwIfAborted();
 if(globalThis.Bun)return nativeBusinessMessages(entries,await loadNativeBusinessParser(paths.packageRoot),{leafId});
 const {checkWorkspaceOmpPaths}=await import('./workspace-omp-runtime.mjs');await checkWorkspaceOmpPaths(paths);
 const input=JSON.stringify({packageRoot:paths.packageRoot,entries,leafId});if(Buffer.byteLength(input)>limit)throw refused();
 return new Promise((resolve,reject)=>{
  const child=spawn(paths.bun,[fileURLToPath(import.meta.url),'--parse'],{env:{PATH:path.dirname(paths.bun)+':/usr/bin:/bin',HOME:'/tmp',NO_COLOR:'1'},stdio:['pipe','pipe','ignore'],signal});
  const chunks=[];let bytes=0;const timer=setTimeout(()=>child.kill(),10000);timer.unref();
  child.stdin.on('error',()=>{});child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>limit)child.kill();else chunks.push(chunk);});
  child.on('close',code=>{clearTimeout(timer);if(code!==0||bytes>limit){reject(refused());return;}
   try{const value=JSON.parse(Buffer.concat(chunks).toString());if(value.error){reject(Object.assign(Error(value.error),{code:value.error}));return;}if(!Array.isArray(value.messages))throw refused();resolve(value.messages);}catch(error){reject(error);}
  });child.stdin.end(input);
 });
}
if(globalThis.Bun&&process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--parse'){
 globalThis.fetch=async()=>{throw Error('READ_ONLY_NATIVE_CONTEXT_NETWORK_FORBIDDEN');};
 try{const text=await Bun.stdin.text();if(Buffer.byteLength(text)>limit)throw refused();const {packageRoot,entries,leafId}=JSON.parse(text);console.log(JSON.stringify({messages:nativeBusinessMessages(entries,await loadNativeBusinessParser(packageRoot),{leafId})}));}
 catch(error){console.log(JSON.stringify({error:error.code==='NATIVE_BUSINESS_CONTEXT_UNSUPPORTED'?error.code:'NATIVE_BUSINESS_JOURNAL_INVALID'}));}
}
