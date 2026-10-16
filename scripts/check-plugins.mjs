#!/usr/bin/env node
// Static source/manifest/pack closure only. Never import extension factories.
import fs from 'node:fs/promises';
import path from 'node:path';
import {isBuiltin} from 'node:module';
import {spawnSync} from 'node:child_process';
import {projectPlugins} from '../server/workspace-plugin-config.mjs';
const plugins=await projectPlugins(),pack=process.argv.includes('--pack');
async function walk(root,relative=''){
  const output=[];
  for(const item of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
    const name=path.join(relative,item.name);if(item.isSymbolicLink())throw Error('PLUGIN_SYMLINK_REFUSED');
    if(item.isDirectory())output.push(...await walk(root,name));else if(item.isFile())output.push(name);
  }return output;
}
const results=[];
for(const plugin of plugins.installed){
  const {manifest,directory}=plugin,files=await walk(directory),required=new Set(['package.json','README.md','AGENTS.md']);
  if(manifest.scripts&&Object.keys(manifest.scripts).some(k=>/install|prepare|pack/.test(k)))throw Error('PLUGIN_INSTALL_HOOK_REFUSED');
  for(const resource of [...plugin.extensions,...plugin.skills.map(s=>path.join(s,'SKILL.md'))])required.add(path.relative(directory,resource));
  for(const entry of manifest.files||[]){const stat=await fs.stat(path.join(directory,entry));if(!stat.isDirectory()&&!stat.isFile())throw Error('PLUGIN_PACK_RESOURCE_INVALID');}
  const dependencies={...manifest.dependencies,...manifest.peerDependencies};
  for(const relative of files.filter(f=>/\.(?:js|mjs)$/.test(f))){
    required.add(relative);const filename=path.join(directory,relative),source=await fs.readFile(filename,'utf8');
    const syntax=spawnSync(process.execPath,['--check',filename],{encoding:'utf8'});if(syntax.status!==0)throw Error('PLUGIN_SYNTAX_INVALID: '+relative);
    for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)){
      const spec=match[1];
      if(spec.startsWith('.')){const target=path.resolve(path.dirname(filename),spec);
        if(!target.startsWith(directory+path.sep)||!(await fs.stat(target)).isFile())throw Error('PLUGIN_NOT_STANDALONE: '+relative);
        required.add(path.relative(directory,target));
      }else if(!isBuiltin(spec)){
        const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
        if(!Object.hasOwn(dependencies,name))throw Error('PLUGIN_UNDECLARED_DEPENDENCY: '+name);
      }
    }
    for(const match of source.matchAll(/new URL\(['"](\.[^'"]+)['"],\s*import\.meta\.url\)/g)){
      const target=path.resolve(path.dirname(filename),match[1]);if(!target.startsWith(directory+path.sep)||!(await fs.stat(target)).isFile())throw Error('PLUGIN_RESOURCE_MISSING');
      required.add(path.relative(directory,target));
    }
  }
  if(pack){
    const child=spawnSync('npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd:directory,encoding:'utf8',
      env:{PATH:process.env.PATH,HOME:'/tmp',NPM_CONFIG_CACHE:'/tmp/workspace-plugin-pack-cache',NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false'}});
    if(child.status!==0)throw Error('PLUGIN_PACK_FAILED: '+plugin.id);
    const included=new Set(JSON.parse(child.stdout)[0].files.map(f=>f.path));
    for(const file of required)if(!included.has(file))throw Error('PLUGIN_PACK_INCOMPLETE: '+plugin.id+'/'+file);
  }
  results.push({id:plugin.id,name:plugin.name,enabled:plugin.enabled,extensions:plugin.extensions.length,skills:plugin.skills.length,staticImportsChecked:true,packClosureChecked:pack});
}
console.log(JSON.stringify({status:'passed',staticOnly:true,plugins:results,modelRequests:0,businessToolsExecuted:0}));
