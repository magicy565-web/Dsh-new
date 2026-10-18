# 企业资料来源独立验收（2026-10-18，根审查后更正）

## 固定版本与更正结论

- 固定父提交：`da04f977535b724d2ea22077f80670f1962b4f39`。分支：`codex/document-provenance-acceptance-20261018`；初次提交 `45780e1b312118187955543697c0b98a2bcd353a` 留在历史中。
- 本报告替代初次报告中“已确定跨文档来源绑定缺口/修复项”的结论。初次红测把**尚未批准的“文档分类所有证据必须同源”政策**当成现有契约，判断有误，现已撤回；不建议主线为此收紧模型合法跨源佐证。
- 已证明的行为：原 `validateIntake` 允许分类目标 A 和证据来源 B 使用不同 `sourceIndex`，且返回副本保留 B 的 index/quote/asset。原契约也允许同一字段多条证据；这不等于来源被改标。
- 保存/查询源码保留完整 evidence 和原来源，按 B 的文本验证 B 的 quote，没有发现将 B quote 重标为 A 的路径。本地完整持久化测试仍受依赖阻塞，不能声称已实测实际 Library 错误写入，也不能声称已实测持久化正确。
- 只修改原专属 tests/docs 范围；生产实现、其他测试/fixtures、UI、根 package/lock、共享 loader 均未修改。现有 13 项 Host/适配器测试保留。
- 原锁安装失败使 `upload-library` 在 import 阶段受阻，**4 个测试体仍均未执行，整体验收未完成**。没有用依赖 stub、替代版本或 SDK 替身掩盖失败。

本次已读原两包 AGENTS/README、企业资料/Docling/Brain 说明与相关测试。根及祖先没有 AGENTS.md。更正时重新核对了 `plugins/workspace-factory-ingestion/skills/factory-ingestion/SKILL.md` 的冲突/多源证据要求，并只读核对原保存、报告、查询与资料页。没有访问 Docling runbook 中的服务、真实资料或配置凭据。

## 现有契约、合同违例与候选政策的区别

原包 README 第54行只规定 `kind:'document'` 的 `sourceIndex` 选择被分类文件；每个叶字段自己的 `{path,sourceIndex,start,end,quote}` 定位其证据。它明确说 quote 验证来源位置，不验证解释语义。原 Skill 第12、16行要求保留冲突双方片段，不能静默择一；原 `contract.mjs:57` 遍历每条 evidence，`:64` 只要求每个非空叶字段有证据，未禁止同路径多条证据。因此分类 A 引用 B 本身不违反这份既有契约。

| 分类 | 此次证据与结论 |
| --- | --- |
| 已证现有行为 | schema 接受 A目标/B证据，保留 B 来源；多条同字段证据保持独立index和片段。保存/query的来源保留路径已静态核对。 |
| 真正合同违例 | 未从上述两个index不等证明任何违例。来源实际被重标、quote与其原source不匹配、超授权、旧版本仍获准披露才应按原契约核实；本次未报告已发现此类生产缺陷。 |
| 需决定的新产品准入规则 | “document 所有 evidence 必须与目标同源”是更严格、未批准政策，可能排除合法跨源佐证/冲突片段。仅作为历史候选单独保留，未实施、未建议默认启用。 |
| 来源展示不足 | `src/library/Company.tsx:84` 起的资料详情显示分类字段、版本文件及独立审核，未呈现 report 中逐字段quote。这是来源展示层可讨论的不足；不能据此推导 B 证据已丢失或用同源全等断言证明后台合同错误。本次未做浏览器实测或UI改动。 |

模型解释、来源位置、人审和独立认证仍应区分。原 `humanConfirmed:false`、`independentVerification:false` 和 unreviewed 报告未被本次测试提升为事实认证。“做好权限和后端设计，不限制大模型”：A/B/A与倒序读取只用于确定性验收，不引入生产业务步骤、分类判断、同源硬规则或 DAG。

## 优先核对：B evidence 在保存与查询中的去向

以下为固定父提交中的原代码证据；除第1项外是**静态路径核对**，不是本地磁盘写入验收：

1. `plugins/workspace-factory-ingestion/src/contract.mjs:52` 验证分类目标存在，`:59` 单独验证证据来源存在；函数末尾返回 `structuredClone(input)`。修订后的现有契约测试实际比较完整返回输入，确认目标仍为0、B证据仍为1，B asset没有变成A；还检查同字段A/B双方片段均保留。
2. `server/factory-library-ingestion.mjs:236` 按 `reads[e.sourceIndex]` 取每条证据的实际来源，`:243` 对该来源做 `text.slice(start,end) === quote` 检查。因此 B quote 用 B 校验，而不是用目标 A 校验。
3. 同文件 `:259` 用分类记录的 `row.sourceIndex` 选择被分类文件，`:267` / `:269` 将模型分类元数据用于该目标的版本/新建。这是目标选择，不包含修改 `row.evidence` 的代码，也不能单靠它认定模型分类语义错误。已有同SHA资料可能复用，并不会每次应用新分类标题。
4. `:300` 把完整 `input` 放入 plan，`:302` 以原 Artifact service 序列化；没有把 evidence 的index改成分类目标。
5. `:340` 报告保留 `input:plan.input`，`:341` 按原顺序保留每个 `reads` 的 source；`:343` 明示模型解释未验证，`:345` 保存完整报告，`:347` 创建 unreviewed 报告资料。由此可以沿 `report.input.records[].evidence[].sourceIndex → report.input.sources[index].asset` 继续找到真实 B，而非自动改标成 A。`:339` 的 sourceDocs 去重解析发生在另一个 `resolved` 副本上，不会重写 `plan.input.records[].evidence`。
6. query在 `:365` 重读每个原来源并比对source；`:387` 读保存报告、`:388` 校验其input与plan一致，`:411` 返回完整report。没有把证据重标为目标文档的投影步骤。

为便于原依赖完整环境核实，在原 `upload-library` 第一个测试体内补了实际保存report Artifact并query的断言：用真实读回执构造 A分类/B证据，比较落盘report的完整input、B index、quote和asset，确认query保留相同input。此处双方资料已经存在，**不是新建分类/证书真伪测试**。它与原4个测试体一起仍未执行；未计入通过数。

## 实际执行与真实/替身边界

环境为 Node `v24.19.0` / npm `11.9.0`。本机只用合成身份/资料与loopback服务，无外部Docling/模型、付费API、腾讯服务器、部署或权限扩张。

| 边界 | 组件与限制 | 结果 |
| --- | --- | --- |
| `adapter-host.test.mjs` | 实际 Host、Docling reader、openStore、multipart及本机HTTP；identity/Library authority callback及Docling响应明确为合成 | 原有13/13通过（11顶层+2子用例），fail/cancel/skip/todo均0；不冒充真实signed ingress/Library权限类或真实Docling识别 |
| 修订后的 `cross-document-regression.test.mjs` | 实际原validateIntake；schema fixture中的readHash明确为合成，未冒充真实读取凭证 | 更正后实际2/2通过，fail/cancel/skip/todo均0 |
| `upload-library.test.mjs` | 准备调用实际app HTTP、Artifact/Library、signed Session和原权限类；既有有限provider fixture不提交模型任务；显式合成canSave不是完整Run/SDK证明 | 原4个测试体均import阻塞；新增report保存断言也未执行 |
| `policy-candidates/document-same-source.mjs` | 未批准的同源政策候选；不进入默认runner，也不使用 `.test` 文件名 | 单独实际运行exit1，0 pass/1 fail；不是既有契约验收失败或生产缺陷 |

原Docling reader仅承诺文本/解析状态/截断/输入SHA/错误数量，未承诺页码或表格行列。测试函数生成的两页PDF和CSV及自造pages/tables响应只验证传输投影，不能证明真实Docling schema、OCR或识别质量，缺少页码不列缺陷。Brain引用的元数据投影SHA也不替代Artifact原SHA。

当前现有契约验收命令：

```sh
node test/document-provenance-acceptance/run.mjs
# 默认仅运行 adapter-host、cross-document当前行为、upload-library。
# 本环境upload import仍阻塞；不含未批准政策候选。
# 更正后实际exit1：前两组分别13/13与2/2通过；仅upload import exit1。
```

单独评估未批准政策候选：

```sh
node --test test/document-provenance-acceptance/policy-candidates/document-same-source.mjs
# 固定基线仍exit1：只说明现有代码没有实施此候选政策。
```

更正后以上两个命令均实际运行，分别保存为 `corrected-contract-run.txt` 和 `unapproved-policy-run.txt`，没有覆盖原日志。全部专属 `.mjs` 的 `node --check` 与 `git diff --check` 通过。原4个upload测试体依旧未执行；Node报告的是1个import文件失败，不是4个断言失败，也不是4个通过。

| `/tmp/document-provenance-20261018/` 更正执行输出 | SHA256 |
| --- | --- |
| `corrected-contract-run.txt`，仅upload import导致默认runner exit1 | `c2a2c93b992ab78562d038b8031e3459a02cf171b27f6afe0472678a3fa32869` |
| `unapproved-policy-run.txt`，单独候选政策exit1 | `81cd0baeb7b7880ec7536e43c2bb793441b9b992d1fd8231e34595952dec8fbd` |

### 原红测历史保留，不追改为生产缺陷

初次提交 `45780e1b312118187955543697c0b98a2bcd353a` 中的原命令：

```sh
node --test test/document-provenance-acceptance/cross-document-regression.test.mjs
# 当时实际exit1，0 pass / 1 fail，assert.throws报 Missing expected exception。
```

该失败证明提出的同源政策与既有实现不同；**不是已确定来源篡改、越权或实际Library错误写入的证据**。旧命令可在旧提交临时检出复现；当前同路径文件已改为现有契约行为测试，原候选断言移到单独文件，未用skip/todo将历史改写成通过。初次总runner包含该候选而退出1的记录同样保留，现不将其作为默认契约应当失败的理由。

初次本机日志未提交，保留的SHA256仅用于识别历史运行，不是生产验收凭证：

| `/tmp/document-provenance-20261018/` 历史输出 | SHA256 |
| --- | --- |
| `adapter-host.txt`，初次13/13 | `fbb45ccd5ec3a5723f7e5f017ce46f72c8d1a130650a9adc47ea38ad2c578b37` |
| `final-run.txt`，初次总runner exit1，含未批准政策及import阻塞 | `fc348fa839681e62f8f8259c23b32887b60025669af567efba216fe506ed238d` |
| `install.txt`，原锁安装exit1 | `f8dd287585132cbd40bfd131f185700839ae0a06f055f1e085f6456e461529ef` |

### 依赖阻塞仍然保留

初次原服务import缺 `@earendil-works/pi-ai`。固定SHA临时副本中，空环境、临时HOME/npm cache/npmrc执行原锁 `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000`，实际exit1：registry.npmjs.org官方依赖下载 `EAI_AGAIN`，最终 `Exit handler never called!`。此前一次隔离PATH漏Node/npm目录导致exit127，纠正PATH后才发生真实安装失败。此次更正未重试安装或替代依赖。

根 `package.json` SHA256仍为 `2491412413bf931503c6f34295fe46bdfb4a520c29650b895529a557d527fb94`；`package-lock.json` 为 `2a7969eb6e35551c7d75cf9aa944d4f461de86d1e84e1afb28312d8187fa19bb`，与固定父提交一致。

## 交接

本支线文件均在 `test/document-provenance-acceptance/**` 和本报告内。没有生产修复项要求主线仅为旧红断言收紧跨源佐证。主线可选择性复用13项既有边界测试，继续在原依赖完整环境执行4个upload测试体及保存report断言；来源展示是否改进由产品/主线另行决定。未批准政策不阻碍现有契约验收，也未被默认为新需求。完成更正提交与Draft PR更新后停止，根验收和唯一公共后端writer职责仍归主会话。
