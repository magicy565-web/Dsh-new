# OMP 与原 Workspace 核心衔接

实际执行：

```sh
WORKSPACE_OMP_PACKAGE_ROOT=/path/to/audited/node_modules/@oh-my-pi/pi-coding-agent \
node --test test/workspace-omp.test.mjs
```

本检查点 3/3 通过、无跳过。运行原HTTP、原enterprise Session与成员绑定、原Runtime Run，以及 Bun 1.3.14 中固定 OMP 18.10.4 的真实 AgentSession。模型均为明确有限合成替身，不访问真实账号或付费模型。

已验证：

- 原Conversation消息进入原Run，经Bun SDK调用工厂配置工具并回传原进度事件；相同requestId复用原Run，外成员无法读取关联结果。OMP只保存独立public transcript的原Conversation映射。
- `workspace_factory_task` 仅提交原 `factory-export` preset；原HTTP／coordinator／Pi Durable继续完成四阶段。一个前台Run加四个原阶段Run，共五个；一个原业务任务、三个原字节／SHA一致文书，没有第二业务队列或全局Artifact副本。
- 只读意图不能提交业务任务；旧Pi scope／私库会话不得迁入OMP。包的私库工具未载入，当前选定公开工厂Skill通过官方加载器加载。

Node与Bun之间是有界私有fd传输；工具仍调用原client，模型调用、工具操作、结果和会话映射均复用原授权校验。服务token不进入子进程argv/env／模型上下文／源码验收产物。进度事件只保留允许的工具名及SHA256调用ID，不传工具参数或结果。结果需通过原授权验证且观察子进程退出后才成功。

原Pi／Library／包共存回归另实际通过33/33，无跳过；TypeScript通过。原Library的精确接收方、Session、修订和缓存逐次检查仍保留。原人用取消、恢复、批准、继续命令是显式宿主选择，不是模型工具；本核心三项没有替代完整人工生命周期端到端证明。

默认单一启动入口尚未接线；此处不能声称 `npm run workspace` 已可用。内置Task子代理、真实模型剩余预算、真实客户搜索及商业成果尚未由本组测试证明。实际DDG连接阻挡见 [内置工具检查](../omp-builtins-factory-20261014/README.md)。不部署、不合并、不发信、不升级Worker权限，也不开发七天未来通知的持续同意／收件人机制。
