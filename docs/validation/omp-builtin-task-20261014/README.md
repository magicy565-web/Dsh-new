# OMP 内置 Task 子代理

```sh
OMP_BUILTINS_SDK_ROOT=/path/to/audited/node_modules/@oh-my-pi/pi-coding-agent \
OMP_TASK_SAVE_EVIDENCE=docs/validation/omp-builtin-task-20261014/results.json \
node --test test/omp-builtins.factory-task.test.mjs
```

正式固定SDK安装位置的实际检查：1/1通过，无跳过，OMP 18.10.4／Bun 1.3.14。直接使用发行包的 `TaskTool`、原子代理executor及原child AgentSession；未写替代调度器、worker runner或业务引擎。

两个明确限定 `read` 的合成公开产品reader在一次原Task批调用中执行。原subagent event bus记录两个不同子ID、最大活跃数2、两个成功read回执；结果分别包含各自合成文件与未知产能，不串用文书。四次明确模型替身调用完成两子分工。

随后用原Task调用启动等待中的合成子代理，再传入原AbortSignal。模型替身实际观察abort，原Task返回取消结果，原event bus活跃子代理归零；总模型替身调用数5，真实／付费调用0。OMP这里使用进程内child AgentSession，不声称存在或杀死两个OS子进程。

HOME、配置、空鉴权存储、公开文件和子代理材料在测试临时目录。此测试不提交原Workspace业务任务、不访问私库或宿主凭据，不证明真实模型、海外客户证据、发送权限或商业成果。默认受控Workspace宿主的可用工具集合仍应由原公开输入／授权／预算边界限制；不能用这个隔离测试授予任意本机read/bash/eval能力。
