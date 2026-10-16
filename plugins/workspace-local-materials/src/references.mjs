import path from 'node:path';
import {ownerFileWorkspace,exact,fail,id,json,same} from './reference-files.mjs';
import {parseSelectedSource,digest} from './parse-source.mjs';
import {businessMemory} from './business-memory.mjs';
import {looksLikeCredential} from './public-input.mjs';
import {pairLocalToolHistory} from './pairs.mjs';
export async function createReferences({config,files,readTool,packageRoot,fence}){
  const store=await ownerFileWorkspace(config,{packageRoot,fence}),cache=new Map(),selected=new Map();
  const statistics={sourceReads:0,referenceWrites:0,memoryWrites:0};
  const bounded=(value,max=1000)=>{if(typeof value!=='string'||value.length>max||looksLikeCredential(value))fail('LOCAL_REFERENCE_TEXT_REFUSED');return value;};
  const selectedKey=source=>'selected-source:'+source.sha256;
  function rememberSelected(source,content=false){
    const key=source.sha256+':'+source.name,previous=selected.get(key);
    if(!previous&&selected.size>=256)fail('LOCAL_REFERENCE_DISCLOSURE_LIMIT');
    selected.set(key,{name:source.name,sha256:source.sha256,content:content||previous?.content===true});
  }
  // Selected manifest metadata is also disclosed by the host. Its stable hash
  // resource is independent of input-N, which can be reused for another file.
  for(const source of files.manifest)rememberSelected(source);
  async function authorize({phase='context'}={}){return store.reauthorize([...new Set([...selected.values()].map(selectedKey))],phase);}
  async function noteSelectedRead(inputId){
    const source=files.manifest.find(item=>item.id===inputId);if(!source)fail('LOCAL_INPUT_NOT_SELECTED');
    await files.snapshot(inputId);rememberSelected(source,true);
    await store.guard('selected:read',[selectedKey(source)]);
  }
  function disclosureSnapshot(){return {schema:1,scope:store.scope,epoch:store.epoch(),files:store.dependencies(),selected:[...selected.values()]};}
  async function restoreDisclosure(snapshot){
    exact(snapshot,['schema','scope','epoch','files','selected']);
    if(snapshot.schema!==1||!same(snapshot.scope,store.scope)||snapshot.epoch!==store.epoch()||!Array.isArray(snapshot.selected)||snapshot.selected.length>256)fail('LOCAL_REFERENCE_HISTORY_DEPENDENCIES_REQUIRED');
    await store.restoreDependencies(snapshot.files);
    for(const source of snapshot.selected){
      exact(source,['name','sha256','content']);
      if(typeof source.name!=='string'||!source.name||source.name.length>200||!/^[a-f0-9]{64}$/.test(source.sha256||'')||typeof source.content!=='boolean')fail('LOCAL_REFERENCE_HISTORY_DEPENDENCIES_REQUIRED');
      if(source.content&&!await archivedSource(source))fail('LOCAL_REFERENCE_HISTORY_SOURCE_NOT_RETAINED');
      rememberSelected(source,source.content);
    }
    await authorize();
  }
  const unique=items=>[...new Map(items.map(item=>[item.file,item])).values()];
  async function finish(data){if(data.files){data.files=unique(data.files);for(const file of data.files)await store.read(file.file,file.sha256);}const authorization=await store.guard('deliver',(data.files||[]).map(f=>f.file));return {...data,authorization};}
  async function view(parsed,input){
    if(input.rowStart!==undefined&&(!Number.isSafeInteger(input.rowStart)||input.rowStart<1||!parsed.table||input.rowStart>parsed.table.rows.length))fail('LOCAL_REFERENCE_VIEW_REFUSED');
    const offset=input.offset??(input.rowStart?parsed.table?.rows[input.rowStart-1]?.start:0)??0,limit=input.limit??6000;
    if(!Number.isSafeInteger(offset)||offset<0||offset>parsed.text.length||!Number.isSafeInteger(limit)||limit<1||limit>12000)fail('LOCAL_REFERENCE_VIEW_REFUSED');
    const rows=[];let bytes=0;
    for(const row of parsed.table?.rows.slice((input.rowStart||1)-1)||[]){const size=Buffer.byteLength(JSON.stringify(row));if(rows.length===20||bytes+size>8000)break;rows.push(row);bytes+=size;}
    return finish({status:parsed.status,readRef:parsed.readRef,inputId:parsed.inputId,documentKey:parsed.documentKey,name:parsed.name,sha256:parsed.sha256,
      parsedHash:parsed.parsedHash,parser:parsed.parser,format:parsed.format,limitations:parsed.limitations,ocrPerformed:false,
      view:{offset,text:parsed.text.slice(offset,offset+limit),totalChars:parsed.text.length,truncated:offset+limit<parsed.text.length},
      table:parsed.table?{headers:parsed.table.headers,rows,totalRows:parsed.table.rows.length}:null});
  }
  async function source(input){
    exact(input,['inputId','documentKey','purpose','offset','limit','rowStart']);
    if(!id(input.documentKey))fail('LOCAL_REFERENCE_SOURCE_KEY_REQUIRED');
    bounded(input.purpose||'',300);await authorize();
    const parsed=await parseSelectedSource({files,readTool,inputId:input.inputId,documentKey:input.documentKey,purpose:input.purpose});
    if(parsed.status==='unavailable')return finish(parsed);
    rememberSelected(parsed,true);
    cache.set(parsed.readRef,parsed);statistics.sourceReads++;return view(parsed,input);
  }
  async function fromStored(item,original){
    const metadata=JSON.parse(await store.read(item.metadata.file,item.metadata.sha256));
    const text=(await store.read(item.text.file,item.text.sha256)).toString(),bytes=await store.read(item.original.file,item.original.sha256);
    const table=item.table?JSON.parse((await store.read(item.table.file,item.table.sha256)).toString()):null;
    if(digest(text)!==metadata.parsedHash)fail('LOCAL_REFERENCE_HASH_CHANGED');
    const inputId=original?.inputId||metadata.inputId,documentKey=metadata.documentKey,parser=metadata.parser;
    const readRef=digest(JSON.stringify({inputId,documentKey,sha256:metadata.sha256,parsedHash:metadata.parsedHash,parser}));
    return {...metadata,inputId,bytes,text,table,readRef};
  }
  async function readReference(index,key,revision,sha){
    if(!id(key))fail('LOCAL_REFERENCE_KEY_REQUIRED');
    if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))fail('LOCAL_REFERENCE_REVISION_REQUIRED');
    const versions=index.references[key]||[],stored=revision?versions.find(v=>v.revision===revision):versions.at(-1);
    if(!stored)fail('LOCAL_REFERENCE_NOT_FOUND');if(sha&&sha!==stored.sha256)fail('LOCAL_REFERENCE_HASH_CHANGED');
    const record=JSON.parse(await store.read(stored.file,stored.sha256));
    if(!same(record.scope,store.scope))fail('LOCAL_REFERENCE_SCOPE_MISMATCH');
    for(const fact of Object.values(record.facts)){
      const meta=index.sources[fact.source.documentKey]?.find(v=>v.version===fact.source.version);
      if(!meta||meta.sha256!==fact.source.sha256)fail('LOCAL_REFERENCE_SOURCE_CHANGED');
      await store.read(meta.metadata.file,meta.metadata.sha256);if(meta.table)await store.read(meta.table.file,meta.table.sha256);
      await store.read(meta.original.file,meta.original.sha256);const text=(await store.read(meta.text.file,meta.text.sha256)).toString();
      if(text.slice(fact.source.start,fact.source.end)!==fact.source.quote)fail('LOCAL_REFERENCE_SOURCE_CHANGED');
    }
    const sourceFiles=Object.values(record.facts).flatMap(f=>{
      const meta=index.sources[f.source.documentKey].find(v=>v.version===f.source.version);return [meta.original,meta.text,meta.metadata,...(meta.table?[meta.table]:[])];});
    return {record,storage:stored,sourceFiles:unique(sourceFiles)};
  }
  async function commitRequest(input,mutate){
    if(!id(input.requestId))fail('LOCAL_REFERENCE_REQUEST_ID_REQUIRED');const bodyHash=digest(JSON.stringify(input));
    const result=await store.transaction(async index=>{
      const prior=index.requests[input.requestId];if(prior){if(prior.bodyHash!==bodyHash)fail('LOCAL_REFERENCE_REQUEST_CHANGED');return prior.receipt;}
      if(Object.keys(index.requests).length>=128)fail('LOCAL_REFERENCE_STORAGE_LIMIT');
      const receipt=await mutate(index);index.requests[input.requestId]={bodyHash,receipt};return receipt;
    });return finish(result);
  }
  async function preserveSource(index,parsed,key){
    const versions=index.sources[parsed.documentKey]||[];
    const prior=versions.find(v=>v.sha256===parsed.sha256&&v.parsedHash===parsed.parsedHash);if(prior)return prior;
    if(Object.values(index.sources).flat().length>=32)fail('LOCAL_REFERENCE_STORAGE_LIMIT');
    const version=versions.length+1,stem=parsed.documentKey+'.v'+version+'.'+parsed.sha256.slice(0,16);
    const original=await store.immutable('originals/'+stem+'.'+parsed.format,parsed.bytes);
    const text=await store.immutable('parsed/'+stem+'.txt',Buffer.from(parsed.text));
    const table=parsed.table?await store.immutable('parsed/'+stem+'.table.json',Buffer.from(json(parsed.table))):null;
    const metadata={documentKey:parsed.documentKey,version,name:parsed.name,purpose:parsed.purpose,sha256:parsed.sha256,parsedHash:parsed.parsedHash,
      readRef:parsed.readRef,inputId:parsed.inputId,status:parsed.status,
      format:parsed.format,parser:parsed.parser,limitations:parsed.limitations,ocrPerformed:false,original,text,table,
      submittedBy:'local-os-user:'+store.scope.ownerUid,originalUploader:'unknown',authorizedBy:'local-os-user:'+store.scope.ownerUid,
      scope:store.scope,importedAt:new Date().toISOString(),initialReference:key};
    const storage=await store.immutable('parsed/'+stem+'.meta.json',Buffer.from(json(metadata)));
    const entry={...metadata,metadata:storage};index.sources[parsed.documentKey]=[...versions,entry];return entry;
  }
  async function save(input){
    exact(input,['requestId','key','kind','identity','expectedRevision','summary','facts','inferences','missing']);
    if(!id(input.key)||!['company','product'].includes(input.kind)||!Array.isArray(input.facts)||input.facts.length>30||!Array.isArray(input.inferences)||!Array.isArray(input.missing))fail('LOCAL_REFERENCE_INPUT_REFUSED');
    bounded(input.identity,200);bounded(input.summary,600);
    if(input.inferences.length>20||input.missing.length>30)fail('LOCAL_REFERENCE_INPUT_REFUSED');
    for(const note of input.missing)bounded(note,200);
    for(const inference of input.inferences){exact(inference,['field','value','reason']);bounded(inference.field,100);bounded(inference.value,1000);bounded(inference.reason,1000);}
    return commitRequest(input,async index=>{
      const versions=index.references[input.key]||[],latest=versions.at(-1),previous=latest?await readReference(index,input.key,latest.revision):null;
      if(input.expectedRevision!==(latest?.revision||0))fail('LOCAL_REFERENCE_REVISION_CHANGED');
      if(previous?.record.state==='confirmed')fail('LOCAL_CONFIRMED_REFERENCE_REVIEW_REQUIRED');
      if(previous&&(previous.record.kind!==input.kind||previous.record.identity!==input.identity))fail('LOCAL_REFERENCE_IDENTITY_CHANGED');
      if(!previous){
        for(const [key,items]of Object.entries(index.references)){const other=await readReference(index,key,items.at(-1).revision);
          if(other.record.identity===input.identity||input.kind==='company'&&other.record.kind==='company')fail('LOCAL_REFERENCE_DUPLICATE_IDENTITY');}
        if(Object.keys(index.references).length>=40)fail('LOCAL_REFERENCE_STORAGE_LIMIT');
        if(!input.facts.some(f=>f.field==='identity'&&f.value===input.identity))fail('LOCAL_REFERENCE_IDENTITY_EVIDENCE_REQUIRED');
      }
      const facts={...(previous?.record.facts||{})};
      for(const fact of input.facts){
        exact(fact,['field','value','readRef','start','end','quote','row']);
        if(!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(fact.field)||Object.hasOwn(Object.prototype,fact.field))fail('LOCAL_REFERENCE_FIELD_REFUSED');
        bounded(fact.value,1000);bounded(fact.quote,2000);const parsed=cache.get(fact.readRef);
        if(!parsed||!Number.isSafeInteger(fact.start)||!Number.isSafeInteger(fact.end)||fact.start<0||fact.end<=fact.start
          ||parsed.text.slice(fact.start,fact.end)!==fact.quote||!fact.quote.includes(fact.value))fail('LOCAL_REFERENCE_EXACT_SOURCE_REQUIRED');
        if(input.kind==='product'&&parsed.table){const row=parsed.table.rows.find(r=>r.row===fact.row);
          if(!row||!row.cells.includes(input.identity)||fact.start<row.start||fact.end>row.end)fail('LOCAL_REFERENCE_PRODUCT_ROW_MISMATCH');}
        const savedSource=await preserveSource(index,parsed,input.key);
        facts[fact.field]={value:fact.value,state:'source-extraction-unconfirmed',source:{documentKey:parsed.documentKey,version:savedSource.version,
          sha256:parsed.sha256,parsedHash:parsed.parsedHash,start:fact.start,end:fact.end,quote:fact.quote,...(fact.row?{row:fact.row}:{})}};
      }
      const revision=versions.length+1,record={schema:1,key:input.key,kind:input.kind,identity:input.identity,revision,state:'proposal',
        summary:{text:input.summary,state:'model-authored-unconfirmed'},facts,inferences:input.inferences,missing:input.missing,scope:store.scope,
        submittedBy:'local-os-user:'+store.scope.ownerUid,authorization:await store.guard('reference:save'),createdAt:new Date().toISOString(),
        humanConfirmed:false,independentVerification:false};
      const bytes=Buffer.from(json(record));if(bytes.length>24576)fail('LOCAL_REFERENCE_RECORD_LIMIT');
      const stem='references/'+input.key+'.r'+revision+'.'+digest(bytes).slice(0,16),storage=await store.immutable(stem+'.json',bytes);
      const markdown='# Reference: '+JSON.stringify(input.identity)+'\n\nStatus: proposal / unconfirmed source extraction.\n\nModel-authored purpose: '+JSON.stringify(input.summary)+'\n\n## Source-backed extractions (unconfirmed)\n\n'
        +Object.entries(facts).map(([field,f])=>'- '+field+': '+JSON.stringify(f.value)+'\n  Source: '+f.source.documentKey+' v'+f.source.version+' SHA256 '+f.source.sha256+'; parsed UTF-16 '+f.source.start+'..'+f.source.end+'\n  Quote: '+JSON.stringify(f.source.quote)).join('\n')
        +'\n\n## Model inferences (not facts)\n\n'+input.inferences.map(i=>'- '+JSON.stringify(i)).join('\n')
        +'\n\n## Pending\n\n'+input.missing.map(m=>'- '+JSON.stringify(m)).join('\n')+'\n';
      await store.immutable(stem+'.md',Buffer.from(markdown));
      index.references[input.key]=[...versions,{revision,state:'proposal',kind:input.kind,purpose:input.summary,...storage,markdown:stem+'.md'}];statistics.referenceWrites++;
      const checked=await readReference(index,input.key,revision);
      return {status:'saved-reference-proposal',key:input.key,revision,files:[storage,...checked.sourceFiles]};
    });
  }
  async function keep(input){
    exact(input,['requestId','readRef']);const parsed=cache.get(input.readRef);if(!parsed)fail('LOCAL_REFERENCE_EXACT_SOURCE_REQUIRED');
    return commitRequest(input,async index=>{const meta=await preserveSource(index,parsed,'source-only');
      return {status:'source-version-retained',documentKey:meta.documentKey,version:meta.version,files:[meta.original,meta.text,meta.metadata,...(meta.table?[meta.table]:[])]};});
  }
  async function query(input){
    exact(input,['key','kind','revision','search','limit']);const index=await store.load(),records=[];const limit=input.limit??10;
    if(!Number.isSafeInteger(limit)||limit<1||limit>10)fail('LOCAL_REFERENCE_QUERY_LIMIT');
    if(input.key!==undefined&&!id(input.key)||input.kind!==undefined&&!['company','product'].includes(input.kind)||input.revision!==undefined&&(!Number.isSafeInteger(input.revision)||input.revision<1))fail('LOCAL_REFERENCE_QUERY_REFUSED');
    if(input.search!==undefined)bounded(input.search,100);
    for(const [key,versions]of Object.entries(index.references)){
      if(input.key&&key!==input.key)continue;
      const item=await readReference(index,key,input.revision??versions.at(-1).revision);
      if(input.kind&&item.record.kind!==input.kind||input.search&&!JSON.stringify(item.record).toLowerCase().includes(input.search.toLowerCase()))continue;
      if(input.key)records.push(item);else records.push({key,kind:item.record.kind,identity:item.record.identity,revision:item.record.revision,
        state:item.record.state,summary:item.record.summary,storage:item.storage});
      if(records.length===limit)break;
    }
    const derived=[];for(const item of records){const current=item.record?item:await readReference(index,item.key,item.revision);derived.push(...current.sourceFiles);}
    return finish({status:records.length?'available':'empty',records,files:[...records.map(r=>r.storage),...derived]});
  }
  async function versions(input){
    exact(input,['documentKey','version','offset','limit']);if(!id(input.documentKey))fail('LOCAL_REFERENCE_SOURCE_KEY_REQUIRED');
    if(input.version!==undefined&&(!Number.isSafeInteger(input.version)||input.version<1))fail('LOCAL_REFERENCE_REVISION_REQUIRED');
    const index=await store.load(),found=index.sources[input.documentKey]||[],sources=[];
    for(const item of found.filter(v=>!input.version||v.version===input.version)){
      const metadata=JSON.parse(await store.read(item.metadata.file,item.metadata.sha256));await store.read(item.original.file,item.original.sha256);
      const parsed=await fromStored(item);cache.set(parsed.readRef,parsed);
      const full=(await store.read(item.text.file,item.text.sha256)).toString(),offset=input.offset??0,limit=input.limit??1500;
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>6000)fail('LOCAL_REFERENCE_VIEW_REFUSED');
      sources.push({metadata,storage:item.metadata,view:{offset,text:full.slice(offset,offset+limit),totalChars:full.length}});
    }
    return finish({status:sources.length?'available':'empty',sources,files:sources.flatMap(s=>[s.storage,s.metadata.original,s.metadata.text,...(s.metadata.table?[s.metadata.table]:[])])});
  }
  const memory=businessMemory({store,readReference,commitRequest,bounded});
  async function verifyReceipt(data){
    const auth=await store.guard('context');if(!same(data.authorization?.scope,auth.scope)||data.authorization?.epoch!==auth.epoch)fail('LOCAL_REFERENCE_HISTORY_REAUTHORIZE');
    for(const ref of data.files||[]){const bytes=await store.read(ref.file,ref.sha256);
      if(ref.file.startsWith('memory/')){const memory=JSON.parse(bytes);if(!same(memory.scope,store.scope))fail('LOCAL_REFERENCE_SCOPE_MISMATCH');
        const index=await store.load();for(const source of memory.references)await readReference(index,source.key,source.revision,source.storage.sha256);}
    }
    for(const item of [...(data.records||[]),...(data.memories||[])])if(item.record){
      if(!same(JSON.parse(await store.read(item.storage.file,item.storage.sha256)),item.record))fail('LOCAL_REFERENCE_CACHED_BODY_CHANGED');
      if(item.record.kind==='business-memory'){const index=await store.load();for(const ref of item.record.references)await readReference(index,ref.key,ref.revision,ref.storage.sha256);}
      else await readReference(await store.load(),item.record.key,item.record.revision,item.storage.sha256);
    }else if(item.key&&item.storage){const current=await readReference(await store.load(),item.key,item.revision,item.storage.sha256);
      const expected={key:current.record.key,kind:current.record.kind,identity:current.record.identity,revision:current.record.revision,
        state:current.record.state,summary:current.record.summary,storage:current.storage};if(!same(item,expected))fail('LOCAL_REFERENCE_CACHED_BODY_CHANGED');}
    for(const item of data.sources||[]){if(!same(JSON.parse(await store.read(item.storage.file,item.storage.sha256)),item.metadata))fail('LOCAL_REFERENCE_CACHED_BODY_CHANGED');
      const text=(await store.read(item.metadata.text.file,item.metadata.text.sha256)).toString();await store.read(item.metadata.original.file,item.metadata.original.sha256);
      if(text.slice(item.view.offset,item.view.offset+item.view.text.length)!==item.view.text)fail('LOCAL_REFERENCE_CACHED_BODY_CHANGED');}
  }
  async function verifyHistory(messages){
    const pairs=pairLocalToolHistory(messages),paired=new Set(pairs.map(pair=>pair.result));
    for(const message of messages)if(message.role==='toolResult'&&message.toolName?.startsWith('workspace_local_')&&message.isError!==true&&!paired.has(message))fail('LOCAL_REFERENCE_HISTORY_PAIR_REQUIRED');
    for(const {call,result}of pairs){
      if(call.name==='read'&&result.isError===false){
        const source=result.details?.sources?.find(item=>item.kind==='user-selected-local-file'&&item.recordId===call.arguments?.path);
        if(!source||result.details.privateLibrary!==false||!await archivedSource(source))fail('LOCAL_CACHED_SOURCE_REFUSED');
      }
      if(!call.name.startsWith('workspace_local_')||result.isError===true)continue;
      if(!result.details?.authorization||result.content?.length!==1||result.content[0]?.type!=='text'||result.content[0].text!==JSON.stringify(result.details))fail('LOCAL_REFERENCE_CACHED_BODY_CHANGED');
      const data=result.details;await verifyReceipt(data);
      if(call.name==='workspace_local_material_read'&&data.readRef){
        let expected;
        if(files.manifest.some(f=>f.id===data.inputId&&f.sha256===data.sha256))expected=cache.has(data.readRef)?await view(cache.get(data.readRef),call.arguments):await source(call.arguments);
        else{const index=await store.load(),item=index.sources[data.documentKey]?.find(v=>v.sha256===data.sha256&&v.parsedHash===data.parsedHash);
          if(!item)fail('LOCAL_REFERENCE_HISTORY_SOURCE_NOT_RETAINED');const parsed=await fromStored(item,data);cache.set(parsed.readRef,parsed);expected=await view(parsed,call.arguments);}
        if(!same(expected,data))fail('LOCAL_REFERENCE_CACHED_BODY_CHANGED');
      }
    }
  }
  await store.load();
  async function archivedSource(source){
    const current=files.manifest.find(item=>item.sha256===source.sha256&&item.name===source.name);
    if(current){await files.snapshot(current.id);rememberSelected(current,true);return true;}
    const index=await store.load();
    const item=Object.values(index.sources).flat().find(v=>v.sha256===source.sha256&&v.name===source.name);if(!item)return false;
    await fromStored(item);rememberSelected(source,true);return true;}
  return {source,save,keep,query,versions,archivedSource,memorySave:async input=>{const value=await memory.save(input);statistics.memoryWrites++;return value;},
    memoryQuery:async input=>finish(await memory.query(input)),authorize,verifyHistory,noteSelectedRead,disclosureSnapshot,restoreDisclosure,
    report:()=>({...statistics,mode:'local-owner',customerSharing:false}),store};
}
