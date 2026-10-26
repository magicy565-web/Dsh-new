// Explicit Chromium regression; synthetic content, no website/model/visual acceptance.
import assert from 'node:assert/strict';
import {issueFixture} from '../test/fixture.mjs';
import {inspectRenderedIssue} from '../src/browser-review.js';
const issue=issueFixture();
issue.design={brand:'Synthetic',reader:'Test reader',editorialGoal:'Browser regression',visualConcept:'Synthetic layout only',brandSourceIds:['s1'],imageTreatment:'photographic',distribution:'licensed-publication',textLedRequested:false,fontStyle:'editorial',palette:{paper:'#f6f4ef',surface:'#ffffff',ink:'#203020',accent:'#806048'}};
issue.composition='web-card';
issue.webCard={tone:'Monocle/B2B-Craft',issueTag:'SYNTHETIC',locationStamp:'',pullQuote:{text:'A synthetic quotation for browser regression',kind:'editorial',sourceIds:[]},metrics:[],cta:{title:'Source',body:'Synthetic destination; not visited',label:'Open source',mode:'contact-link',url:'https://example.com/product',sourceIds:['s1']}};
const result=await inspectRenderedIssue(JSON.stringify(issue),{view:'spreads',start:3,width:375,readingMode:'flip'});
assert.equal(result.status,'observed');
assert.deepEqual(result.screenshots.map(s=>s.label),['spread-3','spread-4']);
assert.equal(result.nextSpreadStart,null);
assert(result.designBlockers.includes('COVER_IMAGE_MISSING'));
assert(result.widths.every(w=>!w.overflow));
assert(Object.values(result.interactions).every(Boolean));
console.log(JSON.stringify({status:'passed',lastSpreadCaptured:true,disabledNextNotClicked:true,synthetic:true,modelAcceptance:false}));
