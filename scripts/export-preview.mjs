import { readFile, writeFile, readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=await readdir(path.join(root,'dist/assets'));
const js=await readFile(path.join(root,'dist/assets',assets.find(name=>name.endsWith('.js'))),'utf8');
const css=await readFile(path.join(root,'dist/assets',assets.find(name=>name.endsWith('.css'))),'utf8');
const directory=await mkdtemp(path.join(tmpdir(),'workspace-render-'));
const app=await createApp({dataDirectory:directory});
const outputs=path.join(root,'evidence');await mkdir(outputs,{recursive:true});
async function save(name,hash=''){
  const state=JSON.stringify(app.runtime.bootstrap()).replaceAll('<','\\u003c');
  const adapter=`const snapshot=${state}; window.fetch=async(input,options={})=>{ const url=String(input); if((options.method||'GET')==='GET'&&url==='/api/bootstrap')return new Response(JSON.stringify(snapshot),{status:200,headers:{'Content-Type':'application/json'}}); return new Response(JSON.stringify({error:{code:'OFFLINE_PREVIEW',message:'这是离线界面预览。请启动项目服务器后再保存或执行操作。'}}),{status:409,headers:{'Content-Type':'application/json'}});}; ${hash?`location.hash=${JSON.stringify(hash)};`:''}`;
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace · Offline visual verification</title><style>${css}</style><body><div id="root"></div><div style="position:fixed;left:82px;bottom:8px;z-index:9999;font:9px system-ui;letter-spacing:.05em;color:#a4a4a4;pointer-events:none">离线渲染校验 · 真实服务端状态快照 · 不执行操作</div><script>${adapter.replace(/<\/script/gi,'<\\/script')}</script><script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
  await writeFile(path.join(outputs,name+'.html'),html);
  await writeFile(path.join(outputs,name+'.state.json'),JSON.stringify(app.runtime.bootstrap(),null,2));
}
try{
 await save('preview-home');
 const {conversation}=await app.runtime.createConversation({title:'整理产品发布计划'});
 await app.runtime.sendMessage(conversation.id,{content:'帮我梳理一个产品发布目标，先从要解决的问题和验收标准开始。',requestId:'offline-render-chat'});
 const {goal}=await app.runtime.createGoal({title:'整理产品发布计划',description:'明确目标用户、核心流程和发布前检查项，形成可以审核的文字计划。',conversationId:conversation.id,maxSteps:3});
 await app.runtime.updateGoal(goal.id,{action:'start',requestId:'offline-render-goal'});
 await save('preview-chat',`/chat/${conversation.id}`);
 await save('preview-goals','/goals');
}finally{await app.close();await rm(directory,{recursive:true,force:true});}
console.log('Created offline visual fixtures from real unconfigured backend state. No provider or external tool executed.');
