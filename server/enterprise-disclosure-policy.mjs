import { ApiError } from './runtime.mjs';
import { randomUUID, createHash } from 'node:crypto';
import {
  DISCLOSURE_LEVELS, DISCLOSURE_LEVEL_NAMES, customerPrincipal,
  resourceObject, relationForLevel, readRelationForLevel,
} from './enterprise-openfga.mjs';

const LEVELS = Object.freeze(DISCLOSURE_LEVEL_NAMES);
const RESOURCE_TYPES = Object.freeze(['product', 'document', 'memory']);
const STATUSES = Object.freeze(['pending', 'active', 'revoked', 'sync_error']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const IDENTIFIER = /^[A-Za-z0-9._@:+|/-]{1,128}$/u;
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const clean = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = value => new Date(value).toISOString();

export const DISCLOSURE_POLICY_VERSION = 'enterprise-disclosure-v1';
export const DISCLOSURE_FIELD_GROUPS = Object.freeze({
  product: Object.freeze({
    public: ['name', 'description', 'category', 'images'],
    qualified: ['name', 'description', 'category', 'images', 'skus.specs', 'skus.unit', 'documents'],
    commercial: ['name', 'description', 'category', 'images', 'skus.specs', 'skus.unit', 'documents', 'skus.moq', 'skus.leadTimeDays', 'skus.pricingMode', 'skus.pricingNote', 'skus.priceTiers'],
    channel: ['name', 'description', 'category', 'images', 'skus.specs', 'skus.unit', 'documents', 'skus.moq', 'skus.leadTimeDays', 'skus.pricingMode', 'skus.pricingNote', 'skus.priceTiers', 'supply.packaging', 'supply.samplePolicy', 'supply.paymentTerms', 'supply.shippingTerms', 'supply.capacityNote'],
    confidential: ['name', 'description', 'category', 'images', 'skus.specs', 'skus.unit', 'documents', 'skus.moq', 'skus.leadTimeDays', 'skus.pricingMode', 'skus.pricingNote', 'skus.priceTiers', 'supply.packaging', 'supply.samplePolicy', 'supply.paymentTerms', 'supply.shippingTerms', 'supply.capacityNote', 'source'],
  }),
  memory: Object.freeze({ public: ['statement'], qualified: ['statement'], commercial: ['statement'], channel: ['statement'], confidential: ['statement'] }),
  document: Object.freeze({
    public: ['title', 'slotKey', 'tags'],
    qualified: ['title', 'slotKey', 'tags', 'certificate', 'asset'],
    commercial: ['title', 'slotKey', 'tags', 'certificate', 'asset'],
    channel: ['title', 'slotKey', 'tags', 'certificate', 'asset', 'source'],
    confidential: ['title', 'slotKey', 'tags', 'certificate', 'source', 'asset'],
  }),
});

const actorAllowed = actor => actor?.role === 'admin' && typeof actor.subject === 'string' && actor.subject.length > 0;
const id = value => typeof value === 'string' && IDENTIFIER.test(value);
function validateLevel(level) { if (!LEVELS.includes(level)) fail(400,'DISCLOSURE_LEVEL_INVALID','Unknown disclosure level.'); return level; }
function validateCustomer(customerId) { if (!id(customerId)) fail(400,'DISCLOSURE_CUSTOMER_INVALID','Customer identity must be a bounded identifier.'); }
function validateResource(input) {
  if (!input || !RESOURCE_TYPES.includes(input.resourceType) || !UUID.test(input.resourceId)) fail(400,'DISCLOSURE_RESOURCE_INVALID','Disclosure grants require a product or document UUID.');
  if (!Number.isSafeInteger(input.resourceRevision) || input.resourceRevision < 1) fail(400,'DISCLOSURE_REVISION_INVALID','An exact current resource revision is required.');
  if (input.resourceType === 'document' && (!Number.isSafeInteger(input.documentVersion) || input.documentVersion < 1)) fail(400,'DISCLOSURE_VERSION_INVALID','Document grants require an exact document version.');
  if (input.resourceType === 'product' && input.documentVersion !== undefined && input.documentVersion !== null) fail(400,'DISCLOSURE_VERSION_INVALID','Products cannot carry a document version.');
  if (input.resourceType === 'memory' && input.documentVersion !== undefined && input.documentVersion !== null) fail(400,'DISCLOSURE_VERSION_INVALID','Memory resources cannot carry a document version.');
}
function validateExpiry(expiresAt, now) { if (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now) fail(400,'DISCLOSURE_EXPIRY_INVALID','Disclosure grants require a future expiry time.'); }
function tupleFor(grant) { return { user: customerPrincipal(grant.workspaceId,grant.customerId), relation: relationForLevel(grant.maxLevel), object: resourceObject(grant.resourceType,grant.workspaceId,grant.resourceId) }; }
function historyEntry(grant,action,actor,extra={}) { return { revision:grant.revision, action, at:grant.updatedAt, actor:actor.subject, ...extra, grant:{ id:grant.id, customerId:grant.customerId, resourceType:grant.resourceType, resourceId:grant.resourceId, resourceRevision:grant.resourceRevision, ...(grant.documentVersion===undefined?{}:{documentVersion:grant.documentVersion}), maxLevel:grant.maxLevel, fields:grant.fields, expiresAt:grant.expiresAt, status:grant.status } }; }
function validateStoredGrant(grant) {
  if (!grant || typeof grant !== 'object' || !UUID.test(grant.id) || !id(grant.requestId) || !id(grant.workspaceId) || !id(grant.customerId)
      || !RESOURCE_TYPES.includes(grant.resourceType) || !UUID.test(grant.resourceId) || !Number.isSafeInteger(grant.resourceRevision) || grant.resourceRevision < 1
      || !LEVELS.includes(grant.maxLevel) || !STATUSES.includes(grant.status) || !id(grant.createdBy) || typeof grant.authorizedBy !== 'string'
      || !Number.isFinite(Date.parse(grant.createdAt)) || !Number.isFinite(Date.parse(grant.updatedAt)) || !Number.isFinite(Date.parse(grant.expiresAt))
      || !Array.isArray(grant.fields) || grant.fields.length > 50 || grant.fields.some(field=>typeof field!=='string')
      || !Array.isArray(grant.history) || grant.history.length < 1 || grant.history.length > 100) fail(500,'DISCLOSURE_STORE_INVALID','Stored disclosure grant metadata is invalid.');
  if (grant.resourceType==='document' && (!Number.isSafeInteger(grant.documentVersion)||grant.documentVersion<1)) fail(500,'DISCLOSURE_STORE_INVALID','Stored document disclosure grant version is invalid.');
  if (grant.status==='revoked' && (!grant.revokedAt||!grant.revokedBy)) fail(500,'DISCLOSURE_STORE_INVALID','Revoked grants require revocation provenance.');
}
export function validateDisclosureGrant(grant) { validateStoredGrant(grant); return clean(grant); }

export function createEnterpriseDisclosurePolicy({ store, library, artifacts=null, fga=null, workspaceId, resolveResource=null, clock=Date.now }={}) {
  if (!store || typeof store.read!=='function' || typeof store.update!=='function') throw new TypeError('Disclosure policy requires the original workspace store.');
  if (!library || typeof library.getProduct!=='function' || typeof library.getDocument!=='function') throw new TypeError('Disclosure policy requires the original Library service.');
  if (!id(workspaceId)) throw new TypeError('Disclosure policy requires the exact workspace identity.');
  function grants(state) {
    const lib=state.businessLibrary;
    if (!lib || typeof lib!=='object') fail(500,'DISCLOSURE_LIBRARY_MISSING','The original Library is unavailable.');
    lib.disclosureGrants ??= [];
    if (!Array.isArray(lib.disclosureGrants)||lib.disclosureGrants.length>5000) fail(500,'DISCLOSURE_STORE_INVALID','Disclosure grant store is invalid or full.');
    for (const grant of lib.disclosureGrants) validateStoredGrant(grant);
    return lib.disclosureGrants;
  }
  function assertActor(actor) {
    if (!actorAllowed(actor)) fail(403,'DISCLOSURE_ADMIN_REQUIRED','Only an enterprise administrator can authorize or revoke customer disclosure.');
    if (actor.workspaceId!==undefined && actor.workspaceId!==workspaceId) fail(403,'DISCLOSURE_WORKSPACE_MISMATCH','The actor is outside this workspace.');
  }
  function currentResource(input, { forGrant = false } = {}) {
    if (input.resourceType==='memory') {
      if (typeof resolveResource !== 'function') fail(503,'DISCLOSURE_MEMORY_NOT_CONFIGURED','The enterprise memory resolver is not configured.');
      const record=resolveResource({ resourceId: input.resourceId, forGrant });
      if (!record || record.workspaceId !== workspaceId || record.revision!==input.resourceRevision || !['active', ...(forGrant ? ['pending'] : [])].includes(record.status))
        fail(409,'DISCLOSURE_RESOURCE_CHANGED','The memory revision is no longer current.');
      return record;
    }
    if (input.resourceType==='product') {
      const record=library.getProduct(input.resourceId).product;
      if (record.revision!==input.resourceRevision||record.status==='archived') fail(409,'DISCLOSURE_RESOURCE_CHANGED','The approved product revision is no longer current.');
      return record;
    }
    const record=library.getDocument(input.resourceId).document;
    if (record.revision!==input.resourceRevision||record.status!=='active'||record.currentVersion!==input.documentVersion) fail(409,'DISCLOSURE_RESOURCE_CHANGED','The approved document revision/version is no longer current.');
    const asset=record.versions?.find(row=>row.version===record.currentVersion)?.asset;
    if(!asset||!forGrant&&(!input.sourceSnapshot?.asset||hash(asset)!==hash(input.sourceSnapshot.asset))) fail(409,'DISCLOSURE_RESOURCE_CHANGED','The exact granted artifact/version/SHA changed.');
    return record;
  }
  const activeAt=(grant,now)=>grant.status==='active'&&Date.parse(grant.expiresAt)>now;
  function exactGrantFor(input) {
    validateCustomer(input.customerId); validateLevel(input.level); validateResource(input);
    const rows=grants(store.read()).filter(g=>g.workspaceId===workspaceId&&g.customerId===input.customerId&&g.resourceType===input.resourceType&&g.resourceId===input.resourceId&&g.resourceRevision===input.resourceRevision&&(input.resourceType!=='document'||g.documentVersion===input.documentVersion)&&activeAt(g,clock()));
    const best=rows.sort((a,b)=>DISCLOSURE_LEVELS[b.maxLevel]-DISCLOSURE_LEVELS[a.maxLevel]||b.revision-a.revision)[0];
    if(!best||DISCLOSURE_LEVELS[best.maxLevel]<DISCLOSURE_LEVELS[input.level]) fail(403,'DISCLOSURE_SCOPE_DENIED','The customer is not authorized for this information level.');
    const requiredFields=DISCLOSURE_FIELD_GROUPS[input.resourceType][input.level];
    if(best.fields.length&&requiredFields.some(field=>!best.fields.includes(field))) fail(403,'DISCLOSURE_FIELDS_DENIED','The customer grant does not include all fields required by this information level.');
    return best;
  }
  async function grant(body,actor,signal) {
    assertActor(actor);
    if(!body||typeof body!=='object'||!id(body.requestId)||typeof body.purpose!=='string'||!body.purpose.trim()||body.purpose.length>500) fail(400,'DISCLOSURE_INPUT_INVALID','A requestId and human-readable purpose are required.');
    validateCustomer(body.customerId); validateLevel(body.maxLevel); validateResource(body); validateExpiry(body.expiresAt,clock());
    const record=currentResource(body,{forGrant:true});
    const fields=body.fields===undefined?[...DISCLOSURE_FIELD_GROUPS[body.resourceType][body.maxLevel]]:body.fields;
    if(!Array.isArray(fields)||fields.length<1||fields.length>50||new Set(fields).size!==fields.length||fields.some(field=>typeof field!=='string'||field.length>80)||!fields.every(field=>DISCLOSURE_FIELD_GROUPS[body.resourceType][body.maxLevel].includes(field))) fail(400,'DISCLOSURE_FIELDS_INVALID','A grant cannot expose fields above its selected information level.');
    const fingerprint=hash({workspaceId,customerId:body.customerId,resourceType:body.resourceType,resourceId:body.resourceId,resourceRevision:body.resourceRevision,documentVersion:body.documentVersion??null,maxLevel:body.maxLevel,fields,expiresAt:body.expiresAt,purpose:body.purpose.trim()});
    const all=grants(store.read()), existing=all.find(g=>g.requestId===body.requestId);
    if(existing){if(existing.fingerprint!==fingerprint||existing.createdBy!==actor.subject) fail(409,'DISCLOSURE_IDEMPOTENCY_CONFLICT','requestId already belongs to another disclosure operation.');return {grant:clean(existing),idempotent:true};}
    if(all.some(g=>activeAt(g,clock())&&g.customerId===body.customerId&&g.resourceType===body.resourceType&&g.resourceId===body.resourceId&&(body.resourceType!=='document'||g.documentVersion===body.documentVersion)&&DISCLOSURE_LEVELS[g.maxLevel]>=DISCLOSURE_LEVELS[body.maxLevel])) fail(409,'DISCLOSURE_ALREADY_GRANTED','An equal or stronger active grant already exists.');
    const time=iso(clock()), draft={id:randomUUID(),requestId:body.requestId,fingerprint,workspaceId,customerId:body.customerId,resourceType:body.resourceType,resourceId:body.resourceId,resourceRevision:body.resourceRevision,...(body.documentVersion===undefined?{}:{documentVersion:body.documentVersion}),maxLevel:body.maxLevel,fields,purpose:body.purpose.trim(),status:'pending',createdAt:time,createdBy:actor.subject,authorizedAt:null,authorizedBy:actor.subject,expiresAt:body.expiresAt,revokedAt:null,revokedBy:null,revokeReason:null,updatedAt:time,revision:1,history:[],sourceSnapshot:{revision:record.revision,...(body.resourceType==='document'?{documentVersion:record.currentVersion,asset:clean(record.versions?.find(row=>row.version===record.currentVersion)?.asset)}:{})}};
    draft.history.push(historyEntry(draft,'created',actor,{purpose:draft.purpose}));
    const pendingRevision=draft.revision;
    const isPendingDraft=row=>row?.status==='pending'&&row.revision===pendingRevision&&row.requestId===body.requestId&&row.fingerprint===fingerprint;
    await store.update(state=>{grants(state).push(draft);return null;});
    if(!fga){await store.update(state=>{const row=grants(state).find(g=>g.id===draft.id);if(isPendingDraft(row)){row.status='sync_error';row.updatedAt=iso(clock());row.revision++;row.history.push(historyEntry(row,'sync_error',actor,{reason:'FGA_NOT_CONFIGURED'}));}return null;});fail(503,'DISCLOSURE_AUTHZ_NOT_CONFIGURED','OpenFGA is not configured; the grant remains denied.');}
    let writeCompleted=false;
    try{
      await fga.write({writes:[tupleFor(draft)]},signal);
      writeCompleted=true;
      const activated=await store.update(state=>{const row=grants(state).find(g=>g.id===draft.id);if(!row) fail(500,'DISCLOSURE_STORE_INVALID','Grant disappeared before activation.');if(!isPendingDraft(row))fail(409,'DISCLOSURE_GRANT_CHANGED','The pending grant changed before activation; authorization was refused.');row.status='active';row.authorizedAt=iso(clock());row.updatedAt=iso(clock());row.revision++;row.history.push(historyEntry(row,'authorized',actor));return clean(row);});
      return {grant:activated,idempotent:false};
    }catch(error){
      let cleanupError=null;
      // A delayed write can land after revoke's delete. Compensate even if its
      // response failed after applying, without reusing an aborted caller signal.
      if(writeCompleted||grants(store.read()).find(g=>g.id===draft.id)?.status==='revoked'){
        try{await fga.write({deletes:[tupleFor(draft)]});}catch(failure){cleanupError=failure;}
      }
      await store.update(state=>{const row=grants(state).find(g=>g.id===draft.id);if(isPendingDraft(row)){row.status='sync_error';row.updatedAt=iso(clock());row.revision++;row.history.push(historyEntry(row,'sync_error',actor,{reason:error?.code||'FGA_WRITE_FAILED'}));}return null;});
      if(cleanupError)fail(503,'DISCLOSURE_CLEANUP_FAILED','Authorization was refused, but its external tuple cleanup failed; reconciliation is required.');
      throw error;
    }
  }
  async function revoke(grantId,body={},actor,signal) {
    assertActor(actor); if(!UUID.test(grantId)) fail(400,'DISCLOSURE_GRANT_INVALID','Invalid disclosure grant id.');
    const current=grants(store.read()).find(g=>g.id===grantId); if(!current) fail(404,'DISCLOSURE_GRANT_NOT_FOUND','Disclosure grant not found.');
    if(body.reason!==undefined&&(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>500)) fail(400,'DISCLOSURE_REVOKE_REASON_INVALID','A non-empty bounded revoke reason is required.');
    const {revoked,idempotent}=await store.update(state=>{const row=grants(state).find(g=>g.id===grantId);if(!row)fail(404,'DISCLOSURE_GRANT_NOT_FOUND','Disclosure grant not found.');const idempotent=row.status==='revoked';if(!idempotent){const now=iso(clock());row.status='revoked';row.revokedAt=now;row.revokedBy=actor.subject;row.revokeReason=body.reason?.trim()||'revoked_by_admin';row.updatedAt=now;row.revision++;row.history.push(historyEntry(row,'revoked',actor,{reason:row.revokeReason}));}return {revoked:clean(row),idempotent};});
    // Local revocation is durable even on a failed delete. Every explicit retry
    // retries the original idempotent FGA delete; revoked is not cleanup proof.
    if(fga){try{await fga.write({deletes:[tupleFor(revoked)]},signal);}catch(error){return {grant:clean(grants(store.read()).find(g=>g.id===grantId)),syncError:error?.code||'FGA_DELETE_FAILED',idempotent};}}
    return {grant:clean(grants(store.read()).find(g=>g.id===grantId)),idempotent};
  }
  function projectProduct(record, fields) {
    const allowed = new Set(fields), out = { id: record.id, revision: record.revision };
    for (const field of ['name','description','category']) if (allowed.has(field)) out[field] = record[field];
    if (allowed.has('images')) out.images = record.images.map(image => ({ id: image.id, alt: image.alt, order: image.order, isPrimary: image.isPrimary }));
    if (fields.some(field => field.startsWith('skus.'))) {
      out.skus = record.skus.map(sku => {
        const row = { id: sku.id };
        if (allowed.has('skus.specs')) row.specs = structuredClone(sku.specs);
        if (allowed.has('skus.unit')) row.unit = sku.unit;
        if (allowed.has('skus.moq')) row.moq = sku.moq;
        if (allowed.has('skus.leadTimeDays')) row.leadTimeDays = sku.leadTimeDays;
        if (allowed.has('skus.pricingMode')) row.pricingMode = sku.pricingMode;
        if (allowed.has('skus.pricingNote')) row.pricingNote = sku.pricingNote;
        if (allowed.has('skus.priceTiers')) row.priceTiers = structuredClone(sku.priceTiers);
        return row;
      });
    }
    if (allowed.has('documents')) out.documents = structuredClone(record.documents);
    const supplyFields = ['packaging','samplePolicy','paymentTerms','shippingTerms','capacityNote'].filter(field => allowed.has('supply.' + field));
    if (supplyFields.length) out.supply = Object.fromEntries(supplyFields.map(field => [field, record.supply[field]]));
    if (allowed.has('source')) out.source = structuredClone(record.source);
    return out;
  }
  async function readDocumentAsset(input, signal) {
    if (input.resourceType !== 'document') fail(400,'DISCLOSURE_RESOURCE_INVALID','Only documents have customer-readable raw assets.');
    const authorization = await check(input, signal);
    if (!authorization.grant.fields.includes('asset')) fail(403,'DISCLOSURE_FIELDS_DENIED','This customer grant does not include the document asset.');
    if (!artifacts || typeof artifacts.download !== 'function') fail(503,'DISCLOSURE_ASSET_NOT_CONFIGURED','The original artifact service is unavailable.');
    const document = currentResource(authorization.grant);
    const version = document.versions.find(row => row.version === document.currentVersion);
    if (!version?.asset?.artifactId || version.asset.version !== input.documentVersion || version.asset.sha256 !== input.sourceSha256 && input.sourceSha256 !== undefined)
      fail(409,'DISCLOSURE_ASSET_CHANGED','The approved document asset changed.');
    const downloaded = await artifacts.download(version.asset.artifactId, { version: version.asset.version });
    if (!downloaded?.version || downloaded.version.sha256 !== version.asset.sha256 || downloaded.bytes?.length !== downloaded.version.size)
      fail(409,'DISCLOSURE_ASSET_INTEGRITY','The document asset failed the saved integrity check.');
    await check(input, signal);
    return { filename: downloaded.filename, mimeType: downloaded.mimeType, bytes: downloaded.bytes, sourceSha256: downloaded.version.sha256, grant: authorization.grant };
  }

  function projectMemory(record, fields) {
    if (!fields.includes('statement')) fail(403,'DISCLOSURE_FIELDS_DENIED','The customer memory grant does not include the statement field.');
    return { id: record.id, revision: record.revision, statement: record.statement };
  }
  function projectDocument(record, fields) {
    const allowed = new Set(fields), out = { id: record.id, revision: record.revision };
    for (const field of ['title','slotKey','tags']) if (allowed.has(field)) out[field] = structuredClone(record[field]);
    const version = record.versions.find(row => row.version === record.currentVersion);
    if (allowed.has('certificate')) out.certificate = structuredClone(version?.certificate ?? null);
    if (allowed.has('source')) out.source = structuredClone(record.source);
    if (allowed.has('asset')) out.asset = structuredClone(version?.asset ?? null);
    return out;
  }
  async function read(input, signal) {
    const authorization = await check(input, signal);
    const resource = currentResource(authorization.grant);
    const fields = authorization.grant.fields;
    return {
      policyVersion: DISCLOSURE_POLICY_VERSION,
      customerId: input.customerId,
      resourceType: input.resourceType,
      resource: input.resourceType === 'product' ? projectProduct(resource, fields) : projectDocument(resource, fields),
      grant: authorization.grant,
      asOf: iso(clock()),
    };
  }
  function projectProduct(record, fields) {
    const allowed = new Set(fields), out = { id: record.id, revision: record.revision };
    for (const field of ['name','description','category']) if (allowed.has(field)) out[field] = record[field];
    if (fields.some(field => field.startsWith('skus.'))) {
      out.skus = record.skus.map(sku => {
        const row = { id: sku.id };
        if (allowed.has('skus.specs')) row.specs = structuredClone(sku.specs);
        if (allowed.has('skus.unit')) row.unit = sku.unit;
        if (allowed.has('skus.moq')) row.moq = sku.moq;
        if (allowed.has('skus.leadTimeDays')) row.leadTimeDays = sku.leadTimeDays;
        if (allowed.has('skus.pricingMode')) row.pricingMode = sku.pricingMode;
        if (allowed.has('skus.pricingNote')) row.pricingNote = sku.pricingNote;
        if (allowed.has('skus.priceTiers')) row.priceTiers = structuredClone(sku.priceTiers);
        return row;
      });
    }
    if (allowed.has('documents')) out.documents = structuredClone(record.documents);
    const supplyFields = ['packaging','samplePolicy','paymentTerms','shippingTerms','capacityNote'].filter(field => allowed.has('supply.' + field));
    if (supplyFields.length) out.supply = Object.fromEntries(supplyFields.map(field => [field, record.supply[field]]));
    if (allowed.has('source')) out.source = structuredClone(record.source);
    return out;
  }
  function projectDocument(record, fields) {
    const allowed = new Set(fields), out = { id: record.id, revision: record.revision };
    for (const field of ['title','slotKey','tags']) if (allowed.has(field)) out[field] = structuredClone(record[field]);
    const version = record.versions.find(row => row.version === record.currentVersion);
    if (allowed.has('certificate')) out.certificate = structuredClone(version?.certificate ?? null);
    if (allowed.has('source')) out.source = structuredClone(record.source);
    if (allowed.has('asset')) out.asset = structuredClone(version?.asset ?? null);
    return out;
  }
  async function read(input,signal) {
    const authorization = await check(input,signal);
    const resource = currentResource(authorization.grant);
    return { policyVersion: DISCLOSURE_POLICY_VERSION, customerId: input.customerId, resourceType: input.resourceType,
      resource: input.resourceType === 'product' ? projectProduct(resource, authorization.grant.fields) : input.resourceType === 'document' ? projectDocument(resource, authorization.grant.fields) : projectMemory(resource, authorization.grant.fields),
      grant: authorization.grant, asOf: iso(clock()) };
  }

  async function check(input,signal) {
    const grant=exactGrantFor(input); currentResource(grant);
    if(!fga) fail(503,'DISCLOSURE_AUTHZ_NOT_CONFIGURED','OpenFGA is not configured; disclosure is denied.');
    const allowed=await fga.check({user:customerPrincipal(workspaceId,input.customerId),relation:readRelationForLevel(input.level),object:resourceObject(input.resourceType,workspaceId,input.resourceId)},signal);
    if(!allowed) fail(403,'DISCLOSURE_SCOPE_DENIED','OpenFGA denied this customer disclosure.');
    signal?.throwIfAborted();
    const current=exactGrantFor(input);currentResource(current);
    if(current.id!==grant.id||current.revision!==grant.revision)fail(403,'DISCLOSURE_SCOPE_DENIED','The exact disclosure grant changed during authorization.');
    return {allowed:true,grant:clean(grant),policyVersion:DISCLOSURE_POLICY_VERSION};
  }
  function list({customerId,resourceType,status}={}) {
    if(customerId!==undefined) validateCustomer(customerId);
    if(resourceType!==undefined&&!RESOURCE_TYPES.includes(resourceType)) fail(400,'DISCLOSURE_RESOURCE_INVALID','Unknown disclosure resource type.');
    if(status!==undefined&&!STATUSES.includes(status)) fail(400,'DISCLOSURE_STATUS_INVALID','Unknown disclosure status.');
    return {policyVersion:DISCLOSURE_POLICY_VERSION,grants:grants(store.read()).filter(g=>(customerId===undefined||g.customerId===customerId)&&(resourceType===undefined||g.resourceType===resourceType)&&(status===undefined||g.status===status)).map(clean)};
  }
  function explain({customerId,resourceType,resourceId}) {
    validateCustomer(customerId); if(!RESOURCE_TYPES.includes(resourceType)||!UUID.test(resourceId)) fail(400,'DISCLOSURE_RESOURCE_INVALID','Invalid disclosure resource.');
    return {policyVersion:DISCLOSURE_POLICY_VERSION,customerId,resourceType,resourceId,asOf:iso(clock()),decisions:grants(store.read()).filter(g=>g.workspaceId===workspaceId&&g.customerId===customerId&&g.resourceType===resourceType&&g.resourceId===resourceId).sort((a,b)=>b.revision-a.revision).map(g=>({grantId:g.id,revision:g.revision,status:g.status,maxLevel:g.maxLevel,fields:g.fields,expiresAt:g.expiresAt,createdBy:g.createdBy,authorizedBy:g.authorizedBy,revokedAt:g.revokedAt,revokedBy:g.revokedBy,sourceSnapshot:g.sourceSnapshot,history:g.history}))};
  }
  function status(){return {provider:'OpenFGA',enabled:!!fga,failClosed:true,policyVersion:DISCLOSURE_POLICY_VERSION,levels:LEVELS};}
  return Object.freeze({grant,revoke,check,read,readDocumentAsset,list,explain,status,levels:DISCLOSURE_LEVELS});
}
