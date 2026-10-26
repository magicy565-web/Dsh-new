import {printScreenshots} from './print-review.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { compileDraft, inspectIssue } from './core.js';
import { generateInSession } from './native-files.js';

/** Bounded review of our compiler's output, never an arbitrary URL, script or file. */
export async function inspectRenderedIssue(issueJson, { executablePath, view = 'overview', start = 0, width = 1440, readingMode = 'scroll', signal } = {}) {
  const draft = compileDraft(issueJson, { signal });
  const issue = inspectIssue(issueJson).issue;
  const binary = executablePath || process.env.DSH_MAGAZINE_CHROMIUM || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
  if (!binary || !existsSync(binary)) return { status: 'blocked', reason: 'CHROMIUM_UNAVAILABLE', sha256: draft.sha256, screenshots: [] };
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ headless: true, executablePath: binary, timeout: 20000, env: {...process.env,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME||join(tmpdir(),'dsh-magazine-browser-config')} });
  const abort = () => { void browser.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const context = await browser.newContext({ locale: issue.locale, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const imageUrls = new Set([issue.cover.image, ...issue.products.map(p => p.image)].filter(Boolean).map(im => im.src));
    // Inline CSS/JS is compiler-owned. Browsing, trackers and arbitrary requests are not admitted.
    const assets=new Map();
    await page.route('**/*', async route => {
      const url=route.request().url();
      if(!imageUrls.has(url)||route.request().resourceType()!=='image')return route.abort();
      // Native DSH installs its proxy dispatcher for fetch. Keep inherited TLS/CA
      // verification; do not use Chromium's separate certificate/proxy policy.
      if(!assets.has(url))assets.set(url,(async()=>{
        const response=await fetch(url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
        const contentType=(response.headers.get('content-type')||'').split(';')[0];
        if(!response.ok||!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(contentType))throw Error('IMAGE_UNAVAILABLE');
        const chunks=[];let length=0;
        for await(const chunk of response.body){length+=chunk.length;if(length>8*1024*1024)throw Error('IMAGE_TOO_LARGE');chunks.push(chunk);}
        return {body:Buffer.concat(chunks),contentType};
      })());
      try{const asset=await assets.get(url);await route.fulfill({status:200,...asset});}catch{await route.abort();}
    });
    const errors=[]; page.on('pageerror', () => errors.push('PAGE_SCRIPT_ERROR'));
    await page.setViewportSize({ width:1440, height:1000 });
    await page.setContent(draft.data.toString(), { waitUntil:'load', timeout:30000 });
    await page.locator('img').evaluateAll(images => images.forEach(im => im.loading='eager'));
    await page.waitForFunction(() => [...document.images].every(im=>im.complete), null, { timeout:15000 }).catch(()=>{});
    const imageFailures = await page.locator('img').evaluateAll(images => images.filter(im=>!im.complete || im.naturalWidth===0).map(im=>im.alt));
    const screenshots=[], widths=[];
    for (const width of [375,768,1440]) {
      await page.setViewportSize({width,height:1000});
      widths.push({width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)});
      if(view==='overview')screenshots.push({label:`cover-${width}`,data:await page.screenshot({type:'png',animations:'disabled'})});
    }
    await page.setViewportSize({width,height:1000});
    const interactions={};
    if(issue.composition!=='modules') {
      await page.locator('[data-sources]').first().click();
      interactions.sources=await page.locator('#sources-dialog').evaluate(el=>el.open);
      await page.keyboard.press('Escape');
      const saves=page.locator('.product-feature [data-save]');
      if(await saves.count()>=2){
        await saves.nth(0).click();await saves.nth(1).click();
        await page.locator('[data-compare]').first().click();
        interactions.comparison=await page.locator('#comparison-dialog').evaluate(el=>el.open);
        await page.keyboard.press('Escape');await saves.nth(0).click();await saves.nth(1).click();
      }
      interactions.escape=await page.locator('dialog[open]').count()===0;
      const filter=page.locator('[data-filter]:not([data-filter="*"])').first();
      if(await filter.count()){
        await filter.click();const selected=await filter.getAttribute('data-filter');
        interactions.filter=await page.locator('.product-feature:not([hidden])').evaluateAll((els,category)=>els.length>0&&els.every(e=>e.dataset.productCategory===category),selected);
        await page.locator('[data-filter="*"]').click();
      }
    }
    if(issue.composition==='web-card'){
      const before=await page.locator('[data-card-material-result]').innerText();
      if(issue.products.length>1){await page.locator('[data-card-material-select]').selectOption(issue.products[1].id);interactions.materialComparison=(await page.locator('[data-card-material-result]').innerText())!==before;await page.locator('[data-card-material-select]').selectOption(issue.products[0].id);}
      await page.locator('[data-card-vellum-toggle]').click();interactions.vellum=await page.locator('[data-card-vellum]').isVisible();await page.locator('[data-card-vellum-toggle]').click();
      await page.locator('[data-card-mode-select="flip"]').click();await page.locator('[data-card-next]').click();interactions.flip=await page.locator('[data-spread="1"]').isVisible()&&!(await page.locator('[data-spread="0"]').isVisible());
      await page.keyboard.press('ArrowLeft');interactions.keyboard=await page.locator('[data-spread="0"]').isVisible();await page.locator('[data-card-mode-select="scroll"]').click();
      const vcard=page.waitForEvent('download');await page.locator('[data-card-vcard]').click();const downloaded=await vcard;interactions.vcard=downloaded.suggestedFilename().endsWith('.vcf');
      if(issue.webCard.cta.mode==='contact-link')interactions.cta=(await page.locator('.card-contact a.card-action').getAttribute('href'))===issue.webCard.cta.url;
      else{
        const form=page.locator('[data-card-form]');await form.locator('[name="company"]').fill('Synthetic QA');await form.locator('[name="email"]').fill('qa@example.invalid');await form.locator('[name="request"]').fill('Synthetic local download check');const download=page.waitForEvent('download');await form.locator('button[type="submit"]').click();interactions.brief=(await download).suggestedFilename().endsWith('.txt');await form.evaluate(f=>f.reset());await page.locator('[data-card-status]').evaluate(el=>el.textContent='');
      }
    }
    // Include the page margin so glyph bearings and deliberately tilted plates
    // are not cut by element-only crops. Hide only the floating reader controls.
    const captureSection=async locator=>{
      await locator.scrollIntoViewIfNeeded();
      const box=await locator.boundingBox();
      const geometry=await page.evaluate(()=>({scrollY,scrollX,w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));
      const x=Math.max(0,box.x+geometry.scrollX-16),y=Math.max(0,box.y+geometry.scrollY-16);
      const clip={x,y,width:Math.min(box.width+32,geometry.w-x),height:Math.min(box.height+32,geometry.h-y)};
      return page.screenshot({type:'png',clip,fullPage:true,animations:'disabled',style:'.card-mode-switch{visibility:hidden!important}'});
    };
    if(view==='spreads'){
      const spreads=page.locator('[data-spread]');
      if(readingMode==='flip'&&issue.composition==='web-card'){
        await page.locator('[data-card-mode-select="flip"]').click();
        for(let i=0;i<start;i++)await page.locator('[data-card-next]').click();
      }
      for(let i=start;i<Math.min(start+3,await spreads.count());i++){
        screenshots.push({label:`spread-${i}`,data:await captureSection(spreads.nth(i))});
        if(readingMode==='flip'&&i+1<await spreads.count())await page.locator('[data-card-next]').click();
      }
      if(readingMode==='flip')await page.locator('[data-card-mode-select="scroll"]').click();
    }
    if(view==='products'){
      const cards=page.locator('.product-feature');
      for(let i=start;i<Math.min(start+3,await cards.count());i++)screenshots.push({label:`product-${issue.products[i].id}`,data:await captureSection(cards.nth(i))});
    }
    if(view==='editorial')for(const selector of ['.card-lead,.editor-note','.notes-section','.card-contact']){
      const section=page.locator(selector);if(await section.count())screenshots.push({label:selector.slice(1),data:await captureSection(section)});
    }
    const checksPass=!errors.length&&!imageFailures.length&&!widths.some(w=>w.overflow)&&Object.values(interactions).every(Boolean);
    const pdf=['editorial','print'].includes(view)?await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true}):undefined;
    const printed=view==='print'?await printScreenshots(pdf,start,signal):null;
    if(printed)screenshots.push(...printed.screenshots);
    return {status:printed?.status==='blocked'?'blocked':checksPass?'observed':'failed',...(printed?{printStatus:printed.status,printReason:printed.reason??null,pages:printed.pages??null,nextPrintStart:printed.nextPrintStart??null}:{}),sha256:draft.sha256,view,width,readingMode,widths,imageFailures,errors,interactions,
      nextSpreadStart:view==='spreads'&&start+3<5?start+3:null,
      nextProductStart:view==='products'&&start+3<issue.products.length?start+3:null,
      designBlockers:draft.readiness.blockers.filter(b=>b!=='VISUAL_REVIEW_REQUIRED'),
      visualVerdict:'MODEL_MUST_INSPECT_SCREENSHOTS',screenshots,pdf};
  } finally {signal?.removeEventListener('abort',abort);await browser.close();}
}

export async function reviewInSession(ctx,args,exec,config={}) {
  const generated=await generateInSession(ctx,args.issueJson,exec);
  const attachments=ctx.get?.('attachments');
  const llm=ctx.get?.('llm');
  const routed=exec.agent.session.requestHeader?.()?.config;
  const provider=routed?.provider??exec.agent.options?.provider, model=routed?.model??exec.agent.options?.model;
  if(!attachments||!llm||!provider||!model)return {status:'blocked',reason:'NATIVE_IMAGE_ROUTE_UNAVAILABLE',sha256:generated.sha256,screenshots:[]};
  const info=await llm.resolveModelInfo(provider,model,exec.signal);
  if(!info.inputModalities?.includes('image'))return {status:'blocked',reason:'MODEL_HAS_NO_IMAGE_INPUT',sha256:generated.sha256,screenshots:[]};
  const result=await inspectRenderedIssue(args.issueJson,{executablePath:config.chromiumExecutable,view:args.view,start:args.start??0,width:args.width??1440,readingMode:args.readingMode??'scroll',signal:exec.signal});
  exec.signal.throwIfAborted();
  const refs=await attachments.saveImages(result.screenshots.map(s=>({data:s.data,mediaType:'image/png',name:s.label+'.png'})));
  const screenshots=result.screenshots.map((s,i)=>({label:s.label,attachment:refs[i]}));
  const pdf=result.pdf?await attachments.saveFile({data:result.pdf,name:generated.name.replace(/\.html$/,'.pdf')}):undefined;
  const {pdf:pdfBytes,screenshots:buffers,...summary}=result;
  return {...summary,path:generated.path,screenshots,...pdf?{pdf}: {}};
}
