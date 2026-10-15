# 未来重新获准后的恢复状态

保存状态：最新用户指令是立即保存、停止新增/重复测试并结束，不重启任何电脑。
更早的重启请求不执行，测试不会自动恢复。当前环境仍可执行，未发现可调用的本机
重启接口；也未执行 reboot/shutdown、换执行者、创建实际凭据或付费模型调用。
下面仅为未来重新获准后的恢复状态，不构成继续执行授权。原截止 UTC 2026-10-15
23:00 仍保留，未经新指令不得越过截止启动工作。

## 固定源码

- 仓库：`magicy565-web/workspace-agent`
- 分支：`codex/final-native-context-integration-20261015`
- 源码/测试基准：`4c6e3ef3220d7a8c001d8c73a6e6e9eed479be28`
- 源码/测试树：`80486736e424d1f78e878be4797229f957954a30`
- 产品代码合并：`2b1f923235d56256baf5fe03fe355b97bac863d0`
- 指定基线和补丁均为祖先，0f00be7 的五个源码/测试文件逐字节一致。

使用最终回复中的交接 SHA 检出；它只在上述源码/测试基准上增加说明与紧凑证据。
不要改动、合并或推送 main，不强推、不部署。未来获准恢复时先核对工作目录、Git 状态和
Node 24+，按需要恢复原锁文件和固定 Bun 1.3.14 / OMP 18.10.4。不要读取凭据；
测试继续使用空 npm 配置、临时 HOME 和模型/业务凭据不继承的环境。源码/构建
指纹应为 `131b8993d7535ed64894f0e4ad101e47a407f3c5593331c866bda833db0135e8`。

## 当前未完成检查

8 个主组文件因用户暂停被取消（部分文件有已通过用例，重跑会重叠）：

- `test/workspace-omp-shopify-product.test.mjs`
- `test/workspace-omp-snapshot-lifecycle.test.mjs`
- `test/workspace-omp-task.test.mjs`
- `test/workspace-omp-terminal-host.test.mjs`
- `test/workspace-omp-terminal-intent.test.mjs`
- `test/workspace-omp-terminal-recovery.test.mjs`
- `test/workspace-omp-terminal.test.mjs`
- `test/workspace-omp.test.mjs`

4 个原计划独立串行文件尚未在最新尝试中启动：

- `test/factory-materials-read.test.mjs`
- `test/workspace-omp-integrated-factory.test.mjs`
- `test/workspace-omp-local-entry.test.mjs`
- `test/workspace-omp-local.test.mjs`

另未启动：`python3 test/agent-client.test.py`，以及直接运行
`test/fixtures/workspace-omp-context-pairing.mjs`、`test/fixtures/workspace-omp-local-context.mjs`
输出紧凑报告。两个夹具的封装测试已通过，但直接报告不能填成已执行。

优先复跑这些未完成文件；有时间再按 README 的 180+4 命令复跑完整规范集合。
暂停前部分计数与恢复检查会重叠，未经逐文件去重，不要相加成一个“全后端通过”总数。
保留原测试断言、价格/预算、8 次发送、12KB、512 输出及未知用量停止限制。
所有模型继续用明确有限替身/mock HTTP；没有原任务真实 Session，不能假称已读取、
回放或完成修复后的真实模型验收。不要启动 provider-live 或真实生成命令。

## 证据位置

Git 中 `checks.json` 保存完整阶段命令、真实退出码、计数、日志哈希、来源指纹及未完成
清单。当前最新主组：1,150 通过、0 失败、8 取消、10 跳过，明确为用户暂停后的未完成结果。
已通过的构建、DOM、针对性复核及零模型预检见 README；历史 1,222/10 和 85 通过
不能升级成本次最终结果。

本地备份：`/workspace/scratch/native-final-checkpoint-20261015/`（原始日志、阶段元数据、
临时验证脚本；不含真实 Session/凭据）。其平台重启持久性未知，不依赖它恢复源码。
原临时目录 `/tmp/native-final-20261015/` 可能丢失；脚本中的绝对路径需在恢复后核对，
不要把本地脚本文件的存在当成任何阶段已执行。

本次保存已停止测试流水线；不会在保存提交后自动启动新的测试、模型或业务工作。
