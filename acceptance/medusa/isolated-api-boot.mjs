// Temporary acceptance assembly only. Invoked in a future explicitly approved
// container; no account/secret generation and no package installation.
import fs from 'node:fs'
import {spawn} from 'node:child_process'

export const MIGRATION_MODULES=['auth-emailpass','fulfillment-manual','notification-local','cache-inmemory','event-bus-redis','locking','locking-redis','file','file-local','caching','caching-redis']
export function databaseName(value){
 if(!/^medusa_live_[a-z0-9_]{8,80}$/.test(value??''))throw Error('ISOLATED_DATABASE_NAME_REQUIRED')
 return value
}
export function secretValue(value){
 const text=value.trim()
 if(!/^[a-f0-9]{64}$/.test(text))throw Error('OPERATOR_SERVICE_SECRET_REQUIRED')
 return text
}
export async function boot(){
 const database=databaseName(process.env.MEDUSA_TEST_DATABASE)
 if(process.env.MEDUSA_TEMP_SERVICE_APPROVAL!=='ISOLATED_TEMP_ONLY')throw Error('OPERATOR_APPROVAL_REQUIRED')
 fs.cpSync('/fixture/server','/app',{recursive:true,dereference:false})
 fs.cpSync('/fixture/node_modules','/app/node_modules',{recursive:true,dereference:false})
 for(const module of MIGRATION_MODULES){
  const directory='/app/node_modules/@medusajs/'+module+'/dist'
  if(!fs.statSync(directory).isDirectory())throw Error('EXPECTED_OFFICIAL_MODULE_REQUIRED')
  fs.mkdirSync(directory+'/migrations',{recursive:true})
 }
 const secret=name=>secretValue(fs.readFileSync('/run/secrets/'+name,'utf8'))
 Object.assign(process.env,{
  DATABASE_URL:'postgres://medusa:'+secret('postgres_password')+'@127.0.0.1:5432/'+database,
  REDIS_URL:'redis://:'+secret('redis_password')+'@127.0.0.1:6379',
  JWT_SECRET:secret('jwt_secret'),COOKIE_SECRET:secret('cookie_secret'),
  AGENT_CONTEXT_READ_TOKEN:secret('agent_context_read_token'),MEDUSA_DISABLE_TELEMETRY:'true',
 })
 process.chdir('/app')
 async function run(args){
  const child=spawn('/app/node_modules/.bin/medusa',args,{stdio:'inherit',env:process.env})
  const interrupt=()=>child.kill('SIGINT'),terminate=()=>child.kill('SIGTERM')
  process.once('SIGINT',interrupt);process.once('SIGTERM',terminate)
  try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('NATIVE_MEDUSA_COMMAND_FAILED')))})}
  finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate)}
 }
 await run(['db:migrate'])
 await run(['start','--host','127.0.0.1'])
}
if(process.argv[1]==='/plan/api-boot.mjs')boot().catch(()=>{console.error('TEMPORARY_MEDUSA_START_REFUSED');process.exitCode=1})
