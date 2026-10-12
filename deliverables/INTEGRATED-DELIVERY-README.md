# 固定整合源码交付 — 2026-10-12

这是完成普通构建、业务回归和包级一致性验证的开发交付，**launchReady:false**。
正式独立安全复验被平台中断，仍未完成；本轮没有执行或替代该项审核。真实微信、
Pi/Muse 在线账户/执行、通知、用户可访问预览 URL、真机及上线均未验。没有部署、
付费、创建生产凭据、探测/唤醒关闭的华为生产、修改/合并 main 或强推。

## 固定版本

| 项目 | 版本 |
|---|---|
| 完整整合源码 | `6a204412f14144cfa58ececcb618c8e0595a43eb`（PR38 交付 head） |
| 原始源码 tree | `7bc83207c3ee7dc30eef296e68dad1379ae06714` |
| 后台执行源码 | `96231bbff32c0bbb03329dd2b218e58a98f557d8` |
| 后台验收说明 | `4054c8a4846d07b34b0e94ff6a2588a720d669e6` |
| 小程序编译 ZIP 标注源码 | `17fc90f8b304a6b127e419aa160aa93f864a59d3` |
| 原审核基线 | `e5ae75584b45c8be02dc10b048ebd27b7ea7d3c3`，本轮保持不变 |
| 官方 Pi | 1.1.0 / `abe508e1b89912adde45528136c3221eb69acdd7` |

已用真实 Git merge-base 核对：96231bb、4054c8a、e5ae755、17fc90f 均是 6a20441
祖先。相对 4054c8a，6a20441 没改 server、网页、根 package/lock 和共享构建。
独立交付分支为 `codex/cloud-integrated-delivery-20261012`；交付提交只增加本包与
说明，不重写客户端。交付提交号由对应 GitHub 链接确定，不自指猜测。

## 文件与字节证据

- 完整源码 `Workspace-Agent-Integrated-6a204412f141-Source.zip`：**4,941,351 bytes / 577 原源码文件**。
  SHA256：`3319c131c168133ed2c53da96195cb1984a0fecacb8872990709cb351a4c13aa`。
- `Workspace-Agent-Integrated-6a204412f141-Source.manifest.json`：固定 commit/tree、每文件
  Git blob ID、mode、length、SHA256 和完整排除列表。
- `Workspace-Agent-Integrated-6a204412f141-SOURCE-SHA256SUMS.txt`：逐文件 SHA256。
- 小程序 `Workspace-Agent-WeChat-Muse-Draft-Client.zip`：**47,116 bytes / 21 编译文件**。
  SHA256：`6fa76062c9ff50615cc1c3bdbfa9a51ec232363352a90234bccafbcc0b3a4f88`。
- `INTEGRATED-BYTE-VERIFICATION.json` 与 `INTEGRATED-CLEAN-EXTRACTION.json`：实际核对报告。

源码 ZIP 只生成一次，从 Git cat-file 原始 blob bytes 写入，未读取转换过换行的
工作树文本。所有 577 文件逐一比较实际 Git blob 和 SHA256；覆盖清单恰好包含
固定 tree 所有可交付源码，无额外/重复成员。内部/外置 manifest 与 SHA 清单一致。
运行目录、依赖目录、真实凭据文件、旧 ZIP/包目录和 DSH 源码归档被排除；保留
测试源中的明确合成 fixture 字符串，不能将它们当作真实账户秘密。

小程序包原字节提取自 6a20441 的已提交 Git blob，没有再生成另一份。其内部 manifest
仍诚实标注 17fc90f；该点之后未改客户端执行源码。21 文件全部匹配从 6a20441
重编译及干净源码 ZIP 重编译的 bytes/length/SHA256。因此源码包和小程序包版本
标注不同但执行字节一致，未改写 manifest 或修复 CRLF 哈希。

## 本轮普通实跑

各套有重叠，不能相加成独立通过数量。

| 验证 | 结果 |
|---|---|
| `npm run build` 后 `npm run test:all` | exit0；backend551 total /544 pass /7 历史 skip；原 UI19/19；会话14/14；web/mini build pass |
| `node --test miniprogram/test/*.test.mjs` | 29/29、0 skip；包含真实本地签名企业 HTTP/Pi faux/Store/原 Worker 正常业务流程 |
| 原源码包 hash checker | pass；全部 SHA256 与原 Git blob ID 相符 |
| 独立 tree→blob→ZIP 字节覆盖核对 | 577/577；内部与外置清单一致，无额外/重复成员 |
| 干净源码解压 `npm ci --offline --no-audit --no-fund` | pass；锁定依赖缓存，无模型或外部执行 |
| 干净源码 web/mini 重建 | pass；mini21 文件与交付 ZIP 逐字节相同 |
| 干净源码实际 `npm start` / SIGTERM / 重启 | pass；Pi 未配置，请求真实 blocked；原会话创建和消息 requestId 去重保持，零模型/生产调用 |

首次新工作树未构建 dist 即调用 test:all，出现9项依赖静态构建的失败；先构建后
原套完整重跑通过，没有修改代码或断言。小程序子测试首次在编译目录未生成时
未成功启动，构建完成后29/29。初版包级 smoke 把正常的“.env not found” stderr 提示当错误，
已保存失败；改为记录完整启动/关闭输出及 SIGTERM wrapper 状态，以实际 backend
重启、端口/原 Store writer 重新打开和去重断言验证关闭。源码包始终未重打。
这些失败与修正日志保存在 `integrated-validation/`。

7 skip 是原6项 DSH/source-bound 与1项 Windows-only。没有跳过本次业务失败、
没有把旧 PR34 ZIP 或旧通过数当作新整合包。没有运行被中断的独立安全脚本。

## 最少用户操作

1. 下载完整源码 ZIP 与 SHA 文件，核对上述 digest。在授权开发环境用 Node24
   解压，执行 `npm ci`、`npm run build`、`npm start`。安装启动不需要 DSH 源码或
   Host；没有既有模型配置时仍可启动并保存明确的 blocked 请求。
2. 小程序 ZIP 解压后由微信开发者工具导入含 project.config.json 的目录。当前
   touristappid、空 baseUrl、urlCheck:true 默认失败关闭。仅通过既有审核材料
   配置原 native ingress/code→原 Session broker、原成员/Muse 对话绑定、合法
   HTTPS 域名、真实 AppID 和隐私；秘密只放服务端，不在聊天、客户端或包里提供。
3. 待平台允许的正式安全审核完成，以及用户自行恢复生产并完成真实微信工具/
   双平台真机、原 Muse/Dot/Pi 在线执行和通知验收后，再由授权人员决定上线。
   当前包不是上线许可，没有可供用户打开的云端服务 URL。

当前闭环：原主会话目标→Pi 惰性工具草案→必要澄清→确切 revision/draftHash→
预算/期限/本次公开文字三确认→唯一原 prepare 待审单→分别 approve/dispatch→
原进度/回执/文件/SHA/人工验收。未知字段和未确认建议不授权，企业/产品关联不
自动公开，图片/PDF仅存档不解析。原 Muse/Dot 仍是外部原执行器；fixture不能
证明真实唤醒或执行。采购商 MCP/供应企业小程序的后续范围未在本轮扩开发。
