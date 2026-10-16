# 当前环境原生锁与本地会话预检

固定源码：`b8866e95f2c655603c7b55529b579f91c9626fa1`（产品源码 `c68c6effb3547d470d111137c81ea28f26bb1f09`）。已阅读前次复核和 RESUME。本次仅按新授权执行一次小范围零付费检查，不恢复小时自动推进。

**结果：本环境原生锁及两项最终源码离线会话检查通过；另一环境 EPERM 的底层原因仍为 UNKNOWN。没有产品源码修复，也没有真实 DeepSeek 调用。**

- Node `24.19.0`，官方固定 Bun `1.3.14`，Bun SHA 与仓库审计记录一致。
- 原包 `pi-natives 18.10.4`，实际 native build `18.10.4`；加载官方 `pi_natives.linux-x64-modern.node`，版本匹配，`stale:false`。未强制切换 CPU variant。
- 直接调用原 `FileLock.tryAcquire`，分别在 `/tmp` 和 `/workspace` 自建临时目录：获取成功、同路径第二持有者被阻止、释放后重新获取成功。临时锁均清理。未禁用/替换锁、改环境权限、提权或修改沙箱。
- 最终源码在独立 worktree 中检出；复用本环境已有依赖，三个依赖锁文件与原安装对应版本逐字节相同。仅临时链接相同已安装依赖，没有重新安装、升级或修改 native 包，也没有把锁路径迁移到其他环境。
- 两项原有测试依次执行，均退出0，各1项通过，0失败/取消/跳过：`workspace-omp-context-pairing` 和 `workspace-omp-local-context`。它们真实使用原 SDK、Session、原生读写/锁，以及有限 mock HTTP，覆盖多输入冷启动和三轮保存/正常结束；不是模型真实推理结果。

```sh
node --test --test-concurrency=1 test/workspace-omp-context-pairing.test.mjs
node --test --test-concurrency=1 test/workspace-omp-local-context.test.mjs
```

测试进程只继承 PATH、隔离 HOME/TMPDIR 和 NO_COLOR，没有模型/业务凭据。未重跑完整后端或构建；没有用历史测试总数代替本次两项结果。

## 已有配置

仅检查变量名称是否存在，未取出或打印密钥内容：`DEEPSEEK_API_KEY:true`。`PI_PROVIDER`、`PI_MODEL`、价格配置和预算核对声明均不存在，两个项目目录均无 `.env`。最终入口仍由原配置函数读取配置；密钥名称存在不能证明非空、有效或连通，也不能单独使付费准入就绪。本次没有补写配置或凭据。

## 最小下一步与未知项

本环境已经能运行上述原生会话链路，无须绕过锁或重新提供聊天密钥。真实模型验收前，仍需明确非秘密模型选择、当时适用的价格和预算声明，再按单一目标另行获准执行。本次没有触发付费测试。

另一环境只有原生 EPERM 和普通 Python flock 成功的记录，缺少可比较的实际 addon 路径/指纹及底层失败详情；不能据此确定是仓库回归、CPU variant、文件系统或特定平台策略。本环境未复现该失败，因此不继续猜测性重试、不改变权限或 SDK 来规避。

新付费请求0、新增费用0。最后记录的累计保守费用0.038716元、剩余授权估算4.961284元仅为既有记录，未查询账户，也未证明期间没有其他消费。未启动 Workspace 服务器、改 main、部署或新建自动任务。只新增本说明及脱敏检查元数据，不上传运行日志、会话或凭据。
