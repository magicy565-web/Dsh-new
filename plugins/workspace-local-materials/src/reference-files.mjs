// File-first owner workspace. INDEX is a manifest, not a vector index/database.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {plainPath} from './files.mjs';
import {digest} from './parse-source.mjs';
export const fail=code=>{throw Object.assign(Error(code),{code});};
export const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)&&!Object.hasOwn(Object.prototype,value);
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(k=>!keys.includes(k)))fail('LOCAL_REFERENCE_INPUT_REFUSED');}
export const json=value=>JSON.stringify(value,null,2)+'\n';
export async function ownerFileWorkspace(config,{packageRoot,fence=async()=>true}={}){
  exact(config,['directory','enterprise','project']);
  if(!id(config.enterprise)||!id(config.project)||!path.isAbsolute(config.directory))fail('LOCAL_REFERENCE_SCOPE_REQUIRED');
  const root=config.directory,pinned=await plainPath(root),uid=process.getuid();
  const packageDirectory=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  if(root===packageDirectory||root.startsWith(packageDirectory+path.sep))fail('LOCAL_REFERENCE_DATA_MUST_BE_OUTSIDE_CODE');
  if(!pinned.isDirectory()||pinned.uid!==uid||(pinned.mode&0o777)!==0o700)fail('LOCAL_REFERENCE_PRIVATE_OWNER_DIRECTORY_REQUIRED');
  const scope={mode:'local-owner',ownerUid:uid,enterprise:config.enterprise,project:config.project};
  let revoked=false,epoch;
  async function guard(operation='read',resources=[]){
    if(revoked)fail('LOCAL_REFERENCE_ACCESS_REVOKED');
    const current=await plainPath(root);
    if(current.dev!==pinned.dev||current.ino!==pinned.ino||current.uid!==uid||(current.mode&0o777)!==0o700){revoked=true;fail('LOCAL_REFERENCE_ACCESS_REVOKED');}
    try{
      const permit=await fence(Object.freeze({operation,resources:structuredClone(resources),scope:structuredClone(scope)}));
      if(permit===false||permit?.allowed===false)throw Error();
      const token=digest(String(permit?.epoch??'os-owner:'+uid));
      if(epoch!==undefined&&epoch!==token)throw Error();epoch=token;
    }catch{revoked=true;fail('LOCAL_REFERENCE_ACCESS_REVOKED');}
    return {scope,epoch};
  }
  const locate=relative=>{
    if(typeof relative!=='string'||relative.includes('..')||!/^([A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(relative))fail('LOCAL_REFERENCE_PATH_REFUSED');
    const file=path.join(root,relative);if(!file.startsWith(root+path.sep))fail('LOCAL_REFERENCE_PATH_REFUSED');return file;
  };
  async function read(relative,sha){
    await guard('file:read',[relative]);const file=locate(relative);await plainPath(file);
    const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const stat=await handle.stat();if(!stat.isFile()||stat.size>262144||(stat.mode&0o077))fail('LOCAL_REFERENCE_FILE_REFUSED');
      const bytes=await handle.readFile();if(sha&&digest(bytes)!==sha)fail('LOCAL_REFERENCE_HASH_CHANGED');await guard('file:read',[relative]);return bytes;
    }finally{await handle.close();}
  }
  const empty=()=>({schema:1,scope,generation:0,sources:{},references:{},memories:{},requests:{}});
  async function load(){
    await guard('index:read');let bytes;
    try{bytes=await read('INDEX.json');}catch(error){if(error.code==='ENOENT')return empty();throw error;}
    const index=JSON.parse(bytes);if(index.schema!==1||!same(index.scope,scope))fail('LOCAL_REFERENCE_SCOPE_MISMATCH');
    if(!Number.isSafeInteger(index.generation)||!index.sources||!index.references||!index.memories||!index.requests)fail('LOCAL_REFERENCE_INDEX_INVALID');return index;
  }
  async function directory(name){
    const file=locate(name);try{await fs.mkdir(file,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    const stat=await plainPath(file);if(!stat.isDirectory()||stat.uid!==uid||(stat.mode&0o777)!==0o700)fail('LOCAL_REFERENCE_DIRECTORY_REFUSED');
  }
  async function immutable(relative,bytes){
    await guard('file:write',[relative]);const file=locate(relative);const parent=path.posix.dirname(relative);
    if(parent!=='.')await directory(parent);
    let handle;try{handle=await fs.open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      await handle.writeFile(bytes);await handle.sync();
    }catch(error){if(error.code!=='EEXIST')throw error;if(digest(await read(relative))!==digest(bytes))fail('LOCAL_REFERENCE_IMMUTABLE_CONFLICT');}
    finally{await handle?.close();}await guard('file:write',[relative]);return {file:relative,sha256:digest(bytes)};
  }
  async function transaction(callback){
    await guard('write');const lockPath=locate('owner-write.lock');
    try{await plainPath(lockPath);}catch(error){if(error.code!=='ENOENT')throw error;}
    const {FileLock}=await import(pathToFileURL(path.join(packageRoot,'../pi-natives/native/index.js')).href);
    const lock=FileLock.tryAcquire(lockPath);if(!lock.acquired)fail('LOCAL_REFERENCE_BUSY');
    try{
      const index=await load(),previous=JSON.stringify(index),result=await callback(index);
      if(JSON.stringify(index)!==previous){
        index.generation++;if(index.generation>128||Buffer.byteLength(json(index))>131072)fail('LOCAL_REFERENCE_STORAGE_LIMIT');
        const bytes=Buffer.from(json(index));await immutable('history/INDEX.g'+index.generation+'.'+digest(bytes).slice(0,16)+'.json',bytes);
        const temporary='INDEX-'+randomUUID()+'.tmp';await immutable(temporary,bytes);
        await guard('commit');await fs.rename(locate(temporary),locate('INDEX.json'));
        const listing='# Owner-only reference directory\n\nEnterprise: '+scope.enterprise+'; project: '+scope.project+'; generation: '+index.generation+'\n\n'
          +Object.entries(index.references).map(([key,versions])=>{const item=versions.at(-1);return '- '+key+' — '+(item.kind||'reference')+' — revision '+item.revision+' — '+item.markdown+'\n  Unconfirmed purpose: '+JSON.stringify(item.purpose||'');}).join('\n')
          +'\n\nBusiness memory proposals are separate under memory/. Source originals and readable extractions are under originals/ and parsed/.\nNo customer sharing is authorized.\n';
        const preview='INDEX-'+randomUUID()+'.tmp';await immutable(preview,Buffer.from(listing));await guard('commit');await fs.rename(locate(preview),locate('INDEX.md'));
      }
      await guard('deliver');return result;
    }finally{lock.release();}
  }
  await guard('open');
  return {scope,guard,load,read,immutable,transaction,epoch:()=>epoch};
}
