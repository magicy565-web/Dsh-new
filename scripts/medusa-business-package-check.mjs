// Current working-tree package reproducibility. Uses already installed locked
// dependencies; does not claim two independent clean registry installations.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import {cleanEnv,members,inspectProtocol,assertLockDelta} from './medusa-package-acceptance.mjs'
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url))
const plugin=path.join(root,'packages/medusa-enterprise-product-context')
const work=await fs.mkdtemp(path.join(os.tmpdir(),'medusa-business-package-'))
const dependencies=await fs.realpath(path.join(plugin,'node_modules'))
const env=cleanEnv(path.join(work,'home'),path.join(work,'cache'))
await fs.mkdir(env.HOME);await fs.mkdir(env.NPM_CONFIG_CACHE)
const report={schema_version:'workspace-medusa-business-package/1',dependency_mode:'reuse installed dependencies; two clean source/build directories, not independent npm ci',node:process.version,packs:[]}
const hash=(bytes,algorithm='sha256',encoding='hex')=>createHash(algorithm).update(bytes).digest(encoding)
const installedLock=JSON.parse(await fs.readFile(path.join(dependencies,'.package-lock.json'),'utf8'))
const sourceLock=JSON.parse(await fs.readFile(path.join(plugin,'package-lock.json'),'utf8'))
for(const [name,entry] of Object.entries(installedLock.packages)){
 const expected=sourceLock.packages[name]
 if(!expected||expected.version!==entry.version||expected.integrity!==entry.integrity)throw Error('Installed dependency differs from locked source: '+name)
}
for(const label of ['A','B']){
 const directory=path.join(work,label);await fs.mkdir(directory)
 for(const name of ['src','package.json','package-lock.json','README.md','tsconfig.json'])await fs.cp(path.join(plugin,name),path.join(directory,name),{recursive:true})
 for(const name of ['package.json','package-lock.json','README.md'])await fs.chmod(path.join(directory,name),0o600)
 await fs.symlink(dependencies,path.join(directory,'node_modules'),'dir')
 const previousMask=process.umask(0o077)
 try{await exec('npm',['run','build'],{cwd:directory,env,maxBuffer:10*1024*1024})}finally{process.umask(previousMask)}
 const result=await exec('npm',['pack','--json','--pack-destination',directory],{cwd:directory,env,maxBuffer:10*1024*1024})
 const filename=JSON.parse(result.stdout)[0].filename,archive=path.join(directory,filename),bytes=await fs.readFile(archive)
 const protocol=await inspectProtocol(archive)
 const listing=await members(archive)
 for(const required of ['business-contract.js','business-routes.js','api/admin/workspace-business/v1/products/[id]/route.js','api/admin/workspace-business/v1/products/[id]/summary/route.js']){
  if(!listing.some(m=>m.path==='package/.medusa/server/src/'+required))throw Error('Missing business route in archive: '+required)
 }
 report.packs.push({label,filename,bytes:bytes.length,sha256:hash(bytes),integrity:'sha512-'+hash(bytes,'sha512','base64'),members:listing,original_protocol:protocol})
 console.log(label+': built and packed current source')
}
const [a,b]=report.packs
if(a.sha256!==b.sha256||JSON.stringify(a.members)!==JSON.stringify(b.members))throw Error('Package bytes or member metadata differ')
if(!(await fs.readFile(path.join(work,'A',a.filename))).equals(await fs.readFile(path.join(work,'B',b.filename))))throw Error('Complete archive bytes differ')
report.reproducible=true
const host=path.join(work,'host');await fs.mkdir(host)
for(const name of ['package.json','package-lock.json'])await fs.copyFile(path.join(root,'apps/medusa-acceptance',name),path.join(host,name))
await fs.copyFile(path.join(work,'A',a.filename),path.join(host,a.filename))
const before=JSON.parse(await fs.readFile(path.join(host,'package-lock.json'),'utf8'))
await exec('npm',['install','--package-lock-only','--ignore-scripts','--registry=https://registry.npmjs.org','--fetch-retries=1','--fetch-timeout=30000','./'+a.filename],{cwd:host,env,maxBuffer:10*1024*1024})
const after=JSON.parse(await fs.readFile(path.join(host,'package-lock.json'),'utf8'))
// On subsequent verification the committed lock may already match this archive.
if(before.packages['node_modules/@magicy565/medusa-enterprise-product-context'].integrity===a.integrity){
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Unexpected lock drift on verification')
 report.lock_delta={already_matches:true}
}else report.lock_delta=assertLockDelta(before,after,a.integrity)
await fs.writeFile(path.join(work,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
console.log('Verified package report: '+path.join(work,'report.json'))
