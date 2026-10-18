// Pinned native SDK and files only. Finite responses; no network fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {runLocalFactorySession} from '../../scripts/workspace-omp-local.mjs';
import {workspaceOmpPaths} from '../../server/workspace-omp-runtime.mjs';
import {loadWorkspaceOmpSdk} from '../../server/workspace-omp-session.mjs';
import {projectPlugins} from '../../server/workspace-plugin-config.mjs';
const expectedPluginIds = Object.freeze([
  "workspace-enterprise-context",
  "workspace-erpnext-enterprise",
  "workspace-factory-customers",
  "workspace-factory-ingestion",
  "workspace-factory-inquiries",
  "workspace-factory-materials",
  "workspace-free-trade",
  "workspace-goal-intelligence",
  "workspace-local-materials",
  "workspace-market-validation",
  "workspace-marketplace",
  "workspace-medusa-catalog",
  "workspace-plugin-info",
  "workspace-procurement",
  "workspace-shopify-product"
]);
globalThis.fetch = async () => { throw Error('CLOUD_ACCEPTANCE_NETWORK_FORBIDDEN'); };
const [mode, root] = process.argv.slice(2), paths = workspaceOmpPaths({});
if (mode === 'cancel' || mode === 'recover') {
  const directory = root + '/' + mode; await fs.mkdir(directory);
  const result = await runLocalFactorySession({directory, paths,
    configuration: {providerId:'explicit-cloud-finite', model:'finite', baseUrl:'https://synthetic.invalid'},
    options: {inputs:[root+'/product.md'], outputDirectory:root+'/out', sessionFile:root+'/conversation.jsonl',
      task:mode === 'cancel' ? 'Read the synthetic product, then save forbidden.md.' : 'Recover this Session and save recovered.md using the prior selected source.'},
    syntheticResponses: mode === 'cancel' ? [
      {tool:'read', arguments:{path:'input-1'}},
      {wait:30000, tool:'write', arguments:{path:'forbidden.md', content:'This must never be saved after cancellation.'}},
      {text:'Must never complete.'},
    ] : [
      {tool:'write', arguments:{path:'recovered.md', content:'Synthetic cup 500ml. Delivery and capacity pending.'}, expectedContextText:'Synthetic cloud acceptance cup'},
      {text:'Synthetic draft recovered; no sending or approval.'},
    ]});
  console.log(JSON.stringify(result));
} else if (mode === 'plugins') {
  const sdk = await loadWorkspaceOmpSdk(paths.packageRoot), results = [];
  const selection = await projectPlugins(), installed = selection.installed;
  assert.deepEqual(installed.map(plugin=>plugin.id).sort(), expectedPluginIds);
  assert.deepEqual(selection.enabled.map(plugin=>plugin.id), ['workspace-local-materials']);
  assert.equal(installed.find(plugin=>plugin.id==='workspace-erpnext-enterprise').enabled, false);
  for (const plugin of installed) {
    const folder = path.join(root, plugin.id); await fs.mkdir(folder);
    const target = path.join(folder, plugin.id); await fs.cp(plugin.directory, target, {recursive:true});
    await fs.writeFile(path.join(folder,'config.json'), JSON.stringify({extensions:['./'+plugin.id], disabledExtensions:[]}));
    const discover = async options => {
      const selection = await projectPlugins({root:folder,...options});
      const allowed = new Set(selection.enabled.flatMap(p=>p.extensions));
      return (await sdk.discoverExtensionPaths(selection.paths,root,undefined,{ambient:false})).filter(p=>allowed.has(p));
    };
    const files = await discover({}); assert.equal(files.length, plugin.extensions.length);
    const compiled = await Bun.build({entrypoints:files,target:'bun',format:'esm',packages:'external',write:false});
    assert.equal(compiled.success,true);
    const loaded = await sdk.loadExtensions(files,root); assert.deepEqual(loaded.errors,[]);
    assert.equal(loaded.extensions.length,plugin.extensions.length);
    const registeredTools = loaded.extensions.flatMap(e=>[...e.tools.keys()]);
    assert.equal((await discover({disabled:[plugin.id]})).length,0);
    assert.equal((await discover({none:true})).length,0);
    await fs.rm(target,{recursive:true});
    assert.equal((await discover({disabled:[plugin.id]})).length,0);
    await assert.rejects(discover({}), e=>e.code==='PROJECT_PLUGIN_REQUIRED' && e.pluginId===plugin.id);
    results.push({id:plugin.id, compiled:true, nativeDiscovered:true, nativeRegistered:true,
      disabledNotDiscovered:true, physicallyUninstalled:true, missingEnabledFailsClosed:true, registeredTools,
      businessConnection:plugin.id==='workspace-local-materials' ? 'selected synthetic local files only; no enterprise connection'
        : plugin.id==='workspace-plugin-info' ? 'identity only; no business connector' : 'unconfigured', businessToolsExecuted:0});
  }
  console.log(JSON.stringify({passed:true, plugins:results, realProviderRequests:0, externalBusinessRequests:0, mem0VectorRetrieval:false}));
} else throw Error('EXPLICIT_ACCEPTANCE_MODE_REQUIRED');
