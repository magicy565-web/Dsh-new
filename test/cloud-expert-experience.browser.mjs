import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';

const directory=await mkdtemp(path.join(tmpdir(),'cloud-experts-real-browser-'));
let attemptedRemoteSubmissions=0;
const mock=(serviceId)=>({
  ready:true,budgetEnforced:true,displayName:'Isolated approved fixture',
  services:[serviceId],
  async submit(){attemptedRemoteSubmissions++;throw new Error('External dispatch not part of team preparation');},
  async get(jobId){return {jobId,status:'working'};},
  async cancel(){return {status:'cancel_requested'};},
});
const app=await createApp({dataDirectory:directory,workerAdapters:{
  market:mock('channel-validation'),buyer:mock('buyer-discovery'),
}});
const addr=await app.listen(0);
const base='http://127.0.0.1:'+addr.port;
let browser;
const javascriptErrors=[];
async function post(endpoint,payload){
  const response=await fetch(base+'/api'+endpoint,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),
  });
  assert.ok(response.ok,endpoint+' failed with '+response.status);
  return response.json();
}
try{
  const lead=(await post('/cloud-experts',{
    templateId:'growth-lead',alias:'美国增长总控',mission:'研究目标市场并整合证据',
    serviceId:'channel-validation',workerId:'market',skills:['market-analysis'],
    maxCredits:20,publicDataConfirmed:true,requestId:'browser-hire-lead',
  })).expert;
  const buyer=(await post('/cloud-experts',{
    templateId:'buyer-hunter',alias:'美国渠道开发',mission:'找到可核验的批发商',
    serviceId:'buyer-discovery',workerId:'buyer',skills:['buyer-screening'],
    maxCredits:20,publicDataConfirmed:true,requestId:'browser-hire-buyer',
  })).expert;
  await post('/cloud-teams',{
    templateId:'overseas-growth',name:'美国渠道研究团队',
    mission:'核查美国纺织品批发与经销渠道',
    leadId:lead.id,memberIds:[buyer.id],budgetCredits:50,taskCeilingCredits:20,
    requestId:'browser-create-team',
  });
  browser=await chromium.launch({headless:true,chromiumSandbox:process.env.CHROMIUM_NO_SANDBOX!=='1',
    ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1340,height:900}});
  page.on('pageerror',e=>javascriptErrors.push(e.message));
  await mkdir('evidence/browser',{recursive:true});
  await page.goto(base+'/workers');
  await page.getByRole('heading',{name:/你的 AI 专家团队/}).waitFor();
  await page.locator('.ce-expert-card').nth(7).waitFor();
  assert.equal(await page.locator('.ce-expert-card .expert-mark svg').count(),8);
  assert.equal(await page.locator('.ce-team-card .expert-team-mark svg').count(),12);
  assert.equal(await page.locator('.ce-real-output').count(),8);
  await page.screenshot({path:'evidence/browser/20-cloud-experts-actual-home.png',fullPage:true});
  await page.locator('.ce-expert-card').filter({hasText:'增长总控专家'}).getByRole('button',{name:'管理已聘专家'}).click();
  const drawer=page.getByRole('dialog');
  await drawer.getByRole('heading',{name:'增长总控专家'}).waitFor();
  assert.equal(await drawer.locator('.ce-brief-step').count(),3);
  assert.equal(await drawer.locator('.ce-brief-deliverable').count(),3);
  await page.screenshot({path:'evidence/browser/21-cloud-experts-actual-role.png',fullPage:true});
  await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:/我的团队/}).click();
  await page.getByText('美国渠道研究团队').waitFor();
  await page.getByRole('button',{name:/查看分工/}).first().click();
  const planning=page.getByRole('dialog');
  await planning.getByRole('heading',{name:'美国渠道研究团队'}).waitFor();
  assert.equal(await planning.locator('.ce-plan-step').count(),2);
  assert.equal(await planning.locator('.ce-stage-task').count(),2);
  await planning.getByLabel('共享公开产品').fill('Printed rayon fabrics');
  await planning.locator('.ce-stage-form .ce-confirm input').check();
  await page.screenshot({path:'evidence/browser/22-cloud-experts-actual-team-staging.png',fullPage:true});
  await planning.getByRole('button',{name:/生成 2 张待审批任务单/}).click();
  await page.getByRole('heading',{name:'增长服务'}).waitFor();
  const data=await (await fetch(base+'/api/worker-orders')).json();
  assert.equal(data.orders.length,2);
  assert.ok(data.orders.every(o=>o.status==='draft'&&o.remoteJobId===null));
  assert.equal(attemptedRemoteSubmissions,0);
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'/workers');
  await page.getByRole('heading',{name:/你的 AI 专家团队/}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
  await page.screenshot({path:'evidence/browser/23-cloud-experts-mobile.png',fullPage:true});
  assert.deepEqual(javascriptErrors,[]);
  console.log('PASS eight SVG expert icons, rich role dossiers, real team task staging, mobile and no paid dispatch');
} finally {
  await browser?.close();
  await app.close();
  await rm(directory,{recursive:true,force:true});
}
