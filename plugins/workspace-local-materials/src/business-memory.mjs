// Separate business-memory proposals, pointing to immutable references. This is
// not chat memory or a second fact authority; every derived source is rechecked.
import {exact,fail,id,json,same} from './reference-files.mjs';
import {digest} from './parse-source.mjs';
export function businessMemory({store,readReference,commitRequest,bounded}){
  return {
    async save(input){
      exact(input,['requestId','key','expectedRevision','note','references']);
      if(!id(input.key)||!Array.isArray(input.references)||!input.references.length||input.references.length>10)fail('LOCAL_MEMORY_REFERENCE_REQUIRED');
      bounded(input.note,2000);
      return commitRequest(input,async index=>{
        const versions=index.memories[input.key]||[],latest=versions.at(-1);
        if(input.expectedRevision!==(latest?.revision||0))fail('LOCAL_REFERENCE_REVISION_CHANGED');
        if(latest){const prior=JSON.parse(await store.read(latest.file,latest.sha256));if(prior.state==='confirmed')fail('LOCAL_CONFIRMED_MEMORY_REVIEW_REQUIRED');}
        const references=[],derived=[];
        for(const ref of input.references){exact(ref,['key','revision']);const item=await readReference(index,ref.key,ref.revision);references.push({key:ref.key,revision:item.record.revision,storage:item.storage});derived.push(item.storage,...item.sourceFiles);}
        const record={schema:1,kind:'business-memory',key:input.key,revision:versions.length+1,state:'proposal',note:input.note,references,
          scope:store.scope,submittedBy:'local-os-user:'+store.scope.ownerUid,authorization:await store.guard('memory:save',references.map(r=>r.storage.file)),
          createdAt:new Date().toISOString(),notice:'Derived proposal; not confirmed fact or policy. All referenced-source restrictions apply.'};
        const bytes=Buffer.from(json(record)),stem='memory/'+input.key+'.r'+record.revision+'.'+digest(bytes).slice(0,16);
        const storage=await store.immutable(stem+'.json',bytes);
        await store.immutable(stem+'.md',Buffer.from('# Business memory proposal: '+input.key+'\n\nUnconfirmed note: '+JSON.stringify(input.note)+'\n\nReferences: '+references.map(r=>r.key+'@'+r.revision).join(', ')+'\n\nNot confirmed. Owner-only; no customer sharing.\n'));
        const saved={revision:record.revision,state:'proposal',...storage};index.memories[input.key]=[...versions,saved];
        return {status:'saved-memory-proposal',key:input.key,revision:record.revision,files:[storage,...derived]};
      });
    },
    async query(input){
      exact(input,['key','revision']);if(input.key!==undefined&&!id(input.key)||input.revision!==undefined&&(!Number.isSafeInteger(input.revision)||input.revision<1))fail('LOCAL_MEMORY_QUERY_REFUSED');const index=await store.load();let versions=input.key?index.memories[input.key]||[]:Object.values(index.memories).flatMap(v=>v.slice(-1));
      if(input.revision!==undefined)versions=versions.filter(v=>v.revision===input.revision);else if(input.key)versions=versions.slice(-1);
      const memories=[],derived=[];
      for(const storage of versions.slice(0,10)){
        const record=JSON.parse(await store.read(storage.file,storage.sha256));
        if(!same(record.scope,store.scope))fail('LOCAL_REFERENCE_SCOPE_MISMATCH');
        for(const ref of record.references){const data=await readReference(index,ref.key,ref.revision,ref.storage.sha256);derived.push(data.storage,...data.sourceFiles);}
        memories.push({record,storage});
      }
      await store.guard('memory:deliver',memories.flatMap(m=>m.record.references.map(r=>r.storage.file)));
      return {status:memories.length?'available':'empty',memories,files:[...memories.map(m=>m.storage),...derived]};
    }
  };
}
