# WeChat conversation client (development)

`npm run build:mini` compiles the TypeScript client against the official
wechat-miniprogram/api-typings package, exactly 5.2.3, then produces
`release/miniprogram`. There is one conversation page, the original companion
visual, a composer with image/file attachment, compact server progress, approval
and verified deliverable cards, and an on-demand product/company/document sheet.
The existing website remains intact. There is no dashboard, feature grid,
Worker parameter UI, DAG editor or long mandatory business form.

Both clients use the same Workspace Run, input selection, artifact, business
library and exact action approval APIs. The client imports the existing shared
TypeScript schemas. Pi and durable execute on the server. onHide/onUnload stop
status polling only; they do not cancel or drive work. onShow loads authoritative
server state again. An uncertain send retries its same original request ID.
Approval and execution continuation are separate explicit confirmations. Existing original Muse delegations use compact cards for separate approve/dispatch/refresh/cancel/accept with the same review/receipt hashes and original verified file route; they never become Pi messages or wake calls.

wx.request does not list PATCH in official RequestOption.method. Conversation
library references therefore accept a POST alias of the existing same business
service, after unchanged ingress/body/role checks. Downloads use wx.downloadFile,
then FileSystemManager.getFileInfo with digestAlgorithm:sha256 before opening;
no DOM, Blob URL, browser cookie jar or SSE is required. Session credentials use
X-Workspace-Session, the same original session store/expiry/revocation; signed
ingress, exact membership, role, Origin and CSRF checks are still mandatory.
Cookie and header sessions cannot be combined. No model or Connector key enters
the client. Client credentials are held only in memory, not source or storage.

Primary references checked on 2026-10-12:
- Official maintained API definitions: https://github.com/wechat-miniprogram/api-typings
- npm package miniprogram-api-typings@5.2.3 (package-lock integrity).
- Request: https://developers.weixin.qq.com/miniprogram/dev/api/network/request/wx.request.html
- Download: https://developers.weixin.qq.com/miniprogram/dev/api/network/download/wx.downloadFile.html
- File SHA: https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.getFileInfo.html
- Login: https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html

The official documentation website could not be fetched by either the web tool
or curl in this cloud environment. API calls were checked against the actually
installed official definitions, including the PATCH incompatibility and SHA256
file API. This is not a claim of successful current WeChat platform/device use.

Account-free delivery: client source, WXML/WXSS, official-types compilation,
same-business-API transport fixtures, and the generated developer import folder.
project.config.json uses touristappid; this is not an app registration. app.ts
intentionally has no production baseUrl/loginBroker. A reviewed deployment must
supply its existing HTTPS ingress and trusted WeChat-code-to-enterprise-identity
login adapter. The client verifies the actual server session and subject after the broker returns; broker-supplied role is not trusted. A missing service fails before acquiring a login code. The client cannot invent memberships or sign ingress assertions.
Real AppID/account binding, server-domain allowlist, privacy declarations,
login/code exchange, devices, subscriptions, review and publication remain
user/operator actions. No credential, upload, deployment, payment or review was
performed. Do not disable urlCheck to imply production acceptance.

Current original policy allows selected UTF-8 text files as model input; PDF and
images can be stored but are not parsed by this text-only relay model. The client
states this limitation. Product/company references stay governed library data,
not implicit authorization to export private files to models/connectors. Bulk
library import/editing remains in the existing source-backed library; this client
does not force recreation of those records or add another import backend.
