// Preparation/verification only: never invokes Docker, builds, installs or secrets.
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {validateWorkDirectory} from './medusa-package-acceptance.mjs'
import {MIGRATION_MODULES,databaseName} from '../acceptance/medusa/isolated-api-boot.mjs'
export const INTEGRATION='1b788561a6f8e63da9ffecf6f81d0c311d20c721'
const ROOT=fileURLToPath(new URL('../',import.meta.url)),SELF=fileURLToPath(import.meta.url)
export const IMAGES={PG_IMAGE:'docker.io/library/postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24',REDIS_IMAGE:'docker.io/library/redis:7.4-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499',NODE_IMAGE:'docker.io/library/node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df'}
const PLUGIN='packages/medusa-enterprise-product-context',HOST='apps/medusa-acceptance',LOCAL='node_modules/@magicy565/medusa-enterprise-product-context'
const secretNames=['postgres_password','redis_password','jwt_secret','cookie_secret','agent_context_read_token']
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const git=(...args)=>execFileSync('git',args,{cwd:ROOT,maxBuffer:4*1024*1024,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']})
const original=name=>git('show',INTEGRATION+':'+name)
export function config(value){
 if(!value||Object.keys(value).sort().join(',')!=='artifactHost,integrationSha,pluginSource,runId,secretDirectory'||value.integrationSha!==INTEGRATION||!/^medusa-live-[a-z0-9-]{8,48}$/.test(value.runId??''))throw Error('PINNED_NON_SECRET_CONFIGURATION_REQUIRED')
 for(const key of ['artifactHost','pluginSource','secretDirectory'])if(typeof value[key]!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(value[key])||path.resolve(value[key])!==value[key])throw Error('CANONICAL_SAFE_PATH_REQUIRED')
 return {...value,database:databaseName(value.runId.replaceAll('-','_'))}
}
async function regular(file){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('REGULAR_INPUT_FILE_REQUIRED');return fs.readFile(file)}
async function outside(directory,existing){return validateWorkDirectory(directory,{existing})}
export async function inspect(input){
 const c=config(input)
 await outside(c.artifactHost,true);await outside(c.pluginSource,true)
 try{await fs.lstat(c.secretDirectory);await outside(c.secretDirectory,true)}catch(error){if(error.code!=='ENOENT')throw error;await outside(c.secretDirectory,false)}
 const proof={integrationSha:INTEGRATION,checkedFiles:{},scope:'Medusa subset compatible with integration; not Library/Host end-to-end acceptance'}
 const pluginFiles=git('ls-tree','-r','--name-only',INTEGRATION,'--',PLUGIN+'/src',PLUGIN+'/package.json',PLUGIN+'/package-lock.json',PLUGIN+'/tsconfig.json',PLUGIN+'/README.md').toString().trim().split('\n')
 for(const name of pluginFiles){
  const relative=name.slice(PLUGIN.length+1),bytes=await regular(path.join(c.pluginSource,relative))
  if(!bytes.equals(original(name)))throw Error('STAGED_PLUGIN_SOURCE_DIFFERS: '+relative)
  proof.checkedFiles[name]=digest(bytes)
 }
 for(const name of ['package.json','package-lock.json','medusa-config.ts','tsconfig.json']){
  const bytes=await regular(path.join(c.artifactHost,name));if(!bytes.equals(original(HOST+'/'+name)))throw Error('HOST_SOURCE_DIFFERS: '+name)
  proof.checkedFiles[HOST+'/'+name]=digest(bytes)
 }
 const liveFiles=git('ls-tree','-r','--name-only',INTEGRATION,'--','scripts/medusa-catalog-live-smoke.mjs','test/medusa-live-acceptance','plugins/workspace-medusa-catalog/src/approved-source.mjs','acceptance/medusa/wait-for-http.mjs').toString().trim().split('\n')
 for(const name of liveFiles){const bytes=await regular(path.join(ROOT,name));if(!bytes.equals(original(name)))throw Error('INTEGRATED_READER_OR_DRIVER_CHANGED');proof.checkedFiles[name]=digest(bytes)}
 const audit=JSON.parse(original('docs/validation/omp-medusa-provider-closure-20261017.json'))
 const migrationList=audit.entries.filter(e=>!e.exists&&!e.customMigrations).map(e=>/^node_modules\/@medusajs\/([^/]+)\/dist\/migrations$/.exec(e.migrationDirectory)?.[1]).sort()
 if(JSON.stringify(migrationList)!==JSON.stringify([...MIGRATION_MODULES].sort()))throw Error('NATIVE_MIGRATION_CLOSURE_CHANGED')
 const docker=original('acceptance/medusa/api.Dockerfile').toString()
 if(JSON.stringify(/for module in ([^;]+); do/.exec(docker)?.[1].split(/\s+/).sort())!==JSON.stringify(migrationList))throw Error('DOCKER_PREPARATION_DIFFERS')
 for(const image of Object.values(IMAGES)){const pin=image.replace('docker.io/library/','');if(!original(image.includes('node:')?'acceptance/medusa/api.Dockerfile':'acceptance/medusa/compose.yaml').toString().includes(pin))throw Error('FIXED_IMAGE_DIFFERS')}
 const archive=await regular(path.join(c.artifactHost,'magicy565-medusa-enterprise-product-context-0.1.0.tgz'))
 const sri='sha512-'+createHash('sha512').update(archive).digest('base64')
 const lock=JSON.parse(await regular(path.join(c.artifactHost,'package-lock.json')))
 const installed=JSON.parse(await regular(path.join(c.artifactHost,'node_modules/.package-lock.json')))
 if(sri!==audit.reproduciblePackage.archiveA.integrity||lock.packages[LOCAL].integrity!==sri||installed.packages[LOCAL].integrity!==sri)throw Error('ARCHIVE_IDENTITY_DIFFERS')
 for(const member of audit.reproduciblePackage.members){const name=member.path.replace(/^package\//,'');if(digest(await regular(path.join(c.artifactHost,LOCAL,name)))!==member.sha256)throw Error('INSTALLED_PLUGIN_MEMBER_DIFFERS')}
 const compiled=await regular(path.join(c.artifactHost,'.medusa/server/medusa-config.js'))
 proof.archive={bytes:archive.length,sha256:digest(archive),integrity:sri,members:audit.reproduciblePackage.members.length}
 proof.compiledConfigSHA256=digest(compiled);proof.migrationModules=MIGRATION_MODULES
 return proof
}
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
function environment(c){return Object.entries({RUN_ID:c.runId,DATABASE:c.database,ARTIFACT:c.artifactHost,SECRETS:c.secretDirectory,SOURCE:path.resolve(ROOT),...IMAGES}).map(([key,value])=>key+'='+quote(value)).join('\n')+'\n'}
export async function prepare(input,directory){
 await outside(directory,false)
 const c=config(input),proof=await inspect(input)
 for(const source of [c.artifactHost,c.pluginSource,c.secretDirectory])if(directory===source||directory.startsWith(source+'/')||source.startsWith(directory+'/'))throw Error('PREPARATION_DIRECTORY_MUST_BE_SEPARATE')
 await fs.mkdir(directory,{mode:0o700})
 const files={'run.sh':await regular(path.join(ROOT,'acceptance/medusa/isolated-plan.sh')),'api-boot.mjs':await regular(path.join(ROOT,'acceptance/medusa/isolated-api-boot.mjs')),'env.sh':Buffer.from(environment(c)),'config.json':Buffer.from(JSON.stringify(input,null,2)+'\n')}
 for(const [name,bytes] of Object.entries(files))await fs.writeFile(path.join(directory,name),bytes,{mode:name==='run.sh'?0o500:0o400})
 const manifest={proof,files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,digest(bytes)])),preparerSHA256:digest(await regular(SELF))}
 await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o400})
 const verifier=`import fs from 'node:fs/promises';import{createHash}from'node:crypto';const file=${JSON.stringify(SELF)};if(createHash('sha256').update(await fs.readFile(file)).digest('hex')!==${JSON.stringify(manifest.preparerSHA256)})throw Error('PREPARER_CHANGED');const{verify}=await import(${JSON.stringify(pathToFileURL(SELF).href)});await verify(process.argv[2],process.argv[3]);\n`
 await fs.writeFile(path.join(directory,'verify.mjs'),verifier,{mode:0o400})
 await fs.writeFile(path.join(directory,'README.txt'),'PREPARED ONLY. Approval, all three fixed images and operator-provided secrets are missing gates.\nNo Docker operation has been performed.\nFuture: MEDUSA_TEMP_SERVICE_APPROVAL=ISOLATED_TEMP_ONLY bash '+directory+'/run.sh start|accept|cleanup\nAccept requires separately authorized temporary Medusa Admin authentication and reviewed stdin live config.\n',{mode:0o400})
 return manifest
}
export async function verify(directory,mode){
 if(!['start','accept','cleanup'].includes(mode))throw Error('EXPLICIT_MODE_REQUIRED')
 await outside(directory,true)
 const state=await fs.lstat(directory)
 if(state.uid!==process.getuid()||(state.mode&0o077))throw Error('PRIVATE_PREPARATION_DIRECTORY_REQUIRED')
 try{await fs.lstat(path.join(directory,'docker-config'));throw Error('AMBIENT_DOCKER_CONFIGURATION_REFUSED')}catch(error){if(error.code!=='ENOENT')throw error}
 const input=JSON.parse(await regular(path.join(directory,'config.json'))),c=config(input)
 const manifest=JSON.parse(await regular(path.join(directory,'manifest.json')))
 if(Object.keys(manifest.files??{}).sort().join(',')!=='api-boot.mjs,config.json,env.sh,run.sh'||manifest.preparerSHA256!==digest(await regular(SELF)))throw Error('PREPARATION_MANIFEST_CHANGED')
 for(const [name,hash] of Object.entries(manifest.files)){if(!['run.sh','api-boot.mjs','env.sh','config.json'].includes(name)||digest(await regular(path.join(directory,name)))!==hash)throw Error('PREPARED_FILE_CHANGED')}
 if((await regular(path.join(directory,'env.sh'))).toString()!==environment(c))throw Error('NON_SECRET_ENV_CHANGED')
 for(const name of ['api','redis','pg','network']){
  try{const id=(await regular(path.join(directory,name+'.id'))).toString().trim();if(!/^[a-f0-9]{64}$/.test(id))throw Error('EXACT_ID_REQUIRED')}
  catch(error){if(error.code!=='ENOENT')throw error}
 }
 if(mode==='cleanup')return // Cleanup must remain possible if build inputs disappear.
 const proof=await inspect(input)
 if(JSON.stringify(proof)!==JSON.stringify(manifest.proof))throw Error('ARTIFACT_CHANGED_AFTER_PREPARATION')
 const parent=await fs.lstat(c.secretDirectory)
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||(parent.mode&0o077))throw Error('PRIVATE_OPERATOR_SECRET_DIRECTORY_REQUIRED')
 for(const name of secretNames){
  const stat=await fs.lstat(path.join(c.secretDirectory,name))
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o222)||(stat.mode&0o444)!==0o444||stat.size<64||stat.size>66)throw Error('OPERATOR_SECRET_FILE_METADATA_REQUIRED')
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===SELF){
 try{
  if(process.argv[2]!=='prepare'||process.argv.length!==4)throw Error('Use: prepare <new absolute directory>, non-secret JSON on stdin')
  const chunks=[];let bytes=0;const timer=setTimeout(()=>process.exit(2),10000);timer.unref()
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>8192)throw Error('NON_SECRET_CONFIG_LIMIT');chunks.push(chunk)}clearTimeout(timer)
  const result=await prepare(JSON.parse(Buffer.concat(chunks).toString('utf8')),process.argv[3]);console.log(JSON.stringify(result,null,2))
 }catch(error){console.error(error.message);process.exitCode=1}
}
