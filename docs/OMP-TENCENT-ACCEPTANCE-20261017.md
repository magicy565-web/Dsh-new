# 腾讯云指定矩阵现场验收

**执行与证据归属：父任务协调，在原云浏览器tab18的唯一终端、腾讯云实例ubuntu用户下实际执行。本文作者没有亲自操作服务器，只按父任务提供的脱敏元数据记录；未读取或下载服务器日志、Session、草稿、密钥或实际业务资料。**

## 现场有效版本

- 源码：`95b0a2f8ecbd23231c4a7cee9872e18fe23394f2` 的1256文件源码归档选集，逐文件SHA核验。
- 归档SHA256：`cd278f8010afa14cd55c3cee702b24b39ae523cf61d0bcae590ab17c794abbf0`。
- 后续仅应用测试补丁：`8c117ee5d17da16e52aa8eb0d3e75a136fbf962d`，补丁SHA256 `99386b03b1de4a07b855937c13e095b5fe00757061cd47e9b4924cbae6199282`。
- 补丁经Library送达，现场核hash、`git apply --check`及apply；目标测试文件SHA256为 `d5111dbe4962e30f1cc18c330b023ee097c8fa98d8954ccf3e8d6a6ab4c5d8ae`。
- 补丁后重新核对1256项：仅指定测试文件改变，其余1255项不变。有效版本为 **95b0a2f源码＋8c117ee单测试补丁**，不代表 `5602ee9` 全量部署，也不代表本次文档HEAD已部署。

现场Node24.19、Bun1.3.14、OMP18.10.4；根项目/OMP/Bun锁文件与原固定依赖逐字节核对一致，原nativeLock通过。清空环境、隔离HOME，未提权、未修改旧服务。

## 实际结果与保留的失败

| 检查点 | 父任务报告的现场结果 |
| --- | --- |
| 95b入口预检、typecheck、build:omp | 通过；14插件发现、加载、禁用、卸载；零模型请求 |
| 95b Session矩阵 | 21/21 |
| 95b context矩阵 | 43/43 |
| 95b首次完整询盘 | **26/27**；仅多草稿cancel用例的mutationCompleted标记断言失败 |
| 未修补时独立取消单项 | 1/1；不能据此删除或改判首次失败 |
| 95b＋8c测试补丁完整询盘 | **27/27，exit0，72.91秒** |

补丁后现场取消顺序明确记录：

```text
cancel HTTP start → response held
→ Run terminal observed (cancelled, mutationCompleted=false)
→ response released → received → injection completed
```

这里的中间false是修正用例刻意持有HTTP响应时的预期观测；随后显式等待注入完成，原完成断言及草稿保留、原Session/历史、模型调用等断言通过。最初失败用例的原HTTP/Run完整轨迹没有记录，不用补丁后轨迹补造首轮历史。[测试同步修正说明](OMP-INQUIRY-CANCEL-ORDER-20261017.md)保留本地确定性反例与仅测试修复范围。

## 脱敏证据定位

父提供现场目录 `/tmp/workspace-pr99-95b0a2f-wKkikS`，以下仅记录文件名及现场给出的SHA256。本作者未拉取文件，也未独立重算服务器文件hash；不复制原始日志或运行数据入库。

| 现场文件 | SHA256 |
| --- | --- |
| server-acceptance-summary.json（首轮） | `bda522902dbaed372a71c6d157a356a1a009a314c736ce0dc355688406d12096` |
| server-inquiry-fixed-8c117ee-evidence.json | `7b28e6ee86a1ebf8c478a94389580426a0a063c4a6cc12950d496032d24185a5` |
| inquiry-fixed-8c117ee.log | `bc37dd43c4f95cf77d3a3e4f994b3afde971286872503cde838027610e527083` |

上述版本、矩阵及来源边界的结构化转录见 [现场元数据](validation/omp-tencent-acceptance-20261017-summary.json)。

## 验收范围与真实调用阻塞

这是实际腾讯云机器上指定矩阵的工程验收。模型响应、业务授权和业务资料仍为fixture，真实模型未执行，外部服务未验；不能写成全仓或生产验收，不推进产品/Brain、外部业务或部署阶段。

另有PR98的 `b53d1e7` 报告：现有配置 `GET /user/balance` 返回401，归因未知。父本轮没有重复请求或读key；本作者也未调用该接口。历史DeepSeek真实接入已证实的口径保持，401报告不提供当前安全认证或剩额核对结论。

用户允许真实测试费用，仍共用原累计人民币5元上限。认证与预算尚未核实，不能启动付费；本轮无真实模型或外部业务调用。此次仅文档提交push同分支Draft PR99，没有功能开发、服务器操作、凭据读取/创建、main修改、合并、强推、部署或扩权。
