import fs from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {isDeepStrictEqual} from 'node:util'

export const BASELINE='a819897d9212212afab8f12683d212971c982e8b'
const PLUGIN='packages/medusa-enterprise-product-context',HOST='apps/medusa-acceptance'
const ARCHIVE='magicy565-medusa-enterprise-product-context-0.1.0.tgz'
export const LOCAL='node_modules/@magicy565/medusa-enterprise-product-context'
const root=fileURLToPath(new URL('../',import.meta.url))
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest(algorithm==='sha512'?'base64':'hex')

// Read-only preflight shared by both entry points. Reject lexical aliases rather
// than silently accepting a different path, and lstat every existing component.
export async function validateWorkDirectory(work,{repositoryRoot=root,existing=false}={}){
 const refuse=()=>{throw Error('USE_FRESH_ABSOLUTE_WORK_DIRECTORY_OUTSIDE_REPOSITORY_NO_ALIASES_OR_SYMLINKS')}
 if(typeof work!=='string'||!path.isAbsolute(work)||work!==path.resolve(work))refuse()
 const repository=await fs.realpath(repositoryRoot)
 const contains=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)}
 if(contains(repository,work)||contains(work,repository))refuse()
 const parts=work.slice(path.parse(work).root.length).split(path.sep).filter(Boolean)
 let current=path.parse(work).root
 for(let index=0;index<parts.length;index++){
  current=path.join(current,parts[index])
  let stat
  try{stat=await fs.lstat(current)}catch(error){
   if(error.code==='ENOENT'&&!existing&&index===parts.length-1)return work
   refuse()
  }
  if(stat.isSymbolicLink()||!stat.isDirectory())refuse()
 }
 if(!existing)refuse() // main must create its own fresh directory.
 return work
}

export function assertLockDelta(before,after,sri){
 const a=structuredClone(before),b=structuredClone(after)
 if(!a.packages?.[LOCAL]||!b.packages?.[LOCAL])throw Error('LOCAL_LOCK_ENTRY_REQUIRED')
 const old=a.packages[LOCAL].integrity,next=b.packages[LOCAL].integrity
 if(next!==sri||old===next)throw Error('ACTUAL_NEW_ARCHIVE_INTEGRITY_REQUIRED')
 delete a.packages[LOCAL].integrity;delete b.packages[LOCAL].integrity
 const changedPaths=[`packages.${LOCAL}.integrity`]
 const name='@magicy565/medusa-enterprise-product-context'
 if(a.packages['']?.dependencies?.[name]!==b.packages['']?.dependencies?.[name]){
  if(a.packages[''].dependencies[name]!=='file:./'+ARCHIVE||b.packages[''].dependencies[name]!=='file:'+ARCHIVE)throw Error('UNEXPECTED_LOCAL_FILE_SPEC_CHANGE')
  delete a.packages[''].dependencies[name];delete b.packages[''].dependencies[name]
  changedPaths.push(`packages..dependencies.${name}`)
 }
 // Full external entries/paths and all other root/local metadata are frozen.
 if(!isDeepStrictEqual(a,b))throw Error('LOCK_DRIFT_OUTSIDE_LOCAL_INTEGRITY')
 return {externalEntriesUnchanged:Object.keys(a.packages).filter(key=>key!==LOCAL&&key!=='').length,changedPaths,oldIntegrity:old,newIntegrity:next}
}

export function cleanEnv(home,cache){
 const env={PATH:process.env.PATH,HOME:home,NO_COLOR:'1',MEDUSA_DISABLE_TELEMETRY:'true',NPM_CONFIG_CACHE:cache,NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false',NPM_CONFIG_UPDATE_NOTIFIER:'false'}
 for(const key of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','NO_PROXY','no_proxy','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','REQUESTS_CA_BUNDLE'])if(process.env[key])env[key]=process.env[key]
 return env
}

async function run(command,args,{cwd,env,log,allowFailure=false,input,timeoutMs=600000}={}){
 const output=[];const child=spawn(command,args,{cwd,env,stdio:['pipe','pipe','pipe']})
 child.stdin.end(input)
 const timer=setTimeout(()=>child.kill('SIGTERM'),timeoutMs)
 const killTimer=setTimeout(()=>child.kill('SIGKILL'),timeoutMs+5000)
 child.stdout.on('data',chunk=>output.push(chunk));child.stderr.on('data',chunk=>output.push(chunk))
 let code
 try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)})}finally{clearTimeout(timer);clearTimeout(killTimer)}
 const text=Buffer.concat(output).toString('utf8')
 if(log)await fs.writeFile(log,text,{mode:0o600})
 if(code!==0&&!allowFailure)throw Error(`${command} ${args.join(' ')} failed (${code}); inspect private work-directory log`)
 return {code,text}
}

async function sourceFiles(destination,prefixes){
 const listed=await run('git',['ls-tree','-r','--name-only',BASELINE,'--',...prefixes],{cwd:root})
 for(const name of listed.text.trim().split('\n').filter(Boolean)){
  const source=await run('git',['show',`${BASELINE}:${name}`],{cwd:root})
  const target=path.join(destination,name);await fs.mkdir(path.dirname(target),{recursive:true})
  await fs.writeFile(target,source.text,{mode:name.startsWith(PLUGIN+'/')&&['package.json','package-lock.json','README.md'].includes(path.basename(name))?0o600:0o644})
 }
}

export async function members(archive){
 const python=`import sys,tarfile,hashlib,json\nwith tarfile.open(sys.argv[1],"r:gz") as t:\n print(json.dumps([dict(path=m.name,mode=oct(m.mode),size=m.size,sha256=hashlib.sha256(t.extractfile(m).read()).hexdigest() if m.isfile() else None,type=m.type.decode(),uid=m.uid,gid=m.gid,mtime=m.mtime) for m in t.getmembers()],sort_keys=True))`
 return JSON.parse((await run('python3',['-c',python,archive])).text)
}

export async function inspectProtocol(archive){
 const checks={}
 for(const [name,patterns] of Object.entries({
  'modules/product-context/service.js':[/nativeUpdate/,/review_version: version/,/source_hash: expectedSourceHash/,/changed !== 1/],
  'product-context-validation.js':[/2147483647/,/\.strict\(\)/,/review_version:/],
  'product-context-review.js':[/medusa-product-context-current-source-v1/,/randomBytes/,/ContextContentSchema.safeParse/],
  'api/admin/products/[id]/context/route.js':[/body.review_version !== version/,/body.source_hash !==/,/status\(409\)/],
  'api/agent/product-contexts/route.js':[/review_policy:/,/isCurrentApprovedContext/],
  'api/agent/product-contexts/[id]/route.js':[/review_policy:/,/isCurrentApprovedContext/],
 })){
  const member='package/.medusa/server/src/'+name
  const text=(await run('tar',['-xOf',archive,member])).text
  if(patterns.some(pattern=>!pattern.test(text)))throw Error('CURRENT_PROTOCOL_NOT_PACKED: '+name)
  checks[name]={sha256:hash(text),checks:patterns.length}
 }
 return checks
}

export async function complete(work){
 work=await validateWorkDirectory(work,{existing:true})
 const report=JSON.parse(await fs.readFile(path.join(work,'report.json')))
 if(report.baseline!==BASELINE||!report.reproducible||report.packs?.length!==2)throw Error('VERIFIED_TWO_PACK_PHASE_REQUIRED')
 const env=cleanEnv(path.join(work,'home'),path.join(work,'npm-cache'))
 if(report.error){report.failureHistory??=[];report.failureHistory.push(report.error);delete report.error}
 const record=async()=>fs.writeFile(path.join(work,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
 const command=async(label,cmd,args,options={})=>{
  console.log(label)
  const logFile=report.commands.length+'-'+label+'.log'
  const result=await run(cmd,args,{env,log:path.join(work,logFile),...options})
  report.commands.push({label,logFile,command:[cmd,...args].map(arg=>arg.replaceAll(work,'<work>')),exit:result.code,outputSHA256:hash(result.text)})
  await record();return result
 }
 try{
  for(const pack of report.packs){
   const file=path.join(work,pack.label,HOST,ARCHIVE),bytes=await fs.readFile(file)
   if(hash(bytes)!==pack.sha256||'sha512-'+hash(bytes,'sha512')!==pack.integrity||JSON.stringify(await members(file))!==JSON.stringify(pack.members))throw Error('PACK_EVIDENCE_CHANGED')
   pack.protocol=await inspectProtocol(file)
  }
  const aFile=path.join(work,'A',HOST,ARCHIVE),bFile=path.join(work,'B',HOST,ARCHIVE)
  if(!(await fs.readFile(aFile)).equals(await fs.readFile(bFile)))throw Error('PACK_BYTES_CHANGED')
  const lockRoot=path.join(work,'lock-update-verified');await fs.mkdir(lockRoot)
  await sourceFiles(lockRoot,[HOST+'/package.json',HOST+'/package-lock.json'])
  const lockHost=path.join(lockRoot,HOST);await fs.copyFile(aFile,path.join(lockHost,ARCHIVE))
  const beforeBytes=await fs.readFile(path.join(lockHost,'package-lock.json')),before=JSON.parse(beforeBytes)
  const manifest=await fs.readFile(path.join(lockHost,'package.json'))
  const flags=['--registry=https://registry.npmjs.org','--fetch-retries=1','--fetch-timeout=30000']
  const old=await command('old-lock-ci-must-reject','npm',['ci',...flags],{cwd:lockHost,allowFailure:true})
  if(old.code===0||!/EINTEGRITY/.test(old.text)||/E403|E401|Forbidden/.test(old.text))throw Error('ORIGINAL_INTEGRITY_BLOCK_NOT_REPRODUCED')
  await fs.rm(path.join(lockHost,'node_modules'),{recursive:true,force:true})
  await command('normal-package-lock-only-update','npm',['install','--package-lock-only','./'+ARCHIVE,...flags],{cwd:lockHost})
  const afterBytes=await fs.readFile(path.join(lockHost,'package-lock.json')),after=JSON.parse(afterBytes)
  const normalizedManifest=JSON.parse(manifest)
  normalizedManifest.dependencies['@magicy565/medusa-enterprise-product-context']='file:'+ARCHIVE
  if(!isDeepStrictEqual(JSON.parse(await fs.readFile(path.join(lockHost,'package.json'))),normalizedManifest))throw Error('UNEXPECTED_TEMPORARY_MANIFEST_CHANGE')
  report.temporaryManifestNormalization='npm canonicalizes file:./ to file: in its isolated update directory; repository and fresh hosts retain original package.json bytes'
  report.lockDelta=assertLockDelta(before,after,report.packs[0].integrity)
  report.lockDelta.beforeSHA256=hash(beforeBytes);report.lockDelta.afterSHA256=hash(afterBytes)
  await record()
  for(const label of ['A','B']){
   const directory=path.join(work,'host-'+label);await fs.mkdir(directory)
   await sourceFiles(directory,[HOST+'/package.json',HOST+'/medusa-config.ts',HOST+'/tsconfig.json','acceptance/medusa/prepare-admin-static-config.mjs'])
   const host=path.join(directory,HOST)
   await fs.writeFile(path.join(host,'package-lock.json'),afterBytes,{mode:0o600})
   await fs.copyFile(label==='A'?aFile:bFile,path.join(host,ARCHIVE))
   await command('host-'+label+'-fresh-ci','npm',['ci',...flags],{cwd:host})
   if(!(await fs.readFile(path.join(host,'package-lock.json'))).equals(afterBytes))throw Error('NPM_CI_CHANGED_LOCK')
  }
  const negative=path.join(work,'tampered-host');await fs.mkdir(negative)
  await sourceFiles(negative,[HOST+'/package.json'])
  const negativeHost=path.join(negative,HOST),tampered=Buffer.from(await fs.readFile(aFile));tampered[4]^=1
  await fs.writeFile(path.join(negativeHost,'package-lock.json'),afterBytes,{mode:0o600})
  await fs.writeFile(path.join(negativeHost,ARCHIVE),tampered,{mode:0o600})
  const negativeEnv={...env,NPM_CONFIG_CACHE:path.join(work,'negative-npm-cache')}
  const denied=await command('tampered-archive-ci-must-reject','npm',['ci',...flags],{cwd:negativeHost,env:negativeEnv,allowFailure:true})
  if(denied.code===0||!/EINTEGRITY/.test(denied.text)||/E403|E401|Forbidden/.test(denied.text))throw Error('TAMPERED_ARCHIVE_NOT_REJECTED_BY_INTEGRITY')
  report.tamperedIntegrityRejected=true;await record()
  const buildEnv={...env,JWT_SECRET:'build-only-not-a-service-secret',COOKIE_SECRET:'build-only-not-a-service-secret',DATABASE_URL:'postgres://build:build@127.0.0.1/build',REDIS_URL:'redis://127.0.0.1:6379'}
  const api=path.join(work,'host-A',HOST),ui=path.join(work,'host-B',HOST)
  await command('api-official-build','npm',['run','build'],{cwd:api,env:buildEnv})
  await fs.access(path.join(api,'.medusa/server/medusa-config.js'))
  await command('ui-existing-admin-only-transform','node',[path.join(work,'host-B/acceptance/medusa/prepare-admin-static-config.mjs'),path.join(ui,'medusa-config.ts')],{env})
  await command('ui-official-admin-only-build','npm',['run','build','--','--admin-only'],{cwd:ui,env:buildEnv})
  if((await fs.stat(path.join(ui,'.medusa/admin/index.html'))).size===0)throw Error('EMPTY_ADMIN_BUILD')
  report.builds={api:true,adminOnly:true,docker:false}
  for(const [label,host] of [['api',api],['ui',ui]]){
   const result=await command(label+'-actual-provider-audit','node',[path.join(root,'test/medusa-package-acceptance/audit-closure.cjs'),host],{cwd:host,env:buildEnv})
   const audit=JSON.parse(result.text)
   report[label+'Closure']=audit
  }
  await record()
 }catch(error){report.error=error.message;await record();throw error}
 return report
}

export async function main(work){
 work=await validateWorkDirectory(work)
 await fs.mkdir(work,{mode:0o700})
 const env=cleanEnv(path.join(work,'home'),path.join(work,'npm-cache'))
 await fs.mkdir(env.HOME);await fs.mkdir(env.NPM_CONFIG_CACHE)
 const report={baseline:BASELINE,scope:'credential-free official registry installs, compile and packaging only; no Docker/DB/service/deploy',node:process.version,npm:(await run('npm',['--version'],{env})).text.trim(),packs:[],commands:[]}
 const record=async()=>fs.writeFile(path.join(work,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
 try{
  for(const label of ['A','B']){
   const directory=path.join(work,label);await fs.mkdir(directory)
   await sourceFiles(directory,[PLUGIN+'/package.json',PLUGIN+'/package-lock.json',PLUGIN+'/README.md',PLUGIN+'/tsconfig.json',PLUGIN+'/src'])
   const plugin=path.join(directory,PLUGIN),host=path.join(directory,HOST);await fs.mkdir(host,{recursive:true})
   console.log(label+': official plugin npm ci from empty node_modules/.medusa')
   await run('npm',['ci','--prefix',plugin,'--registry=https://registry.npmjs.org','--fetch-retries=1','--fetch-timeout=30000'],{env,log:path.join(work,label+'-plugin-ci.log')})
   console.log(label+': official plugin build with umask 077, then npm pack')
   await run('bash',['-c','umask 077; exec "$@"','--','npm','run','build','--prefix',plugin],{env,log:path.join(work,label+'-plugin-build.log')})
   await run('npm',['pack',plugin,'--pack-destination',host,'--json'],{env,log:path.join(work,label+'-pack.log')})
   const bytes=await fs.readFile(path.join(host,ARCHIVE))
   const manifest=await members(path.join(host,ARCHIVE))
   const versions={}
   for(const name of ['@medusajs/cli','@medusajs/framework','@medusajs/medusa','@swc/core','typescript'])versions[name]=JSON.parse(await fs.readFile(path.join(plugin,'node_modules',name,'package.json'))).version
   report.packs.push({label,bytes:bytes.length,sha256:hash(bytes),integrity:'sha512-'+hash(bytes,'sha512'),versions,members:manifest})
   await record()
  }
  const [a,b]=report.packs
  if(a.sha256!==b.sha256||a.integrity!==b.integrity||JSON.stringify(a.members)!==JSON.stringify(b.members))throw Error('NON_REPRODUCIBLE_ARCHIVES_STOP_BEFORE_LOCK_UPDATE')
  // Compare complete byte buffers as well as independent hashes and member manifests.
  if(!(await fs.readFile(path.join(work,'A',HOST,ARCHIVE))).equals(await fs.readFile(path.join(work,'B',HOST,ARCHIVE))))throw Error('ARCHIVE_BYTE_DIFFERENCE')
  report.reproducible=true;console.log('A/B: complete archive bytes and member manifests identical')
  await record()
 }catch(error){report.error=error.message;await record();throw error}
 return report
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const completing=process.argv[2]==='--complete',work=process.argv[completing?3:2]
 if(process.argv.length!==(completing?4:3)){console.error('Use [--complete] and one absolute private work-directory path.');process.exit(2)}
 try{await (completing?complete(work):main(work))}catch(error){console.error(error.message);process.exitCode=1}
}
