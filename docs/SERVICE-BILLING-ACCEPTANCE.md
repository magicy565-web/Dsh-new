# 独立服务计费隔离验收

日期：2026-10-28。基于业务委托批次 ade475737cc5134cf8e82fe9e4e00095e88663bb。

本批安装更新仅含 Commerce 1.3.0-rc.1 和独立 Billing 0.1.0-rc.1。Mini ERP 源码、版本、数据库迁移及安装包均未修改；Billing 使用自己的 SQLite，不加载 Mini ERP 服务也可完成工具提议、Owner 确认及凭据收款。

## 结果

- `npm ci --ignore-scripts`、`npm run check` 通过；构建与回归共 378 项通过，0 失败、0 跳过。
- `npm run test:client` 全部通过。最终附件引用修正后，重新执行 Billing 的 8 项服务/HTTP 测试、专属客户端测试及官方原生集成，全部通过。
- 官方 `@deepseek-ai/dsh@0.2.1-rc.3` Cordis、Tools 和实际附件服务通过；附件引用必须保留 name、attachmentId 和 bytes，下载后核对实际字节与 SHA-256。
- 官方 Web 实际会话通过：草稿、确认、原生附件上传、部分收款、关联退款、重复固定费拒绝、430px 窄屏；没有页面脚本异常。
- 浏览器刻意丢弃已经成功提交的收款响应，再重新加载页面、打开同一委托并用原请求重试，最终仅保留一笔收款。宿主重启后，原账单及收退款记录保留。
- 合成样例账单 USD 1,500.00，收款 USD 40.00，退款 USD 10.00，净收款 USD 30.00，未收 USD 1,470.00。退款恢复应收，不减免费用。
- 两个最终安装包的 23 个文件与官方宿主安装后的文件逐字节一致。哈希见 `acceptance/service-billing/install.json`。

`acceptance/service-billing` 保存可公开的原生、浏览器和安装回执，不包含真实会话、启动令牌、浏览器身份状态或私人测试夹具。原生工具测试的 registry/session 为合成夹具；浏览器验收使用隔离官方宿主的真实会话。二者不混同。

## 复现

基础命令和安装方法见 [实现说明](SERVICE-BILLING-IMPLEMENTATION.md)。原生集成可使用：

```sh
DSH_RUNTIME_DIR=/absolute/path/to/dsh node integrations/dsh/dsh-service-billing/dev/native-smoke.mjs
node integrations/dsh/dsh-commerce-network/dev/service-billing-smoke.mjs
```

浏览器脚本为 `integrations/dsh/dsh-service-billing/dev/browser-smoke.mjs`。在隔离 localhost 官方 Web 宿主中，先按上一批委托验收建立三模式夹具和浏览器登录状态，再提供以下环境路径运行脚本：

```sh
DSH_WEB_LOG=/private/host.log \
DSH_BROWSER_STATE=/private/browser-state.json \
COMMERCE_FIXTURE=/private/commerce-mvp-browser-fixture.json \
COMMERCE_ACCEPTANCE_DIR=/private/results \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node integrations/dsh/dsh-service-billing/dev/browser-smoke.mjs
```

宿主日志、身份状态和夹具必须由操作者在自己的隔离环境生成，不随源码分发。脚本创建明确标记 SYNTHETIC 的新委托和账单；同目录第二次运行时先核对上一轮记录。停止并重启宿主后再运行，可验证持久化。

## 范围

所有费用和凭据均为合成测试记录；真实邮件、支付、银行核验、自动续费、AI Credits 实际计量和新模式佣金结算尚未验收或实现。本批没有模型调用、真实扣款、生产部署或合并。现有宿主保留先前安装的 Mini ERP；另有仅加载 Commerce/Billing 的原生测试证明无此依赖。
