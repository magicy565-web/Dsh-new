// Native SDK file boundary checks; no model transport or HTTP Host.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createLocalFactoryFiles } from '../../server/workspace-omp-local-files.mjs';
const root=process.env.OMP_TEST_ROOT,packageRoot=process.env.OMP_TEST_PACKAGE;
const {Settings}=await import(pathToFileURL(packageRoot+'/src/config/settings.ts').href);
const settings=await Settings.init({cwd:root,agentDir:root,inMemory:true,overrides:{'startup.checkUpdate':false,'startup.setupWizard':false,'telemetry.otlpExportEnabled':false}});
await fs.mkdir(root+'/scratch');
const files=await createLocalFactoryFiles({inputs:[root+'/product.md'],outputDirectory:root+'/out',directory:root+'/scratch'});
try{
 const tools=await files.initialize({packageRoot,toolSession:{cwd:root,settings,enableLsp:false,getSessionId:()=> 'explicit-native-local-fixture',getArtifactsDir:()=>root}});
 const read=tools.find(t=>t.name==='read'),write=tools.find(t=>t.name==='write');
 await assert.rejects(read.execute('refused',{path:'/etc/passwd'}),/NOT_SELECTED/);
 await assert.rejects(write.execute('not-read',{path:'report.md',content:'No provenance'}),/REFUSED/);
 await read.execute('selected',{path:'input-1'});
 for(const target of ['../escape.md','/tmp/escape.md','nested/report.md','file://escape.md','sqlite://db/table','cfg://test','bad.json']) await assert.rejects(write.execute('bad',{path:target,content:'Synthetic draft'}),/REFUSED/);
 await fs.writeFile(root+'/outside.md','Do not alter this synthetic sentinel');await fs.symlink(root+'/outside.md',root+'/out/link.md');
 await assert.rejects(write.execute('symlink',{path:'link.md',content:'Refused overwrite'}));assert.equal(await fs.readFile(root+'/outside.md','utf8'),'Do not alter this synthetic sentinel');
 await fs.writeFile(root+'/out/existing.md','Existing synthetic report');await assert.rejects(write.execute('existing',{path:'existing.md',content:'Refused overwrite'}));
 assert.equal(await fs.readFile(root+'/out/existing.md','utf8'),'Existing synthetic report');
 await fs.rename(root+'/out',root+'/selected-output-moved');await fs.mkdir(root+'/replacement');await fs.symlink(root+'/replacement',root+'/out');
 await assert.rejects(write.execute('moved',{path:'refused.md',content:'No redirected output'}),/SYMLINK|OUTPUT_CHANGED/);
 assert.deepEqual(await fs.readdir(root+'/replacement'),[]);
 console.log('NATIVE_LOCAL_FILE_BOUNDARIES_VERIFIED');
}finally{await files.close();}
