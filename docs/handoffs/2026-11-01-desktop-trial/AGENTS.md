# 工作区接续入口

在本目录继续开发前，先阅读 `DEVELOPMENT_CONTEXT.md`。

- 已完成验收的 EXE 是 `0.1.0-trial.2`。
- 当前源码和 `release-path.txt` 指向 `0.1.0-trial.3` 候选；该版尚未完整验收，也未生成交付 EXE。
- 用户要求后续开发定制 UI 外壳，同时保留官方 DeepSeek Harness 作为执行内核；不要另建 Agent 循环或绕开原生权限。
- 用户本轮要求先保存上下文。后续工作范围由用户的新请求决定。
- 修改原生插件目录前另读 `H:/dsh-native-platform-work/AGENTS.md`，保留其他聊天的改动。
- 构建和报告中严格区分已通过、部分通过、失败与尚未验证；不能复用旧版结果冒充新版验收。
