# PR91 两项披露阻断修复

从 `ba4f3789174b36ba7497eed707efe6ac513b1f14` 继续同一 writer、同一 `codex/enterprise-context-host-integration-20261016` 分支，补丁版本0.2.1。仅修复审查指出的全来源最终重验和已知 Docling 凭据回显；没有新增业务功能。

## 完整状态来源证明

原实现的 status 返回所有 `sources`，但证明只记录首份 `source`，Node final 也只检查该首份。原 Host/固定 SDK 加有限模型实际复现：两份来源均先合法披露；worker 成功退出后，在首份原 Artifact 下载时仅改变第二份，原实现仍成功交付。第二份改 revision、归档、删除、撤回文件可读状态四种情况均复现，首份保持 active/revision1。

新证明从实际回执提取完整 `sources` 列表，绑定正文哈希、来源、范围和 native Session。`source` 仅保留兼容别名，不再作为全部依赖。status 证明必须与实际回执及可信选择的完整列表一致；模型、worker 和 Node final 都通过原 Library/Session 授权逐项检查 document/revision/version/asset SHA，并重读原始字节。既有检查未移除；Node final 另保留与原上下文相同的选择授权预检。

四项回归都在该 Node 预检之后、首份下载过程中才撤销第二份，因此不能靠仅检查 selected 列表一次或仍只检查首份使测试通过。现在均 `OMP_DISCLOSURE_REFUSED`，最终文本不进入原消息存储。两份有效时，完整列表仍可正常续接同一 native Session，没有限制为单来源。缺少/截断完整列表的旧 status 证明在下一模型请求前拒绝，包括压缩后恢复；不猜测补齐旧授权。旧单来源 parse 证明仍可安全续跑。

## 已知连接凭据回显防护

之前通用格式检测不能识别普通字符串形式的 Docling key。现在 Node 在解码完整成功 JSON 响应时检查已知连接凭据，覆盖 `document.text_content` 和 errors 等非文本结果字段；解析结果、记录证明前的正文、缓存正文接受处也检查。支持原值、JSON/Unicode/hex 转义、常见/数字 HTML entity、URI、Base64/Base64url、hex 编码，以及三层常见转义规范化。Base64 包装的错误短语也检查。识别函数不返回匹配值、片段或上游对象，仅抛静态 `OSS_CREDENTIAL_ECHO_REFUSED`。

原 HTTP/传输失败仍丢弃响应正文及任意异常文本，只保留静态错误码。没有凭据或完整响应日志。测试每次新建非 sk/Bearer 格式的合成值，仅留在 Node 测试状态与本机 HTTP 替身；不读取真实 key，不把预期凭据值塞入 worker 测试参数。

九种成功HTTP正文回显、成功响应 errors 数组及 HTTP503错误体均验证：worker 错误回执没有解析正文/授权证明，有限模型上下文禁止安全正文标记，解码后的 Session 和原 Store 中不存在凭据/编码值或被拒绝正文。断言只输出布尔/静态码，不打印凭据或完整响应。另有合法正文哈希但含编码凭据的旧缓存负例，故意只在 Node 内存构造并拒绝；未把该测试数据写入会话或发送 worker。

## 验证与边界

| 组 | 结果 |
| --- | --- |
| 原 Host/固定 SDK 全组 | 41/41，当时尚未加入最后两项缓存兼容用例 |
| 最终来源续接/旧 parse/缓存凭据边界 | 3/3，含1项重复、2项后来新增 |
| 原授权/插件/容量/资料/预算回归 | 50/50 |
| `npm run build` | 十一包静态/打包闭包、TypeScript、Vite通过；已有 bundle 大小提示不变 |

记录组共94次执行、93个不同顶层用例，0失败/跳过/取消；其余定向复现与重跑不重复累加。完整命令和日志哈希见 [checks.json](checks.json)，源码哈希见 [source.json](source.json)。当前 `node --test test/enterprise-context-host.test.mjs` 包含43项用例；原复现日志不入库。

真实组件为 Node24.19.0 原 Host/签名 Session/Run/Library/Artifact、Bun1.3.14/OMP18.10.4 与真实 loopback HTTP；资料、身份、模型和服务响应均为明确替身，没有真实 Docling parser/OCR 或真实模型验收。

原 Artifact 保存仍在 admission 被 `SESSION_READONLY_EXECUTION_REFUSED` 拒绝，无保存入口或写门禁例外。Mem0 三入口保持关闭。没有真实凭据读取/设置、外网服务或模型请求、TED重试、付费、网络/权限修改、main 合并、强推或部署。业务 Artifact 保存、真正 Docling 服务/授权和模型质量仍是未完成项；此补丁不宣称解决它们。
