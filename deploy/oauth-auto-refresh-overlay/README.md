# 原 Workspace—xy 自动续期候选（默认关闭，未由本聊天部署）

目的：让现有固定 ChatGPT 客户端一次明确授权后，通过刷新令牌自动换取短期访问令牌；网页会话到期和 Identity 进程重启不再使该新授权失效。只修复原部署，保留原账号、域名、客户端、密钥和 SQLite，原旧记录不迁移。

候选仅修改 `deploy/identity/identity.mjs`，新增 `deploy/identity/dot-refresh-policy.mjs`；`identity-lib.mjs` 与生产哈希一致，持久化适配器不变。其余 `server` 文件是原纯源码副本，供隔离测试使用，不属于生产补丁。

配置中没有 `dotPersistentAuthorization` 时保留旧策略。配合现有约90天准入的拟议配置如下（180天仅用于上限回归测试，未作为生产授权建议），生产开启需唯一写入方审核，且人类在具体授权页允许新的有限持续授权：

```json
{
  "dotPersistentAuthorization": {
    "version": 1,
    "refreshIdleSeconds": 2592000,
    "grantSeconds": 7776000
  }
}
```

这代表连续30天未刷新或自新授权起最多90天后需要重新授权；实际资源访问还受原准入截止2027-01-06T07:43:20.599Z约束，生产采用时应明确这个更早的期限，不代表永久凭据。Access Token仍为1小时，网页登录Session仍为8小时；仅固定 `workspace-dot-chatgpt`、`workspace.dot`、原精确资源使用会话独立的刷新。范围和资源检查、PKCE、TLS、令牌轮换/重放检测、Grant撤销和原安全存储保留。正常刷新不进入用户交互授权流程。

旧 Session 缺失的旧令牌不能安全自动升级：同版本轮换会继承旧 `expiresWithSession`。候选不会改写旧payload、复活Session或延长旧Grant；需要一次明确新Consent取得新有限Grant。`loadExistingGrant` 对此固定客户端的新的授权码流程要求展示新Consent，即使浏览器仍持有旧Session；refresh流程不受此交互检查影响。旧Grant仍保留。

截至2026-10-11 12:09，北京时间，本地10项真实HTTP回归全部通过，Node24.19.0、oidc-provider9.12.2、原SQLite适配器、隔离合成账号/密钥/数据库；通过原登录页面CSRF/Consent/PKCE流程取得测试令牌。测试在进程内推进逻辑时钟，没有修改机器或生产时间。没有将任何凭据、token或OAuth payload写入日志或交付文件。测试用HTTP只连127.0.0.1，Host/HTTPS转发头用于原Ingress边界测试；不访问真实ChatGPT回调。此证据不是生产长时刷新或原研究任务验收。

- 复现原8小时Session失效的invalid_grant。
- 新授权跨Session过期、Identity重启仍刷新，JWT签名/issuer/audience/scope不变。
- 30天未刷新后拒绝；90天与180天绝对期限下持续轮换仍不能无限延长。
- 旧令牌重放撤销整条链；显式Grant撤销拒绝后续刷新。
- 部署候选不修改旧令牌/旧Grant，缺失旧Session不被复活。
- 旧Session仍有效时也需明确新Consent、新Grant。
- 错误客户端和扩张scope被拒绝；无配置仍保留旧默认。

本地复现命令：安装本目录锁定依赖后使用Node24执行 `node --test test/dot-auto-refresh.test.mjs`。Windows测试需要dev依赖koffi，Linux不需要WindowsFFI；不得将node_modules、测试数据库或依赖调试文件发布为生产源码。

后续必须由唯一生产写入方独立Linux复核，再采用原备份/部署/回滚路径，且确认没有正在执行的任务后安排Identity受控重启。不得替换原数据库、Cookie/JWK/Ingress密钥，不能将本地测试称为生产验收。实际原插件后台跨Access Token过期刷新才是生产自动续期证据。

持久OAuth之外仍需原Host和连接正式审查、正确配置各层独立期限、真实Events重订阅。Worker admission.grantId 是原业务邀请标识，与 IdP的 oidc.Grant 记录ID不是同一对象；不能拿新OIDC Grant ID替换原邀请或创建新Worker/Connection。

原恢复次序：读取当时真实scope/配置指纹及原Worker/Connection/租约；以保留历史的正式私有review恢复原连接，保持ID、预算0和公开权限，绑定真正返回的authorizationEpoch；对真实ChatGPT订阅请求审查未过期candidate并完成callback验证；确认活动且匹配新epoch的workspace.task.available订阅，再使用原requestId e7937b31-6aec-4ab6-95ea-0e1ad41a6881和原Goal goal-1514af67-297e-4b00-9c7b-ebe482af441f重试submitQuestion。inbox真实产生taskRef后再claim/status、实际执行/上传/提交、人类验收。不得新UUID替代原Goal，不得改历史Events为active。任何binding review会改变scope epoch，需刷新受影响的原工具；不得在Muse正在执行时随意让其旧工具失效。

上游依据：

- [同版本Session绑定默认策略](https://github.com/panva/node-oidc-provider/blob/v9.12.2/lib/helpers/defaults.js)
- [同版本缺失Session拒绝逻辑](https://github.com/panva/node-oidc-provider/blob/v9.12.2/lib/models/token_helpers.js)
- [同版本刷新轮换继承会话绑定](https://github.com/panva/node-oidc-provider/blob/v9.12.2/lib/actions/grants/refresh_token.js)
- [RFC9700刷新令牌保护](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14)

