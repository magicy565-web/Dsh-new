# Shopify Admin 接入

Shopify Admin 是新业务的商品、库存、客户和订单管理入口。DSH 负责工作区、会话与经授权的信息读取；现有本地 ERP 记录保留，不自动复制到 Shopify，也不作为 Shopify 的库存或订单状态。

当前插件可在原生会话侧栏打开 Shopify Admin、发起店主授权，以及只读商店身份和前 10 条商品摘要。创建或修改商品、订单、付款和履约在 Shopify Admin 完成；插件不执行 Shopify 写入。

## 接入前提

1. 商家有可管理的 Shopify 商店和对应的 `xxx.myshopify.com` 域名。
2. 在 Shopify 开发者后台创建适合该商店的应用，登记受控的公开 HTTPS 回调地址 `/shopify-admin-binding/oauth/callback`，并申请 `read_products`。卸载 webhook 的地址为 `/shopify-admin-binding/webhooks/app-uninstalled`。
3. 在 DSH 运行主机的安全设置中提供以下变量；不要在源码、Git、截图或聊天中保存值：

   | 变量 | 用途 |
   | --- | --- |
   | `SHOPIFY_APP_CLIENT_ID` | Shopify 应用的 Client ID |
   | `SHOPIFY_APP_CLIENT_SECRET` | 验证 Shopify 签名及交换访问凭据 |
   | `SHOPIFY_APP_REDIRECT_URI` | 与 Shopify 应用设置完全一致的公开 HTTPS 回调 |
   | `SHOPIFY_BINDING_AES256_KEY` | 32 字节加密密钥的 64 位十六进制表示，用于加密本机 Shopify 凭据 |
   | `SHOPIFY_ENTERPRISE_WORKSPACE_ID` | 固定的 DSH 企业工作区标识，可从侧栏未配置页面查看 |
   | `SHOPIFY_SUGGESTED_DOMAIN` | 可选的商店域名提示和 Admin 入口；不是授权或已连接状态 |

客户端密钥用于本地 HMAC 验证，加密密钥用于本地加密；两者都需要由运行进程获得真实值。仅会在网络代理处替换的占位符不能完成这些本地运算。密钥和绑定数据库应一起通过受信任的主机备份流程管理；不要在不同工作区之间复制或猜测绑定。

当前云开发环境的 DSH 只监听本地地址，不自动提供 Shopify 可访问的公开 HTTPS 回调。必须先准备独立的、经过配置的 HTTPS 宿主或入口，再进行真实店铺授权。只填写变量不会自动创建该入口。

## 使用

先安装本地 bundle 并启动 DSH。云环境使用 HTTP 代理时，Node.js 24 可通过 `NODE_USE_ENV_PROXY=1` 使用现有代理与 CA 配置。打开一个 DSH 工作区会话，在右侧工具中选择 **Shopify Admin**。

未完成设置时可以打开 Shopify 自带登录入口，但该动作不代表工作区已经连接商店。配置完成后，在面板输入店铺域名并选择“准备授权”，由商店所有者在 Shopify 完成授权；返回后刷新状态。连接成功后可打开真实 Shopify Admin 或按需读取商品摘要。

状态以 Shopify 和实际授权结果为准。无法认证、授权过期、商店不匹配或服务不可用时，不回退到本地 ERP，也不展示虚构商品。

## 验证范围

`node --test integrations/dsh/dsh-shopify-admin/test/*.test.mjs` 覆盖隔离的 OAuth 签名、工作区绑定、只读响应、刷新、卸载 webhook 与前端状态。测试使用合成凭据和响应，不代表真实店铺已连接。实际应用安装、公开回调、授权、Shopify API 和商家权限还需要在目标环境核验。
