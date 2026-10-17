# 未应用的管理员诊断草案

开发归档，不是可部署补丁，不应在当前服务器应用或要求用户重建/重试。

父协调最新转录：2026-10-17 11:40 UTC，用户亲自执行原安装命令后Shell退出0，user/auth_identity/provider_identity各1条。作者未操作服务器或独立查询数据库，未读取实际身份、凭据或记录正文。此前失败根因未被证明，不能认定原流程必现失败，也不能把输入行尾、fd或XDG推测写成现场根因。

原 `acceptance/medusa/create-user.mjs`、`entrypoint.mjs` 及默认契约测试已恢复为本轮开始前的字节。`UNAPPLIED-DRAFT.patch`仅保存本轮尚未采用的诊断源码和合成测试，未挂入Docker构建或启动路径：固定阶段码、隐藏readline、异步私有fd3、固定白名单fd4和原生函数观察包装。它不生成密码、不授权重试、不修复或修改已创建账号。

已做验证及边界：

- 合成输入/错误码/延迟与分块fd3/取消边界等单元检查与既有契约合计15 passed，0 failed/cancelled/skipped。
- 固定Node镜像、UID1000/read_only/network=none下，真实固定SDK的Configstore、nativeUser导入及provider布局预检查退出0，未调用nativeUser、连接DB或创建账号。
- 完整合成PTY实验没有通过：使用实际nativeUser函数与明确假服务，停于SERVICE_INITIALIZATION_OK之后的固定失败码；fixture没有完整提供原生utility常量。用户要求停止后未继续排查，不能据此宣称新草案完整可用，亦不能归因于现场原流程。
- 旧隐藏输入函数对LF/CR的源码差异只是待验证观察，本轮没有证明它造成现场失败；此前完整fd3替身成功也不证明真实服务初始化。

准确范围及hash见 `SUMMARY.json`。本轮没有真实账号测试、密码生成、聊天凭据使用、服务器操作、重启或数据库写入。当前服务器无需应用任何诊断变更，继续使用已经审查的f3ce36d非破坏产品建读改入口，由用户本人完成隐藏输入。真实产品验收结果尚待父协调回报，不能因管理员已创建而自动记为通过。
