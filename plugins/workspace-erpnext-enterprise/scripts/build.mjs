// Native ESM package: no transpilation or generated client. Validate distributable source/manifest.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {isBuiltin} from 'node:module';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))+path.sep;
if(Number(process.versions.node.split('.')[0])<24)throw Error('NODE_24_REQUIRED');
const manifest=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const required=['README.md','AGENTS.md','skills/erpnext-enterprise/SKILL.md',...Object.values(manifest.exports)];
for(const file of required)await fs.access(path.join(root,file));
for(const file of await fs.readdir(path.join(root,'src'))){
  const target=path.join(root,'src',file),source=await fs.readFile(target,'utf8');
  const check=spawnSync(process.execPath,['--check',target],{encoding:'utf8'});
  if(check.status!==0)throw Error(check.stderr);
  for(const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)){
    const spec=match[1];
    if(spec.startsWith('.')){
      const resolved=path.resolve(root,'src',spec);
      if(!resolved.startsWith(root))throw Error('IMPORT_OUTSIDE_PACKAGE');await fs.access(resolved);
    }else if(!isBuiltin(spec)&&!Object.hasOwn(manifest.peerDependencies,spec.split('/').slice(0,2).join('/')))throw Error('UNDECLARED_IMPORT');
  }
}
console.log(JSON.stringify({status:'passed',build:'native-esm-syntax-and-manifest',node:process.version,transpilationRequired:false}));
