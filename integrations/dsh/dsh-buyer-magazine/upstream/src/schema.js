import { validateModuleIssue } from '../../src/modules/validate.js';
/** Dependency-free, strict runtime validation for the public buyer-magazine issue.
 * Deliberately does not coerce prices, dates, URLs, permissions or verification status. */
const issue = (path,message)=>({path:Array.isArray(path)?path:[],message});
const s=(max,min=0,check=null)=>({type:'string',max,min,check});
const literal=value=>({type:'literal',value});
const oneOf=(...values)=>({type:'enum',values});
const arr=(items,max=100,min=0)=>({type:'array',items,max,min});
const obj=fields=>({type:'object',fields});
const opt=inner=>({type:'optional',inner});
const nul=inner=>({type:'nullable',inner});
const choice=(...values)=>({type:'union',values});
const num=(min=null)=>({type:'number',min});
const ref=arr(s(120,1),30);
const stat=oneOf('verified','supplier-stated','unknown');
const https=s(2048,1,v=>safePublicUrl(v));
const date=s(10,10,v=>/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
const timestamp=s(60,1,v=>Number.isFinite(Date.parse(v)));
const filename=s(2048,1,v=>safePublicUrl(v)||/^assets\/[a-zA-Z0-9_./-]+$/.test(v)&&!v.split('/').includes('..'));
const ident=s(120,1,v=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v));
const color=s(7,7,v=>/^#[a-fA-F0-9]{6}$/.test(v));
const term=obj({value:choice(s(300),num()),unit:opt(s(80)),status:stat,sourceIds:ref});
const image=obj({src:filename,alt:s(240,1),role:oneOf('editorial','product','illustration'),generated:literal(true),rights:oneOf('owned','licensed','permission','editorial-reference','link-only','unknown'),sourceId:opt(s(120,1)),credit:opt(s(300)),caption:opt(s(300)),fit:opt(oneOf('contain','cover')),position:opt(oneOf('center','top','bottom','left','right'))});
// Generated can be true/false, never an inferred string truthiness.
image.fields.generated={type:'boolean'};
const cta=obj({label:s(120,1),type:oneOf('source','inquiry','sample'),url:https});
const product=obj({
  id:ident,name:s(180,1),supplier:s(160,1),category:s(80,1),region:s(160,1),summary:s(1200,1),buyerFit:s(700,1),watchout:s(700,1),image:opt(nul(image)),
  specs:arr(obj({key:s(80,1),label:s(100,1),value:choice(s(500),num()),unit:opt(s(80)),status:stat,sourceIds:ref,visibility:oneOf('public','restricted'),asOf:opt(s(40))}),12),
  price:obj({kind:oneOf('retail','wholesale','request-quote','unknown'),amount:opt(choice(num(0),s(80,1))),currency:opt(s(12)),unit:opt(s(80)),basis:opt(s(240)),minQty:opt(num(0)),sourceIds:ref,status:stat}),
  moq:term,leadTime:term,sourceIds:ref,cta,sponsored:opt(obj({label:s(80,1),sponsor:s(160,1)})),
});
const shape=obj({
  schemaVersion:literal('1.0'),design:opt(obj({brand:s(100,1),reader:s(200,1),editorialGoal:s(400,1),visualConcept:s(600,1),brandSourceIds:ref,imageTreatment:oneOf('photographic','text-led'),distribution:oneOf('internal-reference','licensed-publication'),textLedRequested:{type:'boolean'},fontStyle:oneOf('editorial','modern'),palette:obj({paper:color,surface:color,ink:color,accent:color})})),composition:opt(oneOf('studio','modules','web-card')),webCard:opt(obj({tone:oneOf('Vogue/High-Fashion','Kinfolk/Minimalist','Monocle/B2B-Craft','Architectural-Digest','Loewe/Monograph','032c/Technical-Archive'),archetype:opt(oneOf('kinfolk','loewe','monocle','archive032c')),craftStages:opt(arr(obj({title:s(120,1),body:s(500,1),sourceIds:ref}),5,1)),issueTag:s(120,1),locationStamp:s(160),pullQuote:obj({text:s(360,1),kind:oneOf('editorial','source'),sourceIds:ref}),metrics:arr(obj({value:s(60,1),label:s(100,1),sourceIds:ref}),3),cta:obj({title:s(180,1),body:s(500,1),label:s(100,1),mode:oneOf('contact-link','download-brief'),url:opt(https),sourceIds:ref})})),blocks:opt(arr({type:'module-block'},60,1)),id:ident,edition:s(80,1),title:s(160,1),subtitle:s(240),date:choice(date,literal('')),
  locale:oneOf('en','zh-CN'),market:s(120,1),theme:oneOf('porcelain','atelier','foundry','fieldnotes'),demo:{type:'boolean'},
  cover:obj({kicker:s(120,1),headline:s(180,1),headlineLines:opt(arr(obj({text:s(180,1),voice:oneOf('roman','italic','sans')}),3,2)),dek:s(700,1),image:opt(nul(image))}),
  editorNote:s(1600),highlights:arr(obj({label:s(100,1),text:s(400,1)}),4),products:arr(product,6),
  sources:arr(obj({id:s(120,1),url:https,title:s(240,1),publisher:s(160,1),accessedAt:timestamp,kind:oneOf('supplier','retailer','third-party','internal'),excerpt:opt(s(1600)),contentHash:opt(s(128))}),60),
  insights:arr(obj({title:s(160,1),body:s(1200,1),kind:oneOf('observation','inference'),sourceIds:ref}),5),
  dataNotes:arr(s(700,1),15),cta:opt(cta),
  provenance:obj({mode:oneOf('demo','live','import'),collectedAt:choice(timestamp,literal('')),provider:opt(s(120))}),
});
function parse(value,rule,path,issues) {
  if(rule.type==='module-block')return value;
  if(rule.type==='optional' && value===undefined)return value;
  if(rule.type==='optional')return parse(value,rule.inner,path,issues);
  if(rule.type==='nullable' && value===null)return value;
  if(rule.type==='nullable')return parse(value,rule.inner,path,issues);
  if(rule.type==='union'){
    for(const variant of rule.values){const scratch=[];const candidate=parse(value,variant,path,scratch);if(!scratch.length)return candidate;}
    issues.push(issue(path,'Invalid field type or value'));return value;
  }
  if(rule.type==='literal'){if(value!==rule.value)issues.push(issue(path,`Expected ${JSON.stringify(rule.value)}`));return value;}
  if(rule.type==='enum'){if(!rule.values.includes(value))issues.push(issue(path,'Expected '+rule.values.join(', ')));return value;}
  if(rule.type==='boolean'){if(typeof value!=='boolean')issues.push(issue(path,'Expected boolean'));return value;}
  if(rule.type==='number'){if(typeof value!=='number'||!Number.isFinite(value)||(rule.min!==null&&value<rule.min))issues.push(issue(path,'Expected finite number'+(rule.min!==null?' at least '+rule.min:'')));return value;}
  if(rule.type==='string'){
    if(typeof value!=='string'){issues.push(issue(path,'Expected string'));return value;}
    const v=value.trim();
    if(v.length<rule.min||v.length>rule.max||rule.check&&(!v||!rule.check(v)))issues.push(issue(path,'Invalid or overlong string'));
    return v;
  }
  if(rule.type==='array'){
    if(!Array.isArray(value)){issues.push(issue(path,'Expected array'));return value;}
    if(value.length<rule.min||value.length>rule.max)issues.push(issue(path,`Expected ${rule.min}..${rule.max} items`));
    return value.map((v,i)=>parse(v,rule.items,[...path,i],issues));
  }
  if(rule.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value)){issues.push(issue(path,'Expected object'));return value;}
    const keys=Object.keys(rule.fields),result={};
    for(const key of Object.keys(value))if(!keys.includes(key))issues.push(issue([...path,key],'Unrecognized key'));
    for(const key of keys){const field=rule.fields[key];if(value[key]===undefined&&field.type!=='optional')issues.push(issue([...path,key],'Required'));else {const v=parse(value[key],field,[...path,key],issues);if(v!==undefined)result[key]=v;}}
    return result;
  }
  issues.push(issue(path,'Unsupported schema'));return value;
}
export const issueSchema={safeParse(value){const issues=[];const data=parse(value,shape,[],issues);return issues.length?{success:false,error:{issues}}:{success:true,data};}};

export function safePublicUrl(value) {
  try {
    const u=new URL(value);const h=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
    const credentialKey=/^(?:api[-_]?key|token|access[-_]?token|authorization|password|secret)$/i;
    if([...u.searchParams.keys()].some(k=>credentialKey.test(k)))return false;
    if(/(?:^#|[&?])(?:access_token|token|api_key|password)=/i.test(u.hash))return false;
    return u.protocol==='https:' && !u.username && !u.password && (!u.port || u.port==='443') && h.includes('.') && !h.endsWith('.') && !/^\d+(?:\.\d+){3}$/.test(h) && !h.includes(':') && !/(^|\.)(localhost|local|internal|home|lan|test|invalid|onion)$/.test(h) && !/[\u0000-\u0020]/.test(value);
  } catch { return false; }
}
export function isExampleUrl(value){try{return /(^|\.)(example\.com|example\.org|example\.net|example)$/.test(new URL(value).hostname);}catch{return false;}}
export class IssueValidationError extends Error {
  constructor(report){super('Issue failed validation: '+report.errors.slice(0,5).map(e=>`${e.path}: ${e.message}`).join('; '));this.name='IssueValidationError';this.report=report;}
}
export function getReadingStats(issue) {
  const pieces=[issue.title,issue.subtitle,issue.cover?.headline,issue.cover?.dek,issue.editorNote,...(issue.highlights||[]).flatMap(x=>[x.label,x.text]),...(issue.products||[]).flatMap(p=>[p.name,p.summary,p.buyerFit,p.watchout,...(p.specs||[]).flatMap(s=>[s.label,String(s.value)])]),...(issue.insights||[]).flatMap(x=>[x.title,x.body]),...(issue.dataNotes||[]),...(issue.blocks||[]).map(b=>JSON.stringify([b.title,b.product,b.data]))].filter(Boolean).join(' ');
  const cjk=(pieces.match(/[\u3400-\u9fff]/g)||[]).length;
  const words=(pieces.replace(/[\u3400-\u9fff]/g,' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)||[]).length;
  const seconds=Math.ceil(words/200*60+cjk/400*60+(issue.products||[]).length*15);
  return {words,cjkCharacters:cjk,estimatedSeconds:seconds,estimatedMinutes:Math.max(1,Math.ceil(seconds/60)),targetSeconds:300};
}
export function validateIssue(input,{now=new Date(),throwOnError=false}={}) {
  const errors=[],warnings=[];
  const parsed=issueSchema.safeParse(input);
  if(!parsed.success){for(const e of parsed.error.issues)errors.push({path:e.path.join('.'),message:e.message});}
  const issue=parsed.success?parsed.data:null;
  if(issue){
    const ids=new Set(),productIds=new Set();
    if(issue.composition==='modules') {
      if(issue.products.length || issue.sources.length || !issue.blocks) errors.push({path:'composition',message:'Module composition needs selected blocks and no inferred product dossiers or sources'});
      try { validateModuleIssue({ title:issue.title, audience:issue.subtitle, language:issue.locale==='en'?'en':'zh', preview:issue.demo, blocks:issue.blocks }); }
      catch(error) { errors.push({path:'blocks',message:error.message}); }
      for(const b of issue.blocks ?? []) for(const e of b?.evidence ?? []) if(Date.parse(e.date)>now.getTime()+300000) errors.push({path:'blocks.evidence.date',message:'Evidence date cannot be in the future'});
    } else if(issue.blocks || !issue.products.length || !issue.sources.length || !issue.date || !issue.provenance.collectedAt) errors.push({path:'composition',message:'Studio composition requires product dossiers, sources and explicit dates'});
    for(const [i,s]of issue.sources.entries()){
      if(ids.has(s.id))errors.push({path:`sources.${i}.id`,message:'Duplicate source id'});ids.add(s.id);
      if(!issue.demo && s.kind==='internal')errors.push({path:`sources.${i}`,message:'Internal evidence cannot be included in a public magazine'});
      if(!issue.demo && isExampleUrl(s.url))errors.push({path:`sources.${i}.url`,message:'Example sources are only allowed in demonstration issues'});
      if(Date.parse(s.accessedAt)>now.getTime()+300000)errors.push({path:`sources.${i}.accessedAt`,message:'Source capture cannot be in the future'});
      if(now.getTime()-Date.parse(s.accessedAt)>30*86400000)warnings.push({path:`sources.${i}`,message:'Source is older than 30 days; reconfirm before purchase'});
    }
    const checkRefs=(list,path,required=false)=>{if(required&&!list.length)errors.push({path,message:'A factual claim requires at least one source'});for(const id of list)if(!ids.has(id))errors.push({path,message:`Unknown source reference ${id}`});};
    const checkImage=(im,path)=>{
      if(!im)return;
      if(['unknown','link-only'].includes(im.rights))errors.push({path,message:'Image reuse permission is unresolved; omit image and link to the source'});
      if(im.role==='product'&&im.generated)errors.push({path,message:'Generated images cannot serve as product evidence; use editorial or illustration role'});
      if(im.rights==='editorial-reference' && (issue.design?.distribution!=='internal-reference' || im.generated || !im.sourceId || !im.credit || !im.caption))errors.push({path,message:'Editorial reference images require internal-reference distribution, original source, attribution and caption; this does not grant reuse permission'});
      if(im.sourceId)checkRefs([im.sourceId],path+'.sourceId');
      if(!issue.demo && im.role==='product' && !im.sourceId)errors.push({path,message:'Product images need a source record'});
    };
    checkImage(issue.cover.image,'cover.image');
    if(issue.design)checkRefs(issue.design.brandSourceIds,'design.brandSourceIds',true);
    if(issue.composition==='web-card'){
      if(!issue.webCard||!issue.design||issue.products.length>3)errors.push({path:'webCard',message:'Web card requires a design brief, card content and 1–3 curated showcases'});
      if(issue.webCard){
        if(issue.cover.headlineLines && issue.cover.headlineLines.map(x=>x.text).join('').replace(/\s/g,'')!==issue.cover.headline.replace(/\s/g,''))errors.push({path:'cover.headlineLines',message:'Headline lockup must preserve the exact headline wording'});
        issue.webCard.craftStages?.forEach((step,i)=>checkRefs(step.sourceIds,`webCard.craftStages.${i}.sourceIds`,true));
        checkRefs(issue.webCard.pullQuote.sourceIds,'webCard.pullQuote.sourceIds',issue.webCard.pullQuote.kind==='source');
        issue.webCard.metrics.forEach((m,i)=>checkRefs(m.sourceIds,`webCard.metrics.${i}.sourceIds`,true));
        checkRefs(issue.webCard.cta.sourceIds,'webCard.cta.sourceIds',issue.webCard.cta.mode==='contact-link');
        if(issue.webCard.cta.mode==='contact-link'&&!issue.webCard.cta.url)errors.push({path:'webCard.cta.url',message:'A contact action requires an actual URL'});
      }
    }else if(issue.webCard)errors.push({path:'webCard',message:'Card content requires web-card composition'});
    issue.products.forEach((p,i)=>{
      const path=`products.${i}`;
      if(productIds.has(p.id))errors.push({path:path+'.id',message:'Duplicate product id'});productIds.add(p.id);
      checkRefs(p.sourceIds,path+'.sourceIds',true);checkImage(p.image,path+'.image');
      for(const [j,s]of p.specs.entries()){
        if(s.visibility!=='public')errors.push({path:`${path}.specs.${j}`,message:'Restricted commercial data must not enter a public issue'});
        checkRefs(s.sourceIds,`${path}.specs.${j}.sourceIds`,s.status!=='unknown');
        if(s.status==='unknown'&&!/unknown|not\s+(?:confirmed|published|stated|available|disclosed)|unconfirmed|pending|待|未知|未/i.test(String(s.value)))errors.push({path:`${path}.specs.${j}.value`,message:'Unknown fields must be explicitly unknown, not a numeric or factual assertion'});
      }
      for(const key of ['moq','leadTime']){
        checkRefs(p[key].sourceIds,`${path}.${key}.sourceIds`,p[key].status!=='unknown');
        if(p[key].status==='unknown'&&!/unknown|not\s+(?:confirmed|published|stated|available|disclosed)|unconfirmed|pending|待|未知|未/i.test(String(p[key].value)))errors.push({path:`${path}.${key}.value`,message:'Unknown purchase terms must be labelled unknown'});
      }
      checkRefs(p.price.sourceIds,path+'.price.sourceIds',['retail','wholesale'].includes(p.price.kind));
      if(['retail','wholesale'].includes(p.price.kind)&&(!p.price.currency||p.price.amount===undefined||!p.price.basis||p.price.status==='unknown'))errors.push({path:path+'.price',message:'A price needs amount, currency, price basis and attributed status'});
      if(['unknown','request-quote'].includes(p.price.kind)&&p.price.amount!==undefined)errors.push({path:path+'.price',message:'Unknown/request-quote price cannot contain an amount'});
      if(['unknown','request-quote'].includes(p.price.kind)&&p.price.status!=='unknown')errors.push({path:path+'.price.status',message:'Unknown/request-quote price must retain unknown status'});
      if(p.price.kind==='wholesale'&&!p.price.minQty)errors.push({path:path+'.price',message:'Wholesale price needs an explicit minimum quantity condition'});
      if(p.price.kind==='retail')warnings.push({path:path+'.price',message:'Retail reference only; do not infer wholesale cost or margin'});
      if(p.price.kind==='wholesale'){
        const allowed=new Set(p.price.sourceIds.map(id=>issue.sources.find(s=>s.id===id)?.url));
        if(!allowed.size)errors.push({path:path+'.price',message:'Wholesale terms require public evidence'});
      }
    });
    issue.insights.forEach((x,i)=>checkRefs(x.sourceIds,`insights.${i}.sourceIds`,true));
    if(issue.demo!==(issue.provenance.mode==='demo'))errors.push({path:'provenance.mode',message:'Demonstration flag and provenance mode must agree'});
    const stats=getReadingStats(issue);
    if(stats.estimatedSeconds>330)errors.push({path:'readingBudget',message:`Estimated ${stats.estimatedSeconds}s exceeds the 5-minute brief budget (330s maximum)`});
    if(stats.estimatedSeconds<120)warnings.push({path:'readingBudget',message:'A short issue is valid; do not pad with invented facts to reach five minutes'});
  }
  const report={valid:errors.length===0,errors,warnings,stats:issue?getReadingStats(issue):null};
  if(throwOnError&&!report.valid)throw new IssueValidationError(report);
  return {...report,issue};
}
