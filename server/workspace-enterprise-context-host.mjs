// Original Host brand authority and dependency injection; no package import until selected.
import {libraryReadHash as hash,normalizeLibraryRecipient,libraryRecipientForModel} from './library-model-read-contract.mjs';
import {looksLikeCredential} from './security.mjs';
const brands=new WeakSet(),factReaderBrands=new WeakSet(),factViewBrands=new WeakSet(),fail=code=>{throw Object.assign(Error(code),{code});};
export function assertEnterpriseContextHost(value){if(!brands.has(value))fail('OSS_ORIGINAL_HOST_REQUIRED');}
export function assertEnterpriseMemoryFactReader(value){if(!factReaderBrands.has(value))fail('OSS_ORIGINAL_MEMORY_READER_REQUIRED');}
export function assertEnterpriseMemoryFactView(value){if(!factViewBrands.has(value))fail('OSS_ORIGINAL_MEMORY_VIEW_REQUIRED');}
export async function createEnterpriseContextSessionBinding(options={}) {
 let createEnterpriseContextBackend;
 try { ({createEnterpriseContextBackend}=await import('../plugins/workspace-enterprise-context/src/backend.mjs')); }
 catch (cause) { throw Object.assign(Error('Selected enterprise context backend is missing or cannot load; restore its package or disable the backend.'), {code:'BACKEND_PLUGIN_REQUIRED',pluginId:'workspace-enterprise-context',cause}); }
 return createEnterpriseContextBackend({hash,normalizeLibraryRecipient,libraryRecipientForModel,looksLikeCredential,
  brands,factReaderBrands,factViewBrands}).createEnterpriseContextSessionBinding(options);
}
export function enterpriseContextHostFromRpc(descriptor,request){
 if(!/^[a-f0-9]{64}$/.test(descriptor?.scopeHash||'')||typeof request!=='function')fail('OSS_ORIGINAL_HOST_REQUIRED');
 const binding={scopeHash:descriptor.scopeHash,memoryMethods:descriptor.memoryMethods||[],open(nativeSessionId){const call=(method,args,signal)=>request('enterpriseContext',[nativeSessionId,method,args],signal);
  return {...Object.fromEntries(['status','memorySearch','memoryAdd','memoryHistory','parseUpload','structuredMemoryLookup','structuredMemoryRemember'].map(method=>[method,(input,signal,model)=>call(method,[input,model],signal)])),
   refresh:(proof,signal,model)=>call('refresh',[proof,model],signal),authorizeDisclosure:(payload,signal,model)=>call('authorizeDisclosure',[payload,model],signal),
   authorizeContext:(signal,model)=>call('authorizeContext',[model],signal),check:(proof,signal,model)=>call('check',[proof,model],signal),verifyBody:(proof,receipt)=>call('verifyBody',[proof,receipt])};
 }};brands.add(binding);return Object.freeze(binding);
}
