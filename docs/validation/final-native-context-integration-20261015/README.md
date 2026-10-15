# 本地 OMP 源码集成与重启恢复检查点（2026-10-15）

**状态：按用户最新指令保存并结束；不再新增测试，不重启任何电脑。源码已集成，完整后端回归未完成。**

开发分支：`codex/final-native-context-integration-20261015`。
基线：`aebf6915aafa8fbf8ca44eed4db74e2b9930cb8d`。
纳入：`0f00be7e10080853cee5e4f13d60c5bd8c8e81c1`。
无冲突双亲合并：`2b1f923235d56256baf5fe03fe355b97bac863d0`，源码树
`74673bd37c4a0ef58c0458ba75f72b04d37c6c5b`。
测试提交 `17d6b1d07a01afafa3939f734c417c00c2a3050e` 把既有启动测试约 1 秒的等待改为有界 10 秒就绪等待。`f8659482f2da0722dbc369f713b86826e9290295` 为旧崩溃夹具设置显式临时 HOME/TMPDIR，并把同类子进程就绪等待从 5 秒改为有界 15 秒；身份、SIGKILL、预算、恢复和不重复执行断言均保留。产品源码与上述合并一致。`4c6e3ef3220d7a8c001d8c73a6e6e9eed479be28` 将两份 OMP 测试的冷启动/完成等待与旧 Pi 约 3 秒等待分开，使用有界 30 秒等待，权限、只读及取消退出断言保留。暂停时的回归代码/测试基准为 `4c6e3ef3220d7a8c001d8c73a6e6e9eed479be28`，源码/测试树 `80486736e424d1f78e878be4797229f957954a30`；交接提交另附说明和本轮紧凑验证元数据；不能把它当完整后端验收通过。两条指定输入提交均为最终分支祖先。

补丁源码及新增测试与上游固定提交逐字节一致。`pairLocalToolHistory`
按 assistant 工具批次及结果出现次序配对，跨轮可重用 ID，同批重复 ID
不授予配对。上下文投影把经过来源核验的读取副本交给原生 pruner，临时唯一 ID
仅存在于裁剪工作副本；发往模型及原生 JSONL 的 ID 保持不变。读取来源恢复使用
同一配对规则，失败后无新调用的陈旧成功回执不能恢复来源授权。

入口、Session 集成、DeepSeek transport/计费策略、Shopify 市场范围、锁文件和
依赖配置均与基线一致。未增加功能、固定报告、Agent Loop、Workspace Host
依赖或权限；仍为原 OMP SDK 持有 Session、工具循环与 JSONL。12,000-byte
请求、8 次实际发送、512 输出 tokens、thinking 关闭及未知用量停止规则保持不变。

## 本轮检查

| 检查 | 已保存结果 |
|---|---|
| 主构建（TypeScript + Vite） | 通过；保留既有 bundle 大小警告 |
| 主 DOM / 会话 DOM | 20/20、17/17 通过 |
| 小程序构建 | 通过 |
| OMP 内置工具补充检查 | 2/2 通过，合成搜索及本地 Chromium |
| 旧崩溃/启动夹具复核 | 12/12 通过 |
| OMP Session 只读复核 | 10/10 通过 |
| OMP 取消/恢复冷启动复核 | 2/2 通过 |
| 两项本地冷启动超时隔离复核 | 2/2 通过，保留原 30s/20s 测试界限 |
| 默认/显式 Session 的独立 npm 预检 | 两种路径通过，零模型请求、无新 Session/锁 |
| 最新 180 文件主组 | **暂停时 1,150 通过、0 失败、8 取消、10 跳过；未完成** |
| 最新 4 文件独立串行组 | 尚未启动 |

最新主组因用户要求保存并暂停而中断，退出码 1 和 8 个取消不能写成全绿。
中断前新的跨轮配对、三轮上下文裁剪、HTTP 发送/用量停止及已修正的只读客户端
检查均已通过，但这不代替完整后端结果。Python 客户端和直接输出配对/上下文紧凑
报告的两个命令也尚未启动。恢复清单、实际命令、已执行阶段、计数及日志 SHA256
见 [checks.json](./checks.json)，恢复步骤见 [RESUME.md](./RESUME.md)。计数有重叠，不能相加。

早期的未通过/被中断尝试也保留在 checks.json：缺少 dist 时提前启动后端、原 1s
启动等待、原 5s 崩溃就绪等待及原约 3s Pi 等待用于冷 OMP 时的超时。只调整测试
等待和临时 HOME；原语义断言、生产代码和费用/权限限制均保留。针对性复核通过后，
完整重跑又因这次用户重启要求暂停，未伪造完成。

当前 shell/Git 仍可执行。工具只提供等待环境就绪，没有重启当前云电脑的可调用
接口；Vercel/Sites 的其他环境工具不属于这台电脑，未使用。未执行 reboot、shutdown
或其他系统重启/销毁命令。最新指令明确不重启任何电脑，因此不请求平台重启、不自动恢复测试；恢复步骤仅供未来新授权。
本地原始证据另备份在 `/workspace/scratch/native-final-checkpoint-20261015/`，没有提交
原始日志；平台重启后是否保留本地目录不作保证，Git 中的源码和紧凑元数据才是恢复依据。

## 从固定源码使用

在 Linux x64、Node.js 24+ 的源码检出中安装原固定依赖：

```sh
npm ci --ignore-scripts
node scripts/setup-omp-runtime.mjs
node scripts/workspace-omp-install.mjs
npm run build
```

先准备真实存在的 `./product.md` 和 `./out`，使用零模型请求预检：

```sh
npm run factory:local -- --input ./product.md --output-dir ./out "先读资料并追问缺项，暂不生成报告" --check
```

已有适用的安全模型配置及费用授权时，移除 `--check` 执行一句目标；下一轮
保持相同输入内容、输出目录与模型，只换目标：

```sh
npm run factory:local -- --input ./product.md --output-dir ./out "先读资料并追问缺项，暂不生成报告"
npm run factory:local -- --input ./product.md --output-dir ./out "交期仍待确认，请按已有资料保存 intro.md"
```

两条命令默认使用同一个 `./out/factory-session.jsonl`；每条提交一个目标后退出，
可先追问，保存文件不覆盖已有文件。`--session /private/path/conversation.jsonl`
可明确选择另一会话。以上生成命令在本任务没有执行；不可把它们当零费用预检。
这里不提供或创建凭据、价格配置、预算声明或可访问的原任务会话文件。

## 复跑边界

本轮从无 `.env` 的干净源码检出运行。测试和构建子进程只继承 PATH、临时 HOME、
TMPDIR 及空 npm 配置路径；不继承模型/业务凭据。依赖安装另保留环境提供的网络
代理/证书设置，固定锁文件安装且禁用生命周期脚本。仓库和父目录未找到可用的
`AGENTS.md` 或 `.agents/skills`；已阅读交接、本地 OMP 文档及实际装载的
`packages/workspace-procurement/skills/factory/SKILL.md`。

原计划的完整后端使用 `scripts/test-backend.mjs` 的同一规范文件选择：180 个文件并发度 2，
PDF 全局临时文件清理、较慢的原生导入链及两个多次冷启动本地会话文件共 4 个文件
在后续独立组中串行运行。两组无重叠并完整覆盖 184 个规范文件。可在同样隔离的
干净源码环境复跑：

```sh
env -i PATH="$PATH" node --input-type=module <<'NODE'
import { readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = (await readdir('test')).filter(name => name.endsWith('.test.mjs') && !name.startsWith('ui.') && !name.endsWith('.dom.test.mjs')).sort().map(name => 'test/' + name);
const isolated = new Set(['test/factory-materials-read.test.mjs', 'test/workspace-omp-integrated-factory.test.mjs', 'test/workspace-omp-local-entry.test.mjs', 'test/workspace-omp-local.test.mjs']);
for (const [concurrency, selected] of [[2, files.filter(file => !isolated.has(file))], [1, files.filter(file => isolated.has(file))]]) {
  const home = await mkdtemp('/tmp/omp-final-regression-');
  try {
    await writeFile(home + '/empty-user.npmrc', '');
    await writeFile(home + '/empty-global.npmrc', '');
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: '/tmp', NPM_CONFIG_USERCONFIG: home + '/empty-user.npmrc', NPM_CONFIG_GLOBALCONFIG: home + '/empty-global.npmrc', NPM_CONFIG_UPDATE_NOTIFIER: 'false' };
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-concurrency=' + concurrency, ...selected], { stdio: 'inherit', env });
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  } finally { await rm(home, { recursive: true, force: true }); }
}
NODE
```

每个已执行阶段的完整 argv、退出码、计数、耗时及原始日志 SHA256 见 `checks.json`。
配对和三轮上下文夹具已由测试封装执行；单独直接输出紧凑报告尚未启动，不能用
历史结果补齐。原始日志、临时文件与 Session 均不提交。上述完整复跑命令仅供未来
重新获准、且在适用截止前使用，本次保存阶段没有重新执行它。

## 证据边界

本任务没有原任务的真实 Session 文件，也未读取或重放它。所有 Session、资料、
输出和服务数据均为临时合成夹具。原生 SDK、原生读写工具和 HTTP/SSE 路径实际
执行，但模型响应由明确有限替身提供；没有修复后的真实模型验收结果。
旧集成的 1,222 通过／10 跳过、补丁分支的 85 通过及旧真实模型记录均保留为历史，
不用于替代本轮结果，不把重叠测试计数相加，也不升级 UNKNOWN 任务状态。
持续增长的独特历史仍可能触发不变的 12KB 上限；有限三轮夹具不证明无限续聊。

真实付费模型、Shopify、业务 MCP/Muse 调用为零。未读取/输出实际凭据，未创建
实际凭据，未提交运行数据、原始日志、JSONL 或构建产物；未改动/合并/推送 main、
未强推、未部署。只推送用户已授权的开发分支源码、测试与说明。
