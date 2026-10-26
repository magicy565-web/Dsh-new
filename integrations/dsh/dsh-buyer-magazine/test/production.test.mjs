import test from 'node:test';
import assert from 'node:assert/strict';
import {compileDraft,inspectIssue} from '../src/core.js';
import {issueFixture,now} from './fixture.mjs';
const design=()=>({brand:'Synthetic',reader:'Materials buyer',editorialGoal:'Compare actual materials',visualConcept:'Quiet photographic material study',brandSourceIds:['s1'],imageTreatment:'photographic',distribution:'licensed-publication',textLedRequested:false,fontStyle:'modern',palette:{paper:'#f6f4ef',surface:'#ffffff',ink:'#203020',accent:'#806048'}});
test('a valid legacy template is explicitly incomplete, not a finished publication',()=>{
 const result=compileDraft(JSON.stringify(issueFixture()),{now});
 assert.equal(result.readiness.status,'incomplete');
 for(const reason of ['DESIGN_BRIEF_MISSING','COVER_IMAGE_MISSING','PRODUCT_IMAGES_MISSING','VISUAL_REVIEW_REQUIRED'])assert(result.readiness.blockers.includes(reason));
});
test('design is applied, safely bounded, and cannot waive photography by itself',()=>{
 const issue=issueFixture();issue.design=design();
 const html=compileDraft(JSON.stringify(issue),{now}).data.toString();
 assert.match(html,/--paper:#f6f4ef/);assert.match(html,/--serif:var\(--sans\)/);
 issue.design.palette.accent='red;}body{display:none';assert.equal(inspectIssue(JSON.stringify(issue),{now}).valid,false);
 issue.design=design();issue.design.imageTreatment='text-led';
 assert(compileDraft(JSON.stringify(issue),{now}).readiness.blockers.includes('TEXT_LED_NOT_REQUESTED'));
});
test('attributed reference images never silently become licensed publication images',()=>{
 const issue=issueFixture();issue.design=design();
 issue.products[0].image={src:'https://example.com/photo.jpg',alt:'Synthetic image',role:'product',generated:false,rights:'editorial-reference',sourceId:'s1',credit:'Synthetic source',caption:'Internal reference only'};
 assert.equal(inspectIssue(JSON.stringify(issue),{now}).valid,false);
 issue.design.distribution='internal-reference';assert.equal(inspectIssue(JSON.stringify(issue),{now}).valid,true);
 delete issue.products[0].image.credit;assert.equal(inspectIssue(JSON.stringify(issue),{now}).valid,false);
});
test('Chinese publication localizes controls while preserving source URLs and inert input',()=>{
 const issue=issueFixture();issue.locale='zh-CN';issue.title='中文商品观察';
 const html=compileDraft(JSON.stringify(issue),{now}).data.toString();
 for(const text of ['商品总览','本期选品','关闭商品对比','品牌自述','审阅稿'])assert(html.includes(text),text);
 assert(html.includes('https://example.com/product'));assert(!html.includes('>Shortlist<'));
 issue.design=design();issue.cover.headline='Synthetic </script><script>alert(1)</script>';
 const safe=compileDraft(JSON.stringify(issue),{now}).data.toString();
 assert(!safe.includes('<script>alert(1)'));
});
test('web card binds real content and actions without sample brand, metrics or fake webhook',()=>{
 const issue=issueFixture();issue.design=design();issue.composition='web-card';
 issue.webCard={tone:'Monocle/B2B-Craft',issueTag:'SPECIMEN / 01',locationStamp:'',pullQuote:{text:'Editorial perspective',kind:'editorial',sourceIds:[]},metrics:[],cta:{title:'Explore the actual source',body:'See the recorded product',label:'Open source',mode:'contact-link',url:'https://example.com/product',sourceIds:['s1']}};
 const html=compileDraft(JSON.stringify(issue),{now}).data.toString();
 assert.match(html,/data-composition="web-card"/);assert.match(html,/Fictional vessel/);assert.match(html,/Explore the actual source/);
 assert.doesNotMatch(html,/ATELIER VANGUARD|99\.4%|alert\(|cdn\.tailwindcss|fonts\.googleapis/);
 issue.webCard.metrics=[{value:'99.4%',label:'Unsupported demo metric',sourceIds:[]}];
 assert.equal(inspectIssue(JSON.stringify(issue),{now}).valid,false);
 issue.webCard.metrics=[];delete issue.webCard.cta.url;assert.equal(inspectIssue(JSON.stringify(issue),{now}).valid,false);
 issue.webCard.cta.mode='download-brief';issue.webCard.cta.sourceIds=[];
 assert.match(compileDraft(JSON.stringify(issue),{now}).data.toString(),/data-card-form/);
});

test('the supplied four skills and all fifteen original files survive packaging without source changes',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {createHash}=await import('node:crypto');
 const root=new URL('../',import.meta.url);
 const manifest=JSON.parse(await readFile(new URL('skill-pack.json',root)));
 const provenance=JSON.parse(await readFile(new URL('docs/user-skill-pack-provenance.json',root)));
 assert.equal(manifest.skills.length,4);
 assert.equal(manifest.entry,'ai-media-kinetic-commerce');
 assert.equal(provenance.files.length,15);
 for(const entry of provenance.files){
  const bytes=await readFile(new URL(entry.target,root));
  assert.equal(bytes.length,entry.bytes,entry.target);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.target);
 }
 for(const skill of manifest.skills){
  const text=await readFile(new URL(skill.path,root),'utf8');
  assert(text.includes('name: '+skill.name));
  assert(text.includes('## Native DSH integration contract'));
  const original=await readFile(new URL(`skills/${skill.name}/upstream/SKILL.original.md`,root),'utf8');
  assert(text.endsWith(original.slice(original.indexOf('---',3)+3).trimStart()),skill.name);
 }
});
