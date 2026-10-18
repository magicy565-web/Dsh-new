// Node-only contract/file tests. No installed SDK substitute or provider request.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {enterpriseContextExtension,nativeDocumentParameterSchemas} from '../plugins/workspace-enterprise-context/src/extension.js';
import {businessBrainExtension} from '../plugins/workspace-goal-intelligence/src/extension.mjs';
import {createNativeDocumentTools} from '../server/workspace-native-document-tools.mjs';
import {projectPlugins} from '../server/workspace-plugin-config.mjs';
import {prepareNativeDocumentHandbooks,bindNativeDocumentHandbooks} from '../server/workspace-omp-session.mjs';
const queries=[{subjectType:'product',subjectId:'bottle',factKey:'moq'},{subjectType:'customer',subjectId:'buyer',factKey:'packaging'}];
const capabilities=()=>({schema:'workspace.native-document-capabilities.v1',methods:['parseUpload','structuredMemoryLookup','structuredMemoryRemember'],queries:structuredClone(queries),sources:[0,1].map(i=>({documentId:'synthetic-document-'+i,revision:1,documentVersion:1,asset:{artifactId:'synthetic-upload-'+i,version:i+1,sha256:String(i).repeat(64)}}))});
const tuple=(schema,index=0)=>Object.fromEntries(Object.entries(schema.oneOf[index].properties).map(([key,value])=>[key,value.const]));
const matches=(schema,input)=>schema.oneOf.filter(branch=>Object.entries(branch.properties).every(([key,value])=>input[key]===value.const)).length===1;

test('model-visible schemas discover whole selected tuples without a Cartesian grant',()=>{
 const metadata=capabilities(),tools=[];enterpriseContextExtension({enabledMethods:metadata.methods,nativeCapabilities:metadata})({registerTool:tool=>tools.push(tool)});
 assert.equal(tools.length,3);const parse=tools.find(t=>t.name.endsWith('parse_upload')).parameters,remember=tools.find(t=>t.name.endsWith('memory_remember')).parameters;
 assert.deepEqual(tuple(parse),metadata.sources[0].asset);assert.deepEqual(tuple(remember),queries[0]);
 assert.equal(matches(parse,{...tuple(parse),version:tuple(parse,1).version}),false);
 assert.equal(matches(remember,{...tuple(remember),factKey:tuple(remember,1).factKey}),false);
 assert.equal(remember.properties.statement.maxLength,4000);assert.equal(remember.additionalProperties,false);
 assert.ok(!JSON.stringify(tools).includes('memory_search'));assert.ok(!JSON.stringify(tools).includes('statement content'));
});
test('projection refuses extra fields, unselected methods and malformed tuple metadata',()=>{
 for(const change of [c=>c.methods.push('memorySearch'),c=>c.credential='private',c=>c.sources[0].asset.version=0,c=>c.sources[0].extra='text',c=>c.queries[0].statement='private',c=>c.queries=[]]){
  const c=capabilities();change(c);assert.throws(()=>nativeDocumentParameterSchemas(c),/OSS_NATIVE_DOCUMENT_CAPABILITIES_REFUSED/);
 }
 const c=capabilities();assert.throws(()=>enterpriseContextExtension({nativeCapabilities:c,enabledMethods:['parseUpload']}));
});
test('only currently exposed methods are registered; ordinary standalone schemas remain unchanged',()=>{
 const c=capabilities();c.methods=['structuredMemoryLookup'];const tools=[];
 enterpriseContextExtension({nativeCapabilities:c,enabledMethods:c.methods})({registerTool:t=>tools.push(t)});assert.equal(tools.length,1);assert.ok(tools[0].name.endsWith('lookup'));
 const defaults=[];enterpriseContextExtension()({registerTool:t=>defaults.push(t)});assert.equal(defaults.length,7);assert.equal(defaults[1].parameters.oneOf,undefined);
});
test('facade metadata awaits original authority and repeats the complete synchronous disclosure check',async()=>{
 const order=[],metadata=capabilities();delete metadata.queries;
 let revoked=false;const control={assertDisclosureCurrent:()=>{order.push('current');if(revoked)throw Error('revoked');}};
 const selected=structuredClone(queries),facade=createNativeDocumentTools(control,selected,async()=>{order.push('authority');return metadata;});selected[0].factKey='mutated';
 const visible=await facade.describe();assert.deepEqual(visible.queries,queries);assert.deepEqual(order,['authority','current']);
 revoked=true;await assert.rejects(facade.describe(),/revoked/);
});
async function handbooks(t){
 const directory=await fs.mkdtemp('/tmp/native-handbooks-');t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const selected=await projectPlugins({configuration:'config.business.json',disabled:['workspace-factory-materials','workspace-market-validation','workspace-shopify-product','workspace-medusa-catalog','workspace-marketplace']});
 assert.deepEqual(selected.enabled.map(p=>p.id),['workspace-goal-intelligence']);
 const root=path.join(directory,'plugins');await fs.mkdir(root);
 const installed=[];for(const p of selected.installed.filter(p=>['workspace-goal-intelligence','workspace-enterprise-context'].includes(p.id))){
  const target=path.join(root,p.id);await fs.cp(p.directory,target,{recursive:true});installed.push({...p,directory:target,skills:p.skills.map(s=>path.join(target,path.relative(p.directory,s)))});
 }
 const plugins={...selected,root,installed,skills:installed.filter(p=>p.enabled).flatMap(p=>p.skills)};
 const skillRoot=path.join(directory,'selected');await fs.mkdir(skillRoot);return {directory,plugins,skillRoot,pins:await prepareNativeDocumentHandbooks(plugins,skillRoot)};
}
test('selected enterprise handbook loads alongside Brain without enabling its extension',async t=>{
 const {plugins,pins}=await handbooks(t);assert.deepEqual(plugins.enabled.map(p=>p.id),['workspace-goal-intelligence']);
 assert.deepEqual(pins.files.map(f=>f.pluginId).sort(),['workspace-enterprise-context','workspace-goal-intelligence']);
 for(const file of pins.files){assert.ok(file.packageVersion);assert.ok(!path.isAbsolute(file.path));assert.equal(file.sha256,createHash('sha256').update(await fs.readFile(path.join(plugins.root,file.path))).digest('hex'));}
 pins.assertCurrent();assert.equal(plugins.enabled.flatMap(p=>p.extensions).some(p=>p.includes('workspace-enterprise-context')),false);
});
test('handbook checks reject changed source, copied bytes and package metadata before use',async t=>{
 for(const target of ['source','copy','package']){const {pins,plugins,skillRoot}=await handbooks(t),first=pins.files[0];
  const file=target==='source'?path.join(plugins.root,first.path):target==='copy'?path.join(skillRoot,'plugin-0','SKILL.md'):path.join(plugins.root,first.pluginId,'package.json');
  await fs.appendFile(file,'\nchanged');assert.throws(()=>pins.assertCurrent(),/NATIVE_DOCUMENT_HANDBOOK_CHANGED/);
 }
});
test('new handbook Session entry pins exact names, versions, hashes and capabilities; no implicit resume upgrade',async t=>{
 const {pins}=await handbooks(t),entries=[],manager={getEntries:()=>entries,appendCustomEntry:(customType,data)=>entries.push({type:'custom',customType,data}),flush:async()=>{}};
 const names=['enterprise-business-brain','enterprise-context'],c=capabilities();
 const first=await bindNativeDocumentHandbooks(manager,pins,names,c,false);assert.equal(entries.length,1);
 assert.deepEqual(await bindNativeDocumentHandbooks(manager,pins,names,c,true),first);assert.equal(entries.length,1);
 const changed=capabilities();changed.queries[0].factKey='changed';await assert.rejects(bindNativeDocumentHandbooks(manager,pins,names,changed,true));
 await assert.rejects(bindNativeDocumentHandbooks({...manager,getEntries:()=>[]},pins,names,c,true));assert.equal(entries.length,1);
});
test('Brain guidance permits clarification and selective tools rather than a mandatory first call',async()=>{
 let handler;businessBrainExtension()({registerTool:()=>{},on:(event,fn)=>{assert.equal(event,'before_agent_start');handler=fn;}});
 const result=await handler({messageType:'user',systemPrompt:'Original policy'});assert.ok(result.systemPrompt.startsWith('Original policy'));
 assert.ok(result.systemPrompt.includes('workspace_skill'));assert.ok(result.systemPrompt.includes('You may answer, clarify or stop without a tool'));
 assert.ok(!result.systemPrompt.includes('first inspect'));assert.equal(await handler({messageType:'system',systemPrompt:'Original policy'}),undefined);
});
