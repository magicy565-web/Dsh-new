// Explicit browser check of freely authored structures; not a design-quality verdict.
import assert from 'node:assert/strict';
import {inspectAuthoredArtifact} from '../src/authored-review.js';
const html=Buffer.from(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Independent layout fixture</title><link rel="stylesheet" href="type.css"><main id="essay"><h1>材料的另一种读法</h1><p id="answer">第一段</p><button id="change">下一段</button></main><script src="reading.js"></script></html>`);
const assets={'type.css':'body{margin:24px;font-family:serif}h1{font-size:clamp(24px,5vw,64px)}@media print{button{display:none}}','reading.js':"document.querySelector('#change').onclick=()=>document.querySelector('#answer').textContent='第二段：排版由作者决定'"};
const artifact={path:'synthetic-independent.html',html,readAsset:async name=>Buffer.from(assets[name])};
const screen=await inspectAuthoredArtifact(artifact,{view:'screen',width:375,actions:[{kind:'click',selector:'#change'}]});
assert.equal(screen.status,'observed');assert(screen.visibleText.includes('第二段：排版由作者决定'));assert.equal(screen.actions.length,1);assert.equal(screen.resources.length,2);assert.equal(screen.screenshots.length,1);assert(screen.bundleSha256);
const print=await inspectAuthoredArtifact(artifact,{view:'print'});
assert.equal(print.status,'observed');assert.equal(print.pages,1);assert(print.pdf.length>1000);
assert.equal(print.sha256,screen.sha256);assert.equal(print.bundleSha256,screen.bundleSha256);
// DSH rejects undefined properties even when JSON.stringify silently omits them.
const {screenshots,pdf,...metadata}=print;
assert.deepEqual(JSON.parse(JSON.stringify(metadata)),metadata);
console.log(JSON.stringify({status:'passed',arbitraryAuthoredDom:true,localCssAndJs:true,nativeLayoutImposed:false,screenAndPdf:true,liveModel:false}));
const popup=await inspectAuthoredArtifact({path:'synthetic-popup.html',html:Buffer.from('<button id="external" onclick="window.open(\'https://example.invalid/escape\')">External</button>'),readAsset:async()=>{throw Error('unused');}},{view:'screen',actions:[{kind:'click',selector:'#external'}]});
assert.equal(popup.status,'failed');assert(popup.blockedRequests.some(r=>r.url==='https://example.invalid/escape'));
console.log(JSON.stringify({popupNavigationBlocked:true}));
