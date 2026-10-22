# 能力地图（自动生成）

生成时间：2026-10-22T20:54:55.989Z

插件 **19** 个 · 路由 **110** 条 · 工具 **32** 个 · 有测试 **19** · 有冒烟 **17** · 有页面 **12**

| 插件 | 路由 | 工具 | 测试 | 冒烟 | 页面 | 挂载 |
| --- | --- | --- | --- | --- | --- | --- |
| `workspace-access` | 5 | 0 | 2 | 1 | ✓ | — |
| `workspace-artifacts` | 5 | 1 | 1 | 2 | — | ✓ |
| `workspace-business-memory` | 13 | 8 | 3 | 3 | ✓ | ✓ |
| `workspace-chat` | 12 | 0 | 2 | 9 | ✓ | ✓ |
| `workspace-factory-rfq` | 1 | 2 | 1 | 1 | — | ✓ |
| `workspace-goals` | 6 | 0 | 1 | 1 | ✓ | ✓ |
| `workspace-harness-review` | 1 | 0 | 1 | 1 | — | — |
| `workspace-home` | 1 | 0 | 1 | 1 | ✓ | ✓ |
| `workspace-inbox` | 5 | 0 | 1 | 4 | ✓ | ✓ |
| `workspace-inquiry-recovery` | 13 | 3 | 1 | 1 | — | ✓ |
| `workspace-llm-bridge` | 0 | 0 | 4 | — | — | 禁用 |
| `workspace-market` | 11 | 3 | 2 | 1 | ✓ | ✓ |
| `workspace-ops` | 5 | 0 | 1 | 1 | ✓ | ✓ |
| `workspace-procurement-compare` | 1 | 1 | 1 | 1 | — | ✓ |
| `workspace-product-library` | 13 | 10 | 1 | 3 | ✓ | ✓ |
| `workspace-purchases` | 6 | 2 | 1 | 2 | ✓ | ✓ |
| `workspace-quotes` | 6 | 2 | 1 | 2 | ✓ | ✓ |
| `workspace-runner` | 0 | 0 | 3 | — | — | ✓ |
| `workspace-schedules` | 6 | 0 | 1 | 1 | ✓ | ✓ |

## 没有测试的插件

（无）

## 真正的缺口：已挂载、无冒烟、无说明

（无）

## 间接覆盖（有说明）

- `workspace-runner` — 每次 run 都由 runner 执行，冒烟通过聊天/工具路径间接覆盖

## 默认禁用（有说明）

- `workspace-llm-bridge` — 组合里默认禁用（外部桥接，按需开启）

## 未挂载且无冒烟的插件包

（无）

> 说明：冒烟引用是“文本里出现了插件 id、API 前缀或工具名”，不等于该插件的全部路径都被覆盖。
> 「真正的缺口」只列已挂载、无冒烟引用、也没有人工说明的插件；
> 人工说明表在脚本的 `COVERAGE_NOTES` 里，必须写清楚理由，不能用来掩盖缺口。
