# 询盘多草稿最终窗口修复

源码/测试：`f50f55bb31b7f5d6547982a19e25c8797d2a58c0`；基线：`94c3afc10c7745f252f8e5280f7852468cfe50f3`。本轮只修独立复核指出的同Session多草稿窗口，同一开发分支/Draft PR99；随后仅文档交付。

## 反例与修复

原签名Host与OMP Session连续两轮保存草稿A、B。Node最终检查已经下载校验A，再等待B下载时，通过原 `artifacts.update(A, …)` 提交A的v2。基线仍把第二轮Run标为成功；没有篡改journal、proof或来源回执。基线三个用例中控制/撤Session通过，A升版负例失败（2通过/1失败，退出1）。

原因是逐条回执各自校验结束后，先前回执没有在整个边界最后重新检查。现保留全部原异步来源/字节/授权校验，再在最后一个await之后同步核对本次全部成功披露的来源与草稿快照。复用原来源版本检查、Artifact版本/SHA/归属/审核标志检查；原Host注入既有 `assertActive` 和原Library同步授权栅栏，检查活跃Run、原Session、接收者、范围及期限，保留取消信号。

快照只属于本次交付，结束即丢弃，不构成跨请求proof缓存、持久记录或新权限体系。同步尾检不暴露给worker RPC或模型工具，不创建Session、AgentLoop、DB、队列、预算或授权，也不修改Provider/限额。bridge的原交付流程不变。

## 当前验证

新增四个用例均实际使用同原生Session两轮、不同原Run、原Store/Artifact和有限模型响应（每组4+2次逻辑模型调用）：

| B最终下载期间的操作 | 第二轮结果 | 保存结果 |
| --- | --- | --- |
| 正常控制 | succeeded | A/B各v1，均保留 |
| 原Artifact服务将已检查A升到v2 | failed，精确OMP_DISCLOSURE_REFUSED | A当前v2、不可变v1及B的v1均保留 |
| 原签名HTTP撤销Session | failed，精确OMP_DISCLOSURE_REFUSED | A/B各v1均保留 |
| 原签名HTTP取消当前Run | cancelled | A/B各v1均保留 |

断言Node最终下载顺序确为A→B、同一原生Session映射、原JSONL前缀逐字节不变、A旧版本不可变、B字节/创建Run/未审核/未发送标志不变。未把已提交草稿伪称回滚。

固定Node24.19.0、审计Bun1.3.14、OMP18.10.4；子进程白名单环境仅PATH、临时HOME及NO_COLOR。最终生产和测试文件与上述提交一致：

| 检查 | 结果 |
| --- | --- |
| 询盘服务、原OMP询盘、单/多草稿最终边界 | 27 passed，0 failed/cancelled/skipped |
| 原SDK解析、业务组合/发送、重置、原生插件装载与移除 | 45 passed，0 failed/cancelled/skipped |
| typecheck | 通过 |
| plugins:check | 14插件静态检查通过 |
| build:omp | 14插件原生编译/发现/加载及disable/uninstall通过 |

计数有交集，不相加独立总数。精确argv、源码tree/文件及日志SHA256、失败/成功边界见 [数值证据](validation/omp-stage2-inquiry-multidraft-20261017-summary.json)。不提交原始日志、Session、草稿或运行资料；测试仅使用可清理的合成临时目录。完整后端/浏览器、pack闭包检查本轮未重跑，未把历史检查点结果写作当前结果。

本轮真实模型/外部业务请求0，新增支出0。当前安全模型配置、累计账单/剩额、真实完整两轮仍未核实，阶段3–5不推进；历史DeepSeek连接已确认的口径不变。未读取/创建真实密钥或配置、操作服务器、扩权、改main、合并、强推或部署；Mem0向量关闭。仅此窗口修复与相关证据提交推送后收尾。
