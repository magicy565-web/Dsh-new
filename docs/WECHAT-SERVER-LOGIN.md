# Server WeChat login increment

This increment follows the fixed Pi delivery cf6de2935c9c57d86dac57a58ed79e79e5d990d5.
The earlier source ZIP remains the immutable ee1ad6c checkpoint for independent
review. This task owns server/public-contract code only; miniprogram/ is unchanged.

Phase 1 implemented and fixture-tested:
- Fixed official API URL https://api.weixin.qq.com/sns/jscode2session,
  HTTPS GET with appid/secret/js_code/grant_type=authorization_code. Server-owned
  configuration only; fetch is injectable for offline testing. No endpoint choice,
  redirect, fallback or automatic retry. Bounded timeout and 16KiB response.
- Missing/malformed credentials, upstream refusal, uncertain timeout/network,
  oversized/invalid responses and invalid session keys fail closed. Raw code,
  AppSecret, OpenID, session_key and upstream errmsg are never placed in errors.
- Returned OpenID/session_key are internal server values, not public login output.
  Reviewed member binding uses an AppID/secret-scoped HMAC of OpenID; unionid is
  not an automatic cross-account or enterprise binding mechanism.
- Reviewed profile explicitly pins workspace/AppID, an existing admin reviewer,
  a review window and existing member subjects. Unknown member, arbitrary role,
  duplicate digest, wrong scope and expired review are rejected. Roles remain
  authoritative in original enterprise membership, never in this profile/client.

Official references checked 2026-10-12:
https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html
Both official documentation pages remain inaccessible in this environment.
The actually installed official wechat-miniprogram/api-typings 5.2.3 documents
wx.login code→OpenID/optional unionid/session_key and warns that session_key
validity is maintained by WeChat, not a fixed application TTL. Source reference:
https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts
No third-party/other-mini-app documentation is treated as WeChat proof.
The exact server transport/error contract still requires current official-page
and real authorized-account confirmation; local responses are explicit fixtures.

The initial route/session broker is not mounted in this phase. The next checkpoint
will align the client's minimal request/response contract, require the existing
signed ingress, reserve code/request digests before exchange, and issue only the
original Workspace session after reviewed mapping. No standalone auth store,
automatic enterprise enrollment, new credential, grant, account call or deployment
is introduced. AppID/Secret/approved profile absent means login stays unavailable.
