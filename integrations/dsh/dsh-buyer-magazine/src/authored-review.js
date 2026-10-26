import {createHash} from 'node:crypto';
import {dirname,extname,join} from 'node:path';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fail} from './core.js';
import {safePublicUrl} from '../upstream/src/schema.js';
import {printScreenshots} from './print-review.js';

const MIME={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf'};
const ORIGIN='https://magazine.invalid';

/** Read the LLM's files through DSH, without compiling, rewriting or fixing a layout. */
export async function openAuthoredArtifact(ctx,path,exec){
  if(!exec?.agent?.session?.header?.cwd||!exec.signal)fail('MAGAZINE_SESSION_REQUIRED');
  exec.signal.throwIfAborted();
  const fs=ctx.fs,session=await fs.resolve(exec.agent.session.header.cwd,{signal:exec.signal});
  const cwd=await fs.resolve(await ctx.workingDirectory.ensure(exec.agent,exec.signal),{signal:exec.signal});
  if(!fs.contains(session,cwd))fail('MAGAZINE_WORKSPACE_DENIED');
  const target=await fs.resolve(path,{cwd:fs.processPath(cwd),signal:exec.signal});
  if(!fs.contains(session,target)||extname(fs.processPath(target)).toLowerCase()!=='.html')fail('MAGAZINE_WORKSPACE_DENIED');
  const root=await fs.resolve(dirname(fs.processPath(target)),{signal:exec.signal});
  const read=async (name,cap)=>{
    exec.signal.throwIfAborted();
    const file=await fs.resolve(name,{cwd:fs.processPath(root),signal:exec.signal});
    if(!fs.contains(root,file)||!fs.contains(session,file))fail('MAGAZINE_WORKSPACE_DENIED');
    const entry=await fs.lstat(name,{cwd:fs.processPath(root)},exec.signal);
    const before=await fs.stat(file,exec.signal);
    if(entry?.type!=='file'||before?.type!=='file'||before.size>cap)fail('MAGAZINE_TARGET_CONFLICT');
    const bytes=Buffer.from(await fs.readBytes(file,exec.signal,cap));
    const after=await fs.stat(file,exec.signal);
    const fresh=await fs.resolve(name,{cwd:fs.processPath(root),signal:exec.signal});
    if(after?.version!==before.version||!fs.contains(root,fresh)||!fs.contains(fresh,file)||!fs.contains(file,fresh))fail('MAGAZINE_TARGET_CONFLICT');
    return bytes;
  };
  const html=await read(fs.processPath(target),2*1024*1024),localAssets=new Map();
  return {path:fs.processPath(target),html,
    readAsset:async name=>{const bytes=await read(name,8*1024*1024);localAssets.set(name,bytes);return bytes;},
    verify:async()=>{for(const [name,bytes]of localAssets)if(!(await read(name,8*1024*1024)).equals(bytes))return false;return true;}};
}

/** Isolated preview of authored HTML; no template, designer model or additional agent loop. */
export async function inspectAuthoredArtifact(artifact,args={},options={}){
  const sha256=createHash('sha256').update(artifact.html).digest('hex');
  const base={sha256,path:artifact.path,screenshots:[],authorship:'llm-authored-files',visualVerdict:'MODEL_MUST_INSPECT_SCREENSHOTS'};
  const signal=options.signal;
  const binary=options.executablePath||process.env.DSH_MAGAZINE_CHROMIUM||['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].find(existsSync);
  if(!binary||!existsSync(binary))return {...base,status:'blocked',reason:'CHROMIUM_UNAVAILABLE'};
  const allowed=new Set(args.assetUrls??[]);
  if([...allowed].some(url=>!safePublicUrl(url)))return {...base,status:'blocked',reason:'ASSET_URL_INVALID'};
  const {chromium}=await import('playwright-core');
  let browser;
  const abort=()=>{void browser?.close().catch(()=>{});};
  try{
    signal?.throwIfAborted();
    browser=await chromium.launch({executablePath:binary,headless:true,timeout:20000,env:{...process.env,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME||join(tmpdir(),'dsh-magazine-browser-config')}});
    signal?.addEventListener('abort',abort,{once:true});
    const width=args.width??1440,height=args.height??1000;
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',serviceWorkers:'block',acceptDownloads:true});
    const page=await context.newPage();page.setDefaultTimeout(8000);
    const errors=[],blocked=[],assets=new Map(),resources=new Map();let assetBytes=0;
    page.on('pageerror',error=>errors.push(error.message.slice(0,300)));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text().slice(0,300));});
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url()),type=request.resourceType();
      try{
        if(request.method()!=='GET')throw Error('REQUEST_BLOCKED');
        if(url.origin===ORIGIN){
          if(type==='document'&&url.pathname==='/index.html')return route.fulfill({body:artifact.html,contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' https: data:; connect-src 'self'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"}});
          const name=decodeURIComponent(url.pathname.slice(1)),mime=MIME[extname(name).toLowerCase()];
          if(!mime||type==='document')throw Error('REQUEST_BLOCKED');
          if(!assets.has(request.url()))assets.set(request.url(),artifact.readAsset(name).then(body=>({body,contentType:mime})));
        }else{
          if(!allowed.has(request.url())||!['image','stylesheet','font'].includes(type))throw Error('REQUEST_BLOCKED');
          if(!assets.has(request.url()))assets.set(request.url(),(async()=>{
            const response=await fetch(request.url(),{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
            if(!response.ok)throw Error('ASSET_UNAVAILABLE');
            const chunks=[];let size=0;for await(const part of response.body){size+=part.length;if(size>8*1024*1024)throw Error('ASSET_TOO_LARGE');chunks.push(part);}
            return {body:Buffer.concat(chunks),contentType:(response.headers.get('content-type')||'application/octet-stream').split(';')[0]};
          })());
        }
        const asset=await assets.get(request.url());assetBytes+=asset.body.length;
        if(assetBytes>40*1024*1024||assets.size>100)throw Error('ASSET_BUDGET');
        resources.set(request.url(),{url:request.url(),bytes:asset.body.length,sha256:createHash('sha256').update(asset.body).digest('hex')});
        await route.fulfill(asset);
      }catch{blocked.push({type,url:url.origin===ORIGIN?url.pathname:request.url(),location:url.origin===ORIGIN?'local':'external'});await route.abort().catch(()=>{});}
    });
    await page.goto(ORIGIN+'/index.html',{waitUntil:'load',timeout:30000});
    await page.locator('img').evaluateAll(images=>images.forEach(im=>im.loading='eager'));
    await page.waitForFunction(()=>[...document.images].every(im=>im.complete),null,{timeout:12000}).catch(()=>{});
    await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,3000))]));
    const actions=[];
    for(const action of args.actions??[]){
      const locator=page.locator(action.selector).first();
      if(action.kind==='click')await locator.click();
      else if(action.kind==='hover')await locator.hover();
      else if(action.kind==='fill')await locator.fill(action.value);
      else if(action.kind==='select')await locator.selectOption(action.value);
      else if(action.kind==='press')await locator.press(action.value);
      actions.push({kind:action.kind,selector:action.selector,status:'performed'});
    }
    await page.waitForLoadState('networkidle',{timeout:3000}).catch(()=>{});
    const metrics=await page.evaluate(()=>({title:document.title,visibleText:document.body.innerText.slice(0,2400),width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,documentHeight:document.documentElement.scrollHeight,imageFailures:[...document.images].filter(im=>!im.complete||!im.naturalWidth).map(im=>im.alt),headings:[...document.querySelectorAll('h1,h2')].slice(0,20).map(e=>e.textContent),fontStatus:document.fonts.status}));
    const screenshots=[];let pdf,printed;
    if(args.view==='print'){
      pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true});
      printed=await printScreenshots(pdf,args.start??0,signal);screenshots.push(...printed.screenshots);
    }else{
      if(args.selector){const section=page.locator(args.selector).first();await section.scrollIntoViewIfNeeded();screenshots.push({label:'section-'+width,data:await section.screenshot({type:'png',animations:'disabled'})});}
      else {await page.evaluate(y=>scrollTo(0,y),args.offsetY??0);screenshots.push({label:'screen-'+width+'-'+(args.offsetY??0),data:await page.screenshot({type:'png',animations:'disabled'})});}
    }
    return {...base,status:printed?.status==='blocked'?'blocked':errors.length||metrics.overflow||metrics.imageFailures.length||blocked.length?'failed':'observed',...metrics,actions,errors,resources:[...resources.values()],bundleSha256:createHash('sha256').update(sha256+JSON.stringify([...resources.values()].sort((a,b)=>a.url.localeCompare(b.url)))).digest('hex'),blockedRequests:blocked.slice(0,30),assetBytes,screenshots,pdf,...printed?{pages:printed.pages??null,nextPrintStart:printed.nextPrintStart??null,printReason:printed.reason??null}: {}};
  }catch(error){signal?.throwIfAborted();return {...base,status:'failed',reason:error.name==='TimeoutError'?'REVIEW_TIMEOUT':'RENDER_FAILED'};}
  finally{signal?.removeEventListener('abort',abort);await browser?.close();}
}

export async function reviewAuthoredInSession(ctx,args,exec,config={}){
  const artifact=await openAuthoredArtifact(ctx,args.htmlPath,exec);
  const attachments=ctx.get?.('attachments'),llm=ctx.get?.('llm');
  const routed=exec.agent.session.requestHeader?.()?.config;
  const provider=routed?.provider??exec.agent.options?.provider,model=routed?.model??exec.agent.options?.model;
  const sha256=createHash('sha256').update(artifact.html).digest('hex');
  if(!attachments||!llm||!provider||!model)return {status:'blocked',reason:'NATIVE_IMAGE_ROUTE_UNAVAILABLE',sha256,screenshots:[]};
  const info=await llm.resolveModelInfo(provider,model,exec.signal);
  if(!info.inputModalities?.includes('image'))return {status:'blocked',reason:'MODEL_HAS_NO_IMAGE_INPUT',sha256,screenshots:[]};
  const result=await inspectAuthoredArtifact(artifact,args,{executablePath:config.chromiumExecutable,signal:exec.signal});
  const fresh=await openAuthoredArtifact(ctx,args.htmlPath,exec);
  if(!fresh.html.equals(artifact.html)||!await artifact.verify())return {status:'failed',reason:'FILES_CHANGED_DURING_REVIEW',sha256,screenshots:[]};
  const refs=await attachments.saveImages(result.screenshots.map(s=>({data:s.data,mediaType:'image/png',name:s.label+'.png'})));
  const pdf=result.pdf?await attachments.saveFile({data:result.pdf,name:'editorial-'+sha256.slice(0,12)+'.pdf'}):undefined;
  const {screenshots,pdf:bytes,...summary}=result;
  return {...summary,screenshots:screenshots.map((s,i)=>({label:s.label,attachment:refs[i]})),...pdf?{pdf}: {}};
}
