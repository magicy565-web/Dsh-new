# 原生产品上下文

`workspace_library_product_context` 扩展现有 `dsh-workspace-library`，读取同一份企业／产品资料。
它没有独立存储、自动任务或模型调用；执行、取消和工具记录仍由 DSH 负责。

## 使用

在原生 DSH 对话中给出产品名称或 id，并要求根据现有资料回答问题。
Agent 可用现有产品列表定位产品，再读取上下文和相关原文；工具顺序由 Agent 决定。

```json
{"productId":"prd_00000000-0000-0000-0000-000000000000","expectedRevision":1}
```

`productId` 必填，示例 id 需替换为实际产品 id。`expectedRevision` 可省略；提供时修订不同即拒绝。
产品不存在或已归档时拒绝读取，不自动匹配名称相似的产品。

返回值包含：

- `source`：产品 id／修订、企业修订、库序列和快照 SHA-256。SHA 对企业、产品和关联文档元数据计算，
  用于标识本次读取的内容；它不创建持久版本或证明真实性。`scope: profile` 表示资料库按当前 profile 共享。
- `company` / `product`：一次读取中保存的企业字段、产品字段、SKU、内部报价、供货条件和图片元数据。
  `reviewState: unreviewed` 表示产品字段没有独立的人工审核状态；字段已填写不等于事实已核验。
- `documents`：产品固定的文档版本、SHA、用途、当前版本、该固定版本的最近审核、有效期和可读状态。
- `gaps`：缺失规格、MOQ、交期、供货字段、询价要求，以及文档归档、缺失、未审核／驳回、历史版本和证书有效期问题。
  文档缺口同时携带文档 id／版本，审核状态不能跨文件套用。

报价仍为内部数据，`internalPricing: true` 不代表获得对外报价授权。
本工具不合并经营记忆；Agent 可按问题另行召回，并分别标明来源。

## 文档正文与审核

上下文只读取元数据，`documentContentIncluded: false`；每份文档都标明
`contentRead: false` / `byteIntegrity: not-checked`。这不证明附件存在或原字节正确。
只有 `availability: text-reference` 的项提供 `reference` 和 `readWith`。
Agent 引用正文时仍需通过 `workspace_library_references` 校验原生附件字节／SHA 和当前可用性。

归档、版本缺失、不支持的格式或超出读取范围时，返回明确缺口，`reference` / `readWith` 为 null。
已知的版本和 SHA 元数据保留；不改读新版本，也不通过其他读取路径把不可用资料当成依据。
每批正文读取仍受既有 8 个版本、24 000 字符／96 000 字节限制；上下文会返回这些限制。
上下文本身最多 64 000 个 JSON 字符／192 000 UTF-8 字节，超过即拒绝，不静默截断。

历史版本仍可读，但不能称为现行政策。审核决定取固定版本和 SHA 对应的最近记录；
证书日期单独报告，即使曾通过审核，也可能已过期。PDF 元数据和人工审核不代表本工具已读取 PDF 正文。

同源认证 HTTP 复用现有 Connection 边界：

```text
GET /workspace-library-api/products/:id/context?expectedRevision=1
```

读取不写资料、不批准文档、不迁移数据，也不新建页面。
旧 `domain-product-library` 包仍保留 Medusa 只读来源契约，尚未接入；本次读取的是原生本地产品资料。

## 验证

```sh
npm run check
DSH_RUNTIME_DIR=/workspace/dsh-runtime node integrations/dsh/dsh-workspace-library/dev/native-product-context-smoke.mjs
```

核心测试覆盖单产品隔离、历史固定版本、元数据与原文核验的区别、最近审核／证书有效期、
缺失字段、归档和不支持格式、修订冲突、取消、大小上限、只读持久性及认证接口。
原生冒烟使用官方 ToolRuntime 和附件服务，验证上下文返回的确切 pin 可交给既有读取器，
归档后原文读取被拒绝；冒烟不调用模型。

真实模型验收使用独立 profile、合成产品和原生文件附件，原始会话记录保留在 Git 外。
验收目标是依据指定产品起草答复，以及在文档归档后重新核查依据；不指定工具顺序。

2026-10-26（Asia/Shanghai），官方 DSH 0.2.1-rc.2 / `deepseek-official`、`deepseek-flash`
的两个最终独立会话完成，共 5 次有对应结果的只读工具调用，无工具错误：

- 正例自行选择上下文和引用工具。固定 v1 原生附件的 SHA 一致；包装与样品条款取自原文，
  未混入另一产品／v2 的条款或内部报价。证书保持未审核、格式不可读、有效期未知。
- 归档后复测未再引用旧包装和样品条款，区分了获批历史条款与未审核证书。
  原生 Web 另验证未认证 401，以及产品改为新修订后拒绝指定旧修订。

初次失效测试出现过跨文档审核状态混淆；缺口加入文档 id／版本、不可读来源不提供可执行 reference 后，
相同目标的新会话复测不再出现该混淆。但模型文字仍有个别偏差：正例末尾把付款字段称为与文件一致，
实际上文件未记载付款条件；失效复测称未报告证书有效期缺口，工具实际已返回该缺口。
本次证明上述原生执行与来源边界，不把模型草稿判为无需复核。
本机完整答复与核对报告位于 `/workspace/artifacts/dsh-product-context-acceptance`，原始事件位于 `/tmp/dsh-live-product`，均不进入 Git。
