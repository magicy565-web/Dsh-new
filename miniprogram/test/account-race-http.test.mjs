// Actual signed enterprise HTTP and distinct existing fixture members. Responses
// are delayed at the wx transport boundary; no real accounts or model execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierOwnerFixture} from '../../test/fixtures/supplier-owner-mcp.mjs';
import {promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {WorkspaceClient,memoryJournal,until,digest,loadPage} from './support.mjs';
async function fixture(t){
 const f=await supplierOwnerFixture(t),journal=memoryJournal(),attempts=[];
 let session=f.session,holdPath=null,held=null,fileReadHeld=false,downloadHeld=false,digestHeld=false;
 const deliver=(hold,callback)=>{if(hold)held=callback;else callback();};
 const platform={
  request(options){const path=new URL(options.url).pathname;attempts.push({path,method:options.method,body:structuredClone(options.data),subject:session.subject});const original=session;void f.api(path,{method:options.method,body:options.data,session:original}).then(result=>{const hold=path===holdPath;if(hold)holdPath=null;deliver(hold,()=>options.success({statusCode:result.status,data:result.body}));}).catch(options.fail);return{abort(){}};},
  downloadFile(options){const url=new URL(options.url),original=session;void f.api(url.pathname+url.search,{method:'GET',session:original}).then(async result=>{const tempFilePath=f.directory+'/actual-native-download.txt';assert.equal(result.status,200);assert.equal(typeof result.body,'string');await fs.writeFile(tempFilePath,result.bytes);deliver(downloadHeld,()=>options.success({statusCode:result.status,tempFilePath}));}).catch(options.fail);return{abort(){}};},
  getFileSystemManager(){return{
   readFile(options){void fs.readFile(options.filePath).then(bytes=>deliver(fileReadHeld,()=>options.success({data:bytes.toString(options.encoding)}))).catch(options.fail);},
   getFileInfo(options){assert.equal(options.digestAlgorithm,'sha256');void fs.readFile(options.filePath).then(bytes=>deliver(digestHeld,()=>options.success({digest:digest(bytes),size:bytes.length}))).catch(options.fail);},
  };},
 };
 const client=new WorkspaceClient(platform,{baseUrl:'https://workspace.example',journal});await client.initialize();
 return{...f,client,platform,journal,attempts,hold(path){holdPath=path;},holdFileRead(){fileReadHeld=true;},holdDownload(){downloadHeld=true;},holdDigest(){digestHeld=true;},async ready(){await until(()=>held!==null);},release(){const reply=held;held=null;reply();},async switchOwner(subject){session=await f.login(subject);await client.initialize();},async switchToOther(){session=await f.login('other');await client.initialize();}};
}
test('a late original-owner creation response cannot become the next owner conversation or checkpoint',async t=>{const f=await fixture(t);f.hold('/api/conversations');const old=f.client.mainConversation({conversations:[]});await f.ready();const original=f.attempts.at(-1).body;await f.switchToOther();assert.equal(f.client.session.user.id,'other');f.release();await assert.rejects(old,{code:'ACCOUNT_CHANGED'});const other=f.journal.read('other','https://workspace.example');assert.ok(!other||other.conversationId==='');assert.equal(f.journal.read('owner','https://workspace.example').pending.body.requestId,original.requestId);const id=await f.client.mainConversation({conversations:[]});assert.equal(f.app.store.read().conversations.find(c=>c.id===id).createdBy,'other');assert.equal(f.attempts.filter(a=>a.path==='/api/conversations'&&a.method==='POST').length,2);await f.switchOwner('owner');assert.equal(f.client.uncertain,true);const recovered=await f.client.mainConversation(await f.client.bootstrap());const row=f.app.store.read().conversations.find(c=>c.id===recovered);assert.equal(row.createdBy,'owner');assert.equal(row.creationRequestId,original.requestId);assert.equal(f.client.uncertain,false);assert.equal(f.attempts.filter(a=>a.path==='/api/conversations'&&a.method==='POST').length,2);});
test('late 401 from the revoked original session does not erase the new owner signed session',async t=>{const f=await fixture(t);assert.equal((await f.api('/api/session/logout',{session:f.session})).status,200);f.hold('/api/bootstrap');const old=f.client.bootstrap();await f.ready();await f.switchToOther();const current=f.client.session;assert.equal(current.user.id,'other');f.release();await assert.rejects(old,{status:401});assert.ok(f.client.session===current,'the new actual owner session must survive the old request rejection');assert.equal(f.client.session.authenticated,true);await f.client.bootstrap();});

test('delayed file selection cannot upload original owner bytes using the next owner session',async t=>{
 const f=await fixture(t),bytes=Buffer.from('Original selected owner text'),path=f.directory+'/selected-owner.txt';await fs.writeFile(path,bytes);f.holdFileRead();const old=f.client.upload(f.cid,'selected-owner.txt',path,bytes.length);await f.ready();await f.switchToOther();f.release();await assert.rejects(old,{code:'ACCOUNT_CHANGED'});assert.equal(f.attempts.filter(a=>a.path==='/api/artifacts'&&a.method==='POST').length,0);assert.equal(f.app.store.read().artifacts.length,0);
});
test('download and real SHA verification completion stay bound to the requesting owner',async t=>{
 for(const boundary of ['download','digest'])await t.test(boundary,async sub=>{
  const f=await fixture(sub),bytes=Buffer.from('Actual original owner text file receipt');const saved=await f.api('/api/artifacts',{session:f.session,body:{requestId:randomUUID(),sourceConversationId:f.cid,filename:'original-owner.txt',mimeType:'text/plain',base64:bytes.toString('base64')}});assert.equal(saved.status,201);const a=saved.body.artifact;assert.equal(a.sha256,digest(bytes));const file={id:a.id,version:a.currentVersion,sha256:a.sha256,filename:a.filename,mimeType:a.mimeType};if(boundary==='download')f.holdDownload();else f.holdDigest();const old=f.client.download(file);await f.ready();await f.switchToOther();f.release();await assert.rejects(old,{code:'ACCOUNT_CHANGED'});assert.equal(f.client.session.user.id,'other');assert.equal(f.app.store.read().artifacts.length,1);
 });
});

test('an actual owner-only supplier image with correct SHA is not returned after account switching',async t=>{
 const f=await fixture(t),r=await f.retail();f.holdDownload();const old=f.client.supplierImage(f.cid,r.saved.service,0);await f.ready();await f.switchToOther();f.release();await assert.rejects(old,{code:'ACCOUNT_CHANGED'});assert.equal(f.client.session.user.id,'other');assert.equal(f.app.store.read().artifacts.length,1);
});

test('late text preview read cannot repopulate a page after the current account changes',async t=>{
 const f=await fixture(t),bytes=Buffer.from('Original selected text preview');const saved=await f.api('/api/artifacts',{session:f.session,body:{requestId:randomUUID(),sourceConversationId:f.cid,filename:'selected-preview.txt',mimeType:'text/plain',base64:bytes.toString('base64')}});assert.equal(saved.status,201);const a=saved.body.artifact,{page}=loadPage(f.client,f.platform);t.after(()=>page.onUnload());page.setData({authenticated:true,subject:'owner',cards:[{id:a.id,title:a.filename,file:{id:a.id,version:a.currentVersion,sha256:a.sha256,filename:a.filename,mimeType:a.mimeType}}]});f.holdFileRead();const opening=page.card({currentTarget:{dataset:{id:a.id}}});await f.ready();await f.switchToOther();page.onShow();await until(()=>page.data.subject==='other');f.release();await opening;assert.equal(page.data.preview,null);assert.equal(page.data.subject,'other');
});
