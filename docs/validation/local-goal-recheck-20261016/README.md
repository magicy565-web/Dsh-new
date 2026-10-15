# 本地 OMP 一句话会话复核（2026-10-16）

**结论：当前执行环境未通过目标验收。没有修复后真实 DeepSeek 运行结果，不应标记完成。**

从 `codex/final-native-context-integration-20261015` 的 `c68c6effb3547d470d111137c81ea28f26bb1f09` 继续，先阅读原 RESUME。
本次用户重新授权目标为：一句自然语言读取已选产品资料、判断缺项、保存结果，并在下一句话继续同一原生 Session。用户保留原 5 元 DeepSeek 总预算；不启动 Workspace 服务器、不改 main、不部署、不另开任务。

## 已检查和实际结果

原有 `npm run factory:local` 已支持位置自然语言目标、默认 `out/factory-session.jsonl`、原生 SessionManager 续接及模型自主工具选择。没有新增流程、Agent Loop、模型替身产品路径、模型或运行器切换，也没有修改产品源码或已有断言。

当前环境没有带 Git 认证的克隆通道，使用已授权 GitHub connector 从固定提交读取入口、相关测试及导入闭包，共 65 个原文件；每个本地文件均与该提交 Git blob SHA 完全一致。此检出仅覆盖本次验证所需文件，并非完整项目导出。原固定 npm 锁安装完成，生命周期脚本禁用，Node 24.19.0、官方 Bun 1.3.14、OMP 18.10.4 校验通过。

5 个相关文件的首次串行测试：22 项，13 通过、9 失败，0 取消/跳过，18.310 秒，退出码 1。首次本地还原漏取了原有 `scripts/acceptance-deepseek-readonly.mjs`，导致其中一项政策入口测试失败；随后只读取该原文件并单独复核政策测试，7/7 通过。两组存在重叠，不相加，后者不清除 Session 测试失败。

原生三轮上下文测试直接报：
`Failed to acquire native file lock ... Operation not permitted (os error 1)`。
独立调用固定原包 `FileLock.tryAcquire`，在 /tmp、/dev/shm、当前 scratch 目录均复现同一错误；普通 Python flock 可以成功，不能据此认定原生锁可用。锁错误的底层原因尚未确定，不据此归因为代码回归或某项具体平台策略。未替换/禁用 SDK 锁，也没有为通过而改写测试。受影响的会话读取/保存/续接链路仍未在本环境验证通过；停止重复运行依赖同一不可用能力的测试。

实际执行本地 npm 入口，显式选 `PI_PROVIDER=deepseek PI_MODEL=deepseek-flash`，输入为标注合成的 500ml 杯子资料：
- `--check`：`model-unconfigured`，本地文件就绪，模型请求 0，没有创建会话、锁或成果。
- 同一目标去掉 `--check`：退出 2，`LOCAL_MODEL_COST_AND_BUDGET_REQUIRED`，模型请求 0，没有创建会话或成果。

## 安全配置与费用

当前进程没有 `DEEPSEEK_API_KEY`、`PI_PROVIDER/PI_MODEL`、价格配置或预算核对声明；当前检出没有 .env。原记录提到的 /workspace/deepseek-acceptance 和真实 Session 目录均不存在，标准 OMP/Pi 用户配置目录也不存在。只核对存在布尔，没有读取、恢复或复制聊天凭据，没有创建 key。

原 `docs/WORKSPACE-OMP-LOCAL.md` 的最后已知累计保守费用为 **0.038716 元**，5 元授权剩余估算 **4.961284 元**。没有访问账户账单，不能证明此后账户没有其他消费，也不能把余额估算当账户余额。当前新请求 **0**，新增费用 **0 元**。本次缺少安全配置，因此没有启动真实模型验收；离线替身不代表真实模型。

## 启动方式

在完整指定分支检出、Linux x64 / Node 24+ 中，沿用原锁安装：

```sh
npm ci --ignore-scripts
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
```

准备已有 `product.md` 和输出目录 `out`，先用零模型请求预检：

```sh
npm run factory:local -- --input ./product.md --output-dir ./out "读取产品资料，判断缺项并保存说明。" --check
```

需运行环境已有安全注入的 DeepSeek 密钥、已审价格与适用预算配置，并支持固定 OMP 原生文件锁，才移除 `--check`：

```sh
npm run factory:local -- --input ./product.md --output-dir ./out "读取产品资料，判断缺项并保存说明。"
npm run factory:local -- --input ./product.md --output-dir ./out "接着刚才的资料，交期仍待确认，保存一份简短英文介绍。"
```

两句使用同一个 `out/factory-session.jsonl`。资料、目录和模型须保持一致，不是每次新建会话；不需要 Workspace Host。命令只是启动说明，没有在本次作为真实生成执行。详细非秘密配置沿用 [原说明](../../WORKSPACE-OMP-LOCAL.md)，不要在聊天、命令行参数或 Git 中提供密钥；不把本次未核对账户状态改成已核对声明。

## 未完成

1. 在支持原生锁的环境读取、保存并续接同一 Session 的当前分支验证。
2. 当前安全模型配置和适用剩余额度的核对。
3. 修复后真实 DeepSeek 两轮验收：同一 Session ID、有效用量/费用、保存文件和第二句上下文；本环境无此结果。
4. 原完整后端回归仍未完成；本次仅选取与单一目标有关的检查。

完整命令、原始日志哈希、配置布尔与预检回执见 [checks.json](./checks.json)。没有部署、启动 Workspace 服务或改变 main。此记录仅保存本次真实检查，不自动新开任务或重新执行付费调用。
