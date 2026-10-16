// Trusted project path selection only. OMP remains the discovery/module loader.
// No module evaluation, ambient scan, install hooks, account or model access.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const DEFAULT_PLUGIN_ROOT = fileURLToPath(new URL('../plugins/', import.meta.url));
const refuse = () => { throw Error('PROJECT_PLUGIN_CONFIGURATION_REFUSED'); };
async function localFile(root, relative, directory = false) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) refuse();
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) refuse();
  let current = root;
  for (const part of path.relative(root,file).split(path.sep)) {
    current = path.join(current,part); const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) refuse();
  }
  const stat = await fs.stat(file); if (directory ? !stat.isDirectory() : !stat.isFile()) refuse();
  return file;
}
export async function projectPlugins({ root = DEFAULT_PLUGIN_ROOT, disabled = [], none = false } = {}) {
  root = path.resolve(root);
  if ((await fs.lstat(root)).isSymbolicLink() || await fs.realpath(root) !== root) refuse();
  const config = JSON.parse(await fs.readFile(await localFile(root,'config.json'),'utf8'));
  if (Object.keys(config).some(k=>!['extensions','disabledExtensions'].includes(k)) || !Array.isArray(config.extensions)
    || !Array.isArray(config.disabledExtensions) || [...config.extensions,...config.disabledExtensions,...disabled].some(v=>typeof v!=='string')) refuse();
  const disabledNames = new Set([...config.disabledExtensions,...disabled].map(v=>v.replace(/^extension-module:/,'')));
  const installed = [];
  for (const entry of await fs.readdir(root,{withFileTypes:true})) {
    if (entry.isSymbolicLink()) refuse(); if (!entry.isDirectory()) continue;
    const directory = await localFile(root,entry.name,true);
    let manifest; try { manifest=JSON.parse(await fs.readFile(await localFile(directory,'package.json'),'utf8')); }
    catch(error) { if (error.code==='ENOENT') continue; throw error; }
    const pi = manifest.omp || manifest.pi;
    if (!pi || !Array.isArray(pi.extensions) || !pi.extensions.length || !Array.isArray(pi.skills)) refuse();
    const extensions = await Promise.all(pi.extensions.map(p=>localFile(directory,p)));
    const skills = await Promise.all(pi.skills.map(p=>localFile(directory,p,true)));
    for (const resource of ['README.md','AGENTS.md']) await localFile(directory,resource);
    for (const skill of skills) await localFile(skill,'SKILL.md');
    const enabled = !none && config.extensions.some(p=>path.resolve(root,p)===directory) && !disabledNames.has(entry.name) && !disabledNames.has(manifest.name);
    installed.push({ name:manifest.name, directory, id:entry.name, enabled, extensions, skills, manifest });
  }
  // Missing disabled/unselected packages are not dependencies. An explicitly
  // requested, non-disabled missing entry is a useful configuration error.
  for (const p of config.extensions) {
    if (!/^\.\/[A-Za-z0-9][A-Za-z0-9_-]*$/.test(p)) refuse();
    const id=p.slice(2);
    if (!none && !disabledNames.has(id) && !installed.some(plugin=>plugin.id===id)) {
      throw Object.assign(new Error('Enabled plugin ' + id + ' is missing; reinstall it, remove its enabled path, or explicitly disable it.'),
        {code:'PROJECT_PLUGIN_REQUIRED',pluginId:id,pluginEntry:'package.json'});
    }
  }
  const enabled=installed.filter(p=>p.enabled);
  return { root, installed, enabled, paths:enabled.map(p=>p.directory), skills:enabled.flatMap(p=>p.skills) };
}
