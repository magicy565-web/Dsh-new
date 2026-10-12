import path from 'node:path';
import { openPrivateFile } from './store.mjs';
import { supplierHash } from './supplier-profile.mjs';

/** Private bridge from the ORIGINAL verified wx code exchange and live Workspace
 * Session. A fresh popup result is an authenticated client report, not signed
 * WeChat subscription authority. The send API remains the final enforcer. */
export function createNativeSubscriptionFacility({ access, clock = Date.now } = {}) {
  const sessions = new Map();
  function live(row) { const current = access.nativeSessionById(row.sessionId); return current && current.subject === row.subject && current.workspaceId === row.workspaceId && row.expiresAt > clock(); }
  return {
    registerVerifiedLogin(input) {
      const current = access.nativeSessionById(input.sessionId);
      if (!current || current.subject !== input.subject || current.workspaceId !== input.workspaceId || !/^wx[a-f0-9]{16}$/i.test(input.appId) || !/^[A-Za-z0-9_-]{8,128}$/.test(input.openid) || !input.reviewId || input.expiresAt <= clock()) return false;
      const id = `wechat-owner-${supplierHash([input.workspaceId,input.subject,input.appId,input.reviewId]).slice(0,32)}`;
      for (const [key,row] of sessions) if (!live(row)) sessions.delete(key);
      if (sessions.size >= 2000 && !sessions.has(input.sessionId)) return false;
      sessions.set(input.sessionId,{...input,id,revision:1}); return true;
    },
    async resolveRecipient({actor,recipientBindingId}) {
      const row = [...sessions.values()].find(row => row.id === recipientBindingId && row.subject === actor.subject && row.workspaceId === actor.workspaceId && live(row));
      return row ? {id:row.id,revision:row.revision,workspaceId:row.workspaceId,ownerSubject:row.subject,recipientSubject:row.subject,appId:row.appId,openid:row.openid,verified:true,revoked:false} : null;
    },
    bindings(actor) { return [...sessions.values()].filter(row=>row.subject===actor.subject && row.workspaceId===actor.workspaceId && live(row)).map(row=>({id:row.id,revision:row.revision,appId:row.appId})).filter((row,i,all)=>all.findIndex(item=>item.id===row.id)===i); },
    async confirmSubscription({context,actor,recipient,challenge,decision}) {
      const row = sessions.get(context.session?.id);
      if (!row || !live(row) || context.client !== 'wechat' || row.subject !== actor.subject || row.workspaceId !== actor.workspaceId || row.id !== recipient?.id || row.appId !== challenge.appId || row.sessionId !== challenge.sessionId || !['accept','reject','ban','filter'].includes(decision)) return null;
      return {verified:true,subject:row.subject,workspaceId:row.workspaceId,challengeId:challenge.id,decision,appId:row.appId,templateId:challenge.templateId,source:'wx.requestSubscribeMessage',provenance:'authenticated_wechat_client',evidenceKind:'wechat_client_subscription',authorityLevel:'authenticated_client_report',platformAuthorization:'unverified_until_send'};
    },
  };
}
async function privateJson(filename, maximum=100000) {
  if (!path.isAbsolute(filename)) throw new TypeError('Use an existing absolute private configuration path.');
  const handle=await openPrivateFile(filename);
  try { const stat=await handle.stat(); if(stat.size>maximum || process.platform!=='win32' && stat.mode&0o077) throw new TypeError('Existing token/config file must be bounded and private.'); return JSON.parse(await handle.readFile('utf8')); }
  finally { await handle.close(); }
}
/** Read an EXISTING rotating access-token snapshot. No exchange, refresh, token
 * mint, OAuth grant, retry loop or write is performed. */
export function existingWechatTokenProvider(filename) {
  return async ({appId}) => { try { const data=await privateJson(filename,16384); return data.appId===appId ? {appId:data.appId,accessToken:data.accessToken,expiresAt:data.expiresAt} : null; } catch { return null; } };
}
export async function loadSupplierNotificationOptions(filename) {
  if (!filename) return {};
  const config=await privateJson(filename);
  if (config.version!==1 || Object.keys(config).some(key=>!['version','wechat','firstSampleWechat','accessTokenFile'].includes(key))) throw new TypeError('Use the reviewed original notification configuration schema.');
  const token = config.accessTokenFile ? existingWechatTokenProvider(config.accessTokenFile) : null;
  const adapter = value => value ? {...value,mode:'production',getAccessToken:token} : undefined;
  return {wechat:adapter(config.wechat),firstSampleWechat:adapter(config.firstSampleWechat)};
}
