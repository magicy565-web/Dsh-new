import {createHash} from 'node:crypto';

// Read-only adapter over DSH's authoritative library, never a second catalogue.
// Native library scope is the local profile. The commerce service supplies an
// explicit workspace/project mapping and a separately approved disclosure grant.
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PRODUCT=/^prd_[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const DOCUMENT=/^doc_[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const CERTIFICATES=new Set(['license','certificate','test_report']);
const MAX_BYTES=96_000;
export const DISCLOSED_PRODUCT_FIELDS=Object.freeze(['name','description','category','skus.code','skus.unit','skus.moq','skus.leadTimeDays','skus.specs']);
const SPEC_KEYS=new Set(['material','materials','fabric','composition','dimensions','dimension','size','sizes','weight','color','colour','colors','colours','capacity','volume','length','width','height','thickness','diameter','gsm','finish','voltage','power','frequency','temperature','材质','材料','面料','成分','尺寸','尺码','重量','颜色','容量','长度','宽度','高度','厚度','直径','克重','表面处理','电压','功率','频率','温度']);

export class CommerceResourceError extends Error{
  constructor(code,message,status=409){super(message);this.code=code;this.status=status;}
}
const fail=(code,message,status)=>{throw new CommerceResourceError(code,message,status);};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const text=(value,maximum)=>{if(typeof value!=='string'||value.length>maximum)fail('RESOURCE_INVALID','Native product fields exceed the disclosure schema.');return value;};
const maybeInteger=value=>value==null?null:Number.isSafeInteger(value)&&value>=0?value:fail('RESOURCE_INVALID','Native numeric fields are invalid.');
const abort=signal=>{if(signal?.aborted)fail('RESOURCE_CANCELLED','Resource reading was cancelled.');};
function shape(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('RESOURCE_INPUT','Use an exact resource mapping.');}
function validateScope({workspaceId,projectId,ref}){
  if(!UUID.test(workspaceId??'')||!ID.test(projectId??'')||typeof ref!=='string'||!/^(product|approved_document):[A-Za-z0-9._:-]{1,128}$/.test(ref))fail('RESOURCE_SCOPE','Resource scope is invalid.',403);
}
function validateSource(sourceRef,ref){
  if(sourceRef?.kind==='product'){
    shape(sourceRef,['kind','id','revision']);
    if(!PRODUCT.test(sourceRef.id??'')||!Number.isSafeInteger(sourceRef.revision)||sourceRef.revision<1||!ref.startsWith('product:'))fail('RESOURCE_INPUT','Pin an exact native product revision.');
  }else if(sourceRef?.kind==='document'){
    shape(sourceRef,['kind','id','version','sha256']);
    if(!DOCUMENT.test(sourceRef.id??'')||!Number.isSafeInteger(sourceRef.version)||sourceRef.version<1||!SHA.test(sourceRef.sha256??'')||ref!==`approved_document:${sourceRef.id}`)fail('RESOURCE_INPUT','Pin an exact native document version and hash.');
  }else fail('RESOURCE_INPUT','Unsupported native source type.');
}
function safeProduct(product){
  if(!product||product.status==='archived'||!Array.isArray(product.skus)||product.skus.length>100)fail('RESOURCE_UNAVAILABLE','Native product is unavailable.');
  return {
    name:text(product.name,200),description:text(product.description??'',12_000),category:text(product.category??'',200),
    skus:product.skus.map(sku=>({
      code:text(sku.code,100),unit:text(sku.unit??'',100),moq:maybeInteger(sku.moq),leadTimeDays:maybeInteger(sku.leadTimeDays),
      specs:(Array.isArray(sku.specs)?sku.specs:[]).filter(s=>typeof s?.key==='string'&&SPEC_KEYS.has(s.key.trim().toLowerCase()))
        .map(s=>({key:text(s.key,100),value:text(s.value??'',500)})),
    })),
    verification:'supplier_provided',contentRole:'reference-data',
  };
}
function sourceError(error){
  if(error instanceof CommerceResourceError)throw error;
  // Do not expose native storage paths, exception internals or attachment URLs.
  if(/ARCHIVED|CHANGED|NOT_FOUND|REFERENCE_|PRODUCT_CONTEXT_/.test(String(error?.code??'')))fail('RESOURCE_CHANGED','The pinned native resource is unavailable, changed or no longer approved.');
  fail('RESOURCE_UNAVAILABLE','The native library could not verify this source.',503);
}

export function createResourceAdapter({getLibrary,assertScope,clock=Date.now}={}){
  if(typeof getLibrary!=='function'||typeof assertScope!=='function')throw new TypeError('A native service lookup and trusted scope validator are required.');
  async function resolve(mapping,{signal}={}){
    shape(mapping,['workspaceId','projectId','ref','sourceRef']);validateScope(mapping);validateSource(mapping.sourceRef,mapping.ref);
    // Freeze caller-owned arguments before the first asynchronous boundary.
    const pin=structuredClone(mapping),sourceRef=pin.sourceRef;
    abort(signal);
    let library;
    function fence(){
      abort(signal);
      const scopeProof=assertScope({workspaceId:pin.workspaceId,projectId:pin.projectId,ref:pin.ref,sourceRef:structuredClone(sourceRef)}, {signal});
      abort(signal);
      if(scopeProof&&typeof scopeProof.then==='function')fail('RESOURCE_SCOPE','Scope verification must be synchronous.',503);
      if(scopeProof===false)fail('RESOURCE_SCOPE','Resource mapping or disclosure was revoked.',403);
      if(sourceRef.kind==='document'&&scopeProof?.disclosureApproved!==true)fail('RESOURCE_DISCLOSURE_REQUIRED','An explicit owner approval of this exact document disclosure is required.',403);
      const current=getLibrary();
      if(!current||(library&&current!==library))fail('RESOURCE_UNAVAILABLE','The native library is no longer available.',503);
      library=current;
    }
    fence();
    let content,source;
    try{
      if(sourceRef.kind==='product'){
        if(typeof library.productContext!=='function')fail('RESOURCE_UNAVAILABLE','Native product context is unavailable.',503);
        const context=await library.productContext({productId:sourceRef.id,expectedRevision:sourceRef.revision},{signal});
        fence();
        if(context?.source?.productId!==sourceRef.id||context.source.revision!==sourceRef.revision||context.product?.id!==sourceRef.id||context.product.revision!==sourceRef.revision||context.product.status==='archived')fail('RESOURCE_CHANGED','The exact native product revision is unavailable.');
        content=safeProduct(context.product);
        source={kind:'native-product',scope:'profile',productId:sourceRef.id,revision:sourceRef.revision,reviewState:'unreviewed',disclosedFields:[...DISCLOSED_PRODUCT_FIELDS]};
      }else{
        if(typeof library.checkReferences!=='function'||typeof library.readReferences!=='function'||typeof library.document!=='function')fail('RESOURCE_UNAVAILABLE','Native document references are unavailable.',503);
        const reference={documentId:sourceRef.id,version:sourceRef.version,sha256:sourceRef.sha256};
        const checked=await library.checkReferences([reference]);fence();
        const metadata=checked?.references?.[0];
        if(!metadata||metadata.documentId!==sourceRef.id||metadata.version!==sourceRef.version||metadata.sha256!==sourceRef.sha256||metadata.reviewState!=='verified'||metadata.isCurrentVersion!==true)fail('RESOURCE_UNAPPROVED','Only the current approved exact document version can be disclosed.');
        const record=(await library.document(sourceRef.id))?.document;fence();
        if(record?.status!=='active'||record.currentVersion!==sourceRef.version)fail('RESOURCE_CHANGED','The selected document is archived or superseded.');
        if(CERTIFICATES.has(record.slotKey)){
          const c=metadata.certificate,day=new Date(clock()).toISOString().slice(0,10);
          if(!c||!['dated','no_expiry'].includes(c.expiryMode)||c.validFrom&&c.validFrom>day||c.expiryMode==='dated'&&(!c.validUntil||c.validUntil<day))fail('RESOURCE_EXPIRED','Document validity cannot be established for today.');
        }
        const read=await library.readReferences([reference],{signal});fence();
        const item=read?.items?.[0];
        if(!item||typeof item.content!=='string'||item.source?.documentId!==sourceRef.id||item.source.version!==sourceRef.version||item.source.sha256!==sourceRef.sha256||item.source.reviewState!=='verified'||item.source.isCurrentVersion!==true||createHash('sha256').update(item.content).digest('hex')!==sourceRef.sha256)fail('RESOURCE_CHANGED','Document bytes or approval changed during reading.');
        content={title:text(metadata.title,200),text:item.content,contentRole:'reference-data'};
        source={kind:'native-document',scope:'profile',documentId:sourceRef.id,version:sourceRef.version,sha256:sourceRef.sha256,reviewState:'verified'};
      }
    }catch(error){sourceError(error);}
    fence();
    if(Buffer.byteLength(JSON.stringify({content,source}))>MAX_BYTES)fail('RESOURCE_TOO_LARGE','The scoped resource exceeds the bounded worker context.',413);
    return {...pin,version:sourceRef.revision??sourceRef.version,sha256:digest({content,source}),content,source};
  }
  async function verify(snapshot,scope,{signal}={}){
    validateScope(scope);
    if(!snapshot||snapshot.workspaceId!==scope.workspaceId||snapshot.projectId!==scope.projectId||snapshot.ref!==scope.ref||!SHA.test(snapshot.sha256??'')||digest({content:snapshot.content,source:snapshot.source})!==snapshot.sha256)fail('RESOURCE_SCOPE','The granted snapshot does not match this exact workspace and project.',403);
    const current=await resolve({...scope,sourceRef:snapshot.sourceRef},{signal});
    if(current.sha256!==snapshot.sha256||current.version!==snapshot.version)fail('RESOURCE_CHANGED','The disclosed native content changed after approval. Review a new grant.');
    return current;
  }
  return Object.freeze({resolve,verify});
}
