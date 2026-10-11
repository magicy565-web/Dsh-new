import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const replaceOnce=(source,anchor,replacement)=>{
  if(source.split(anchor).length!==2) throw Error('Original Host wiring anchor missing or ambiguous: '+anchor.slice(0,80));
  return source.replace(anchor,replacement);
};
/** Produce source edits without writing the peer checkout. */
export function wireNativeMuseSource(source,adapterImport='./dot-control-plane-host.mjs') {
  const eol=source.includes('\r\n')?'\r\n':'\n';
  const anchor="import { createMuseConversationDelegation, validateMuseConversationDelegations } from './muse-conversation-delegation.mjs';";
  source=replaceOnce(source,anchor,anchor+eol+"import { createWorkspaceControlReader } from '"+adapterImport+"';");
  const method=[
    '  // Trusted original Host read binding; no transport, reconciliation or new authority.',
    '  function bindControl(requestActor, scope) {',
    '    if (requestActor?.subject !== actor.subject || requestActor.nativeAgentId !== actor.nativeAgentId)',
    "      throw new WorkerDeskError(403, 'MUSE_OWNER_REQUIRED', 'Use the original reviewed Muse Session owner.');",
    "    if (!object(scope) || Object.keys(scope).some(key => !['workspaceId', 'policyVersion'].includes(key))",
    '      || !id(scope.workspaceId) || !id(scope.policyVersion))',
    "      throw new TypeError('Control scope must come from the original Host configuration.');",
    '    const principal = { workspaceId: scope.workspaceId, userId: actor.subject, policyVersion: scope.policyVersion,',
    "      grants: [{ sourceId: 'muse-host', scope: 'self', kinds: ['goal', 'order', 'task', 'attempt'] }] };",
    '    return createWorkspaceControlReader({ sourceId: \'muse-host\',',
    '      readContext: () => scoped(() => ({ principal, binding: { actor, workerId: host.workerId } })),',
    '      readState: () => scoped(() => store.read()),',
    '      readMuseSession: () => scoped(() => session.view()),',
    '    });',
    '  }',
  ].join(eol)+eol;
  source=replaceOnce(source,'  function bindSession(requestActor) {',method+'  function bindSession(requestActor) {');
  return replaceOnce(source,'return Object.freeze({ workerId: host.workerId, bindDesk, bindSession, bindConversation,',
    'return Object.freeze({ workerId: host.workerId, bindDesk, bindSession, bindConversation, bindControl,');
}
export function wirePluginServiceSource(source) {
  const eol=source.includes('\r\n')?'\r\n':'\n';
  const method=[
    '      bindControl(actor) {',
    "        if (!museRest) throw new MuseWorkerError(503, 'MW_GATEWAY_UNAVAILABLE', 'The original Muse binding is unavailable.');",
    '        return museRest.bindControl(actor, { workspaceId: config.scopeId,',
    "          policyVersion: 'plugin-epoch-' + snapshot().epoch + '.' + fingerprint });",
    '      },',
  ].join(eol)+eol;
  return replaceOnce(source,'      bindSession(actor) {',method+'      bindSession(actor) {');
}
function unified(before,after,filename) {
  const a=before.replace(/\r\n/g,'\n').split('\n'),b=after.replace(/\r\n/g,'\n').split('\n');
  if(a.at(-1)==='') a.pop(); if(b.at(-1)==='') b.pop();
  const dp=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));
  for(let i=a.length-1;i>=0;i--) for(let j=b.length-1;j>=0;j--)
    dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  const ops=[]; let i=0,j=0,old=1,next=1;
  while(i<a.length||j<b.length) {
    if(i<a.length&&j<b.length&&a[i]===b[j]) ops.push({type:' ',text:a[i++],old:old++,next:next++}),j++;
    else if(j<b.length&&(i===a.length||dp[i][j+1]>=dp[i+1][j])) ops.push({type:'+',text:b[j++],old,next:next++});
    else ops.push({type:'-',text:a[i++],old:old++,next});
  }
  let output='diff --git a/'+filename+' b/'+filename+'\n--- a/'+filename+'\n+++ b/'+filename+'\n';
  const changes=ops.map((op,index)=>op.type!==' '?index:-1).filter(index=>index>=0);
  for(let k=0;k<changes.length;) {
    const start=Math.max(0,changes[k]-3);let end=Math.min(ops.length,changes[k]+4);k++;
    while(k<changes.length&&changes[k]-3<=end) {end=Math.min(ops.length,changes[k]+4);k++;}
    const part=ops.slice(start,end),oldCount=part.filter(op=>op.type!=='+').length,newCount=part.filter(op=>op.type!=='-').length;
    output+='@@ -'+part[0].old+','+oldCount+' +'+part[0].next+','+newCount+' @@\n'
      +part.map(op=>op.type===' '&&op.text===''?'':op.type+op.text).join('\n')+'\n';
  }
  return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const peer=process.env.TT041_PEER_SOURCE;
  if(!peer||!path.isAbsolute(peer)) throw Error('TT041_PEER_SOURCE must identify the read-only peer source.');
  const specs=[
    ['server/muse-worker-native.mjs',text=>wireNativeMuseSource(text)],
    ['deploy/muse-native-overlay/server/muse-worker-native.mjs',text=>wireNativeMuseSource(text,'../../../server/dot-control-plane-host.mjs')],
    ['deploy/muse-native-overlay/server/workspace-plugin-service.mjs',wirePluginServiceSource],
  ];
  const provenance=[],patches=specs.map(([filename,edit])=>{
    const text=fs.readFileSync(path.join(peer,filename),'utf8');
    provenance.push({path:filename,sha256:createHash('sha256').update(text).digest('hex'),
      gitBlob:createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex')});
    return unified(text,edit(text),filename);
  });
  const manifestPath=path.join(peer,'manifest.json');
  const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
  if(manifest) for(const row of provenance)
    if(manifest.files.find(file=>file.path===row.path)?.gitBlob!==row.gitBlob) throw Error('Pinned Host bytes changed: '+row.path);
  const output=new URL('../docs/patches/',import.meta.url);fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(new URL('dot-control-host-wiring.patch',output),patches.join(''));
  fs.writeFileSync(new URL('dot-control-host-wiring-source.json',output),JSON.stringify({
    kind:manifest?'GitHub-immutable-source-snapshot':'read-only-peer-source',
    repository:manifest?.repository??null,ref:manifest?.ref??null,provenance,contractFiles:manifest?.files??[],
    warning:'Source integration only. Full original Harness/deployment packaging remains unverified.',
  },null,2)+'\n');
  console.log(JSON.stringify({patch:'docs/patches/dot-control-host-wiring.patch',provenance}));
}
