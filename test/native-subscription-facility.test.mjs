import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createNativeSubscriptionFacility,existingWechatTokenProvider,loadSupplierNotificationOptions } from '../server/native-subscription-facility.mjs';

test('existing verified login/session supplies private recipient; popup remains client-reported and cannot be transplanted to another session/app',async()=>{
  const sessions=new Map([['original-native',{id:'original-native',subject:'owner',workspaceId:'workspace',role:'admin'}],['browser-session',{id:'browser-session',subject:'owner',workspaceId:'workspace',role:'admin'}]]);
  const facility=createNativeSubscriptionFacility({access:{nativeSessionById:id=>sessions.get(id)||null},clock:()=>1000});
  assert.equal(facility.registerVerifiedLogin({sessionId:'missing',subject:'owner',workspaceId:'workspace',appId:'wx0123456789abcdef',openid:'existing_verified_openid',reviewId:'old-review',expiresAt:5000}),false);
  assert.equal(facility.registerVerifiedLogin({sessionId:'original-native',subject:'owner',workspaceId:'workspace',appId:'wx0123456789abcdef',openid:'existing_verified_openid',reviewId:'old-review',expiresAt:5000}),true);
  const actor={subject:'owner',workspaceId:'workspace'},[binding]=facility.bindings(actor);
  assert.equal(JSON.stringify(binding).includes('openid'),false);
  const recipient=await facility.resolveRecipient({actor,recipientBindingId:binding.id});
  const args={actor,recipient,challenge:{id:'one-use-challenge',sessionId:'original-native',appId:'wx0123456789abcdef',templateId:'existing_template'},decision:'accept'};
  assert.equal(await facility.confirmSubscription({...args,context:{client:'wechat',session:{id:'browser-session'}}}),null);
  assert.equal(await facility.confirmSubscription({...args,context:{client:'browser',session:{id:'original-native'}}}),null);
  const reported=await facility.confirmSubscription({...args,context:{client:'wechat',session:{id:'original-native'}}});
  assert.equal(reported.authorityLevel,'authenticated_client_report'); assert.equal(reported.platformAuthorization,'unverified_until_send');
  sessions.delete('original-native'); assert.deepEqual(facility.bindings(actor),[]); assert.equal(await facility.resolveRecipient({actor,recipientBindingId:binding.id}),null);
});

test('configuration reads an existing rotating private token only, pins AppID and keeps new first-sample sending off unless explicitly configured',async t=>{
  const directory=await fs.mkdtemp('/tmp/original-token-provider-fixture-');t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const tokenFile=directory+'/existing-token.json',configFile=directory+'/reviewed-config.json';
  await fs.writeFile(tokenFile,JSON.stringify({appId:'wx0123456789abcdef',accessToken:'SYNTHETIC_EXISTING_TOKEN',expiresAt:9000}),{mode:0o600});
  const provider=existingWechatTokenProvider(tokenFile);assert.equal((await provider({appId:'wx0123456789abcdef'})).accessToken,'SYNTHETIC_EXISTING_TOKEN');assert.equal(await provider({appId:'wxabcdef0123456789'}),null);
  await fs.writeFile(tokenFile,JSON.stringify({appId:'wx0123456789abcdef',accessToken:'SYNTHETIC_ROTATED_TOKEN',expiresAt:15000}),{mode:0o600});assert.equal((await provider({appId:'wx0123456789abcdef'})).accessToken,'SYNTHETIC_ROTATED_TOKEN');
  await fs.writeFile(configFile,JSON.stringify({version:1,wechat:{enabled:false,appId:'wx0123456789abcdef',templateId:'existing_template',fields:{thing1:'title'},officialContractReviewed:false},accessTokenFile:tokenFile}),{mode:0o600});
  const loaded=await loadSupplierNotificationOptions(configFile);assert.equal(loaded.wechat.mode,'production');assert.equal(loaded.wechat.enabled,false);assert.equal(loaded.firstSampleWechat,undefined);assert.equal(typeof loaded.wechat.getAccessToken,'function');
  await fs.chmod(tokenFile,0o644);assert.equal(await provider({appId:'wx0123456789abcdef'}),null);
});
