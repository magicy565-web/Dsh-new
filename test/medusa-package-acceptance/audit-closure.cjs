// Loads native configuration and exports only. No bootstrap, services or DB.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{createHash}=require('node:crypto');
const host=path.resolve(process.argv[2]);process.chdir(host);
const native=createRequire(path.join(host,'package.json'));
native('ts-node').register({transpileOnly:true,compilerOptions:{module:'CommonJS',moduleResolution:'Node',ignoreDeprecations:'6.0'}});
const config=native(path.join(host,'medusa-config.ts'));
const {getResolvedPlugins}=native('@medusajs/framework/utils');
const sdkRoot=path.dirname(native.resolve('@medusajs/modules-sdk/package.json'));
const {resolveModuleExports}=native(path.join(sdkRoot,'dist/loaders/utils/load-internal.js'));
const digest=file=>createHash('sha256').update(fs.readFileSync(path.join(host,file))).digest('hex');
async function main(){
 const entries=[],disabledModules=[];
 async function inspect(kind,key,resolve){
  if(typeof resolve!=='string')throw Error('UNREVIEWED_NON_STRING_RESOLUTION');
  const resolutionPath=native.resolve(resolve);
  const loaded=await resolveModuleExports({resolution:{resolutionPath,definition:{key,isRequired:false}}});
  if(loaded.error)throw loaded.error;
  if(!loaded.discoveryPath)throw Error('NATIVE_DISCOVERY_PATH_REQUIRED');
  const discoveryPath=path.relative(host,loaded.discoveryPath).split(path.sep).join('/');
  if(!discoveryPath.startsWith('node_modules/'))throw Error('RESOLUTION_OUTSIDE_INSTALLED_HOST');
  const migrationDirectory=path.posix.join(path.posix.dirname(discoveryPath),'migrations');
  entries.push({kind,key,resolve,discoveryPath,migrationDirectory,exists:fs.existsSync(path.join(host,migrationDirectory)),customMigrations:Boolean(loaded.migrations)});
 }
 for(const [key,module] of Object.entries(config.modules)){
  if(module===false||module.disable){disabledModules.push(key);continue}
  if(key==='link')continue; // Native link synchronization has a separate DB planner.
  await inspect('module',key,module.resolve);
  for(const provider of module.options?.providers??[])await inspect('provider',key+'/'+provider.id,provider.resolve);
 }
 const plugins=await getResolvedPlugins(host,config,false);
 for(const plugin of plugins)for(const module of plugin.modules??[]){
  const key=path.basename(module.resolve);
  await inspect('plugin-module',key,module.resolve);
 }
 const result={sdk:JSON.parse(fs.readFileSync(path.join(host,'node_modules/@medusajs/framework/package.json'))).version,modules:entries.filter(e=>e.kind==='module').length,providers:entries.filter(e=>e.kind==='provider').length,pluginModules:entries.filter(e=>e.kind==='plugin-module').length,plugins:plugins.map(p=>p.name),entries,missing:entries.filter(e=>!e.exists&&!e.customMigrations).map(e=>e.migrationDirectory),disabledModules,defaultRequiredModulesChecked:['event_bus','cache'],sourceSHA256:{'apps/medusa-acceptance/medusa-config.ts':digest('medusa-config.ts'),'apps/medusa-acceptance/package-lock.json':digest('package-lock.json')},admin:config.admin,scope:'Actual installed official defineConfig/getResolvedPlugins/resolveModuleExports; no bootstrap, DB connection or environment file'};
 for(const key of result.defaultRequiredModulesChecked)if(!entries.some(e=>e.key===key))throw Error('MISSING_DEFAULT_REQUIRED_MODULE');
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
