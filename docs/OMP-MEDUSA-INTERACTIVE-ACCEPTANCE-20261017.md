# 手工、保留合成产品的 Medusa 验收入口

当前只准备源码与有限替身测试，不登录服务器、不使用聊天密码、不创建管理员或凭据。父报告迁移、API/UI启动及重启后基础HTTP、Docling PDF/入口重启已通过；本作者未执行这些现场操作，产品验收仍需用户本人运行本入口。

新脚本是既有 `medusa-catalog-live-smoke.mjs` 的原生认证及产品POST/GET验收子集，保留旧脚本不变，去除环境变量凭据、其他夹具和所有DELETE/cleanup。仅用Node24内置模块，无npm安装、Docker构建、数据库访问、网络/权限变更或新服务。补丁只添加 `scripts/medusa-catalog-interactive-smoke.mjs`，可用于固定现场 `e1efd3f+6f41b0c+6789079+724908a单文件Dockerfile补丁`，不带4a网络或其他PR变更。

在用户本人私有交互终端、固定源码根目录执行：

```sh
git apply --check /path/to/interactive.patch
git apply /path/to/interactive.patch
env -i PATH="$PATH" HOME=/tmp node scripts/medusa-catalog-interactive-smoke.mjs --confirm-keep-synthetic-product
```

默认服务地址 `http://127.0.0.1:9000`；确有已审查本机端口差异时，仅可追加 `--base-url http://127.0.0.1:端口`。拒绝远程/HTTPS/含userinfo/路径/query/hash目标及非TTY。脚本不从env/argv/文件读取邮箱、密码或令牌；用户在两个隐藏提示中亲自输入邮箱和密码并回车。两者都不回显，原生readline禁用历史；命令中不填写凭据，也不使用聊天中的密码。没有预置账号、token、cookie jar或数据库伪造身份。

提交后只有5个原生API请求：POST `/auth/user/emailpass`；POST `/admin/products` 创建带唯一时间/UUID标识的draft合成产品（一个Acceptance/Synthetic option，显式空variants）；GET该精确ID回读；POST该ID仅修改title/subtitle；再次GET确认持久值。创建响应和两次回读均要求同ID、唯一handle、draft和自有synthetic metadata匹配，身份/来源不符时停止后续修改。没有查询产品列表、使用既有产品ID、关联真实库存/价格/订单/客户、发布产品或删除记录。每次运行最多新建一个保留draft，不重试；重复手工运行会留下另一个唯一记录。

报告只含固定检查名、合成marker及经格式/已知凭据筛查的合成产品ID，不输出邮箱、密码、令牌、原始响应或服务端错误正文。认证/MFA/验证未完成时安全退出且不创建产品；每请求至多15秒，提交后的客户端使用窗口至多120秒，重定向拒绝、取消/超时后不继续写。中途失败保留已提交记录；创建响应丢失标为creation unknown，不冒充回滚或确定未创建，按marker人工核查。

修正后的报告另含各阶段HTTP数字状态及固定失败类别。400/422不直接称为Zod错误：只把已知原生options错误或结构化issue路径/field标签投影为白名单根字段，永不输出完整message、路径或输入值。创建失败仍保守记为unknown，先核记录，不自动重试。结束进程中的令牌不保存、不可取回复用；后续任何真实运行仍由用户本人重新隐藏输入，不自动登录。

“短期”指本次客户端内存使用窗口：固定SDK登录返回的JWT寿命由服务器决定，默认配置为1天。脚本不擅改服务器认证配置、不篡改JWT、不续期或持久化Cookie；结束时清除变量引用，但不声称JavaScript堆已被可靠擦除，也不声称服务器JWT已被撤销。全流程不发DELETE，包括session删除。若要求服务端签发严格120秒到期的令牌，需要另行审查服务器认证配置，不在本次源码范围内。

退出0仅代表这5个请求及自有draft回读通过，保留的合成记录可由用户在现有UI查看；退出1表示认证/请求/一致性失败或取消，退出2表示交互入口拒绝。不能据此宣称全产品管理、其他插件、商业执行或原Host解析授权已验收。

有限本地测试命令：`env -i PATH="$PATH" HOME=/tmp node --test test/medusa-interactive-smoke.test.mjs`。测试实际启动Node脚本和PTY，以有限loopback HTTP替身验证两次隐藏输入、成功和认证失败退出；其他用例覆盖原生API子集顺序、自有记录校验、MFA/重定向/取消及不删除/不披露。所有身份和数据均为明确合成替身，不是真实Medusa登录或业务验收。

本次结果10 passed、0 failed/cancelled/skipped；另直接用固定2.21.2的原生AdminCreateProduct()/AdminUpdateProduct() schema解析合成payload通过，没有API或DB调用。schema只说明输入契约符合，不代表真实写入通过。

后续输入修正：f3ce36d省略options虽可通过CreateProduct及完整AdminCreateProduct() schema，却被固定2.21.2原 `createProductsWorkflow` 的纯 `validateProductInputStep` 拒绝为invalid_data。此前只验schema的覆盖不足，不能据此断言创建请求完整可用。当前请求构造器增加非空合成options和显式空variants，不创建价格/库存/商业关联。

独立原SDK验证：`env -i PATH="$PATH" HOME=/tmp MEDUSA_DISABLE_TELEMETRY=true node --test test/medusa-interactive-smoke.test.mjs apps/medusa-acceptance/test/product-input-contract.cjs`。SDK部分实际执行HTTP schema与原工作流纯输入校验step（不是产品写入工作流），旧payload schema通过而step拒绝，修正后的真实请求构造器二者均通过；SDK部分不发HTTP或连接DB。配套HTTP/真实PTY用例只连接有限loopback替身；合计14 passed、0 failed/cancelled/skipped。无需真实账号、Medusa服务、DB或真实写入；这仍不等于真实产品创建已经通过。不修改管理员、归档诊断草案、部署文件或服务。
