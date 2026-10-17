// Repository acceptance of the actual packed package outside the checkout. No install/network/hooks.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const root=path.join(repo,'plugins/workspace-erpnext-enterprise'),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'erpnext-enterprise-'));
function run(command,args,cwd,env={}){
  const child=spawnSync(command,args,{cwd,encoding:'utf8',maxBuffer:8*1024*1024,
    env:{PATH:process.env.PATH,HOME:temporary,NO_COLOR:'1',npm_config_cache:temporary+'/npm-cache',
      npm_config_userconfig:temporary+'/user.npmrc',npm_config_globalconfig:temporary+'/global.npmrc',...env}});
  if(child.status!==0)throw Error(`${command} ${args.join(' ')} failed (${child.status}): ${child.stderr}\n${child.stdout}`);
  return child.stdout;
}
try{
  run(process.execPath,['scripts/build.mjs'],root);
  for(const [directory,name]of [['workspace-free-trade','pi-free-trade'],['workspace-erpnext-enterprise','pi-erpnext-enterprise']]){
    const packageRoot=path.join(repo,'plugins',directory);
    const packed=JSON.parse(run('npm',['pack','--offline','--ignore-scripts','--json','--pack-destination',temporary],packageRoot))[0];
    const destination=path.join(temporary,'node_modules/@workspace-agent',name);await fs.mkdir(destination,{recursive:true});
    run('tar',['-xzf',path.join(temporary,packed.filename),'--strip-components=1','-C',destination],temporary);
    const manifest=JSON.parse(await fs.readFile(path.join(destination,'package.json'),'utf8'));
    for(const file of packed.files){
      const actual=await fs.readFile(path.join(destination,file.path));
      const source=await fs.readFile(path.join(packageRoot,file.path));
      if(!actual.equals(source))throw Error('PACKED_BYTES_DIFFER: '+file.path);
    }
    for(const file of [...Object.values(manifest.exports),...manifest.pi.skills.map(s=>s+'/SKILL.md'),'README.md','AGENTS.md'])await fs.access(path.join(destination,file));
    console.log(JSON.stringify({packed:manifest.name,version:manifest.version,files:packed.files.length,sourceBytesMatch:true}));
  }
  const env={ERP_ADAPTER_PACKAGE_URL:pathToFileURL(temporary+'/node_modules/@workspace-agent/pi-erpnext-enterprise/').href,
    ERP_ADAPTER_REPO_ROOT:repo,ERP_ADAPTER_EXTERNAL_ROOT:temporary};
  const tests=(await fs.readdir(path.join(repo,'test/erpnext-enterprise-adapter'))).filter(f=>f.endsWith('.test.mjs')).map(f=>path.join(repo,'test/erpnext-enterprise-adapter',f));
  process.stdout.write(run(process.execPath,['--test',...tests],temporary,env));
  console.log(JSON.stringify({status:'passed',node:process.version,externalPackedImport:true,realErpNext:false,
    actualPiOmpSdk:false,paidCalls:0,externalBusinessWrites:0}));
}finally{await fs.rm(temporary,{recursive:true,force:true});}
