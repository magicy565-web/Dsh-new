# workspace-market — Muse AI Worker 市场（Harness 业务插件）

把「Muse AI Worker 市场 + 工作电脑 desk」接进我们自己的 Workspace Harness（P0 组合层）。
数据形状与文案来自 workspace-agent 近期分支：

- `docs/MUSE-WORKER-MARKET.md`：浏览 / 已开通 / 我的 Worker、方案页、开通
- `docs/MUSE-WORKER-DESK-API.md`：电脑实例、`booting|running|needs_you|idle`、未接入画面
- `docs/GROKBOT-PERSONAL-WORKER.md`：个人 Worker 状态灯，未配置不显示假的已聘请

## 它做什么

| 入口 | 行为 |
| --- | --- |
| `GET /market` | Muse 品牌页面：AI Worker 市场（浏览 / 已开通 / 我的 Worker） |
| `GET /` | 302 → `/market` |
| `GET /api/market/status` | 真实计数与 `source`（`workspace` / `demo`）、`runtime: "off"` |
| `GET /api/market/workers` | 已上架 Worker 列表，支持 `q` / `category`；不含归属者 bio |
| `GET /api/market/workers/:workerId/scheme` | 方案页五块：归属者 / 服务（含「不做」）/ 工作方式 / 价格与规模 / 能力 / 近 7 日交付 / 评价 |
| `POST /api/market/workers/:workerId/activate` | 开通：`scale`（light 1 台 / standard 2 台 / fast 4 台）、整数 `budgetCap`（业务帽，不结算）、`confirmActionIds` 子集、可选 `requestId` 幂等 |
| `GET /api/market/activations` | 开通记录 |
| `GET /api/market/desk` | `{ status, source, catalog, hires, instances, requests }`；电脑在 runtime=off 时停在 `booting` |
| `POST /api/market/desk/computers/:computerId/screen` | 未接 noVNC → `409 COMPUTER_SCREEN_UNAVAILABLE`，不返回 URL |
| tools | `market_workers` / `market_desk`（只读）、`market_activate_worker`（`approval: always`） |

## 诚实边界（照分支契约）

- 目录只来自已上架 Worker。默认空目录；**演示目录必须由组合行显式 `demo: true`**，
  页面显示「演示目录」，且评分位一律「还没有评价」，不显示虚构数字。
- 价格只展示；预算上限是业务帽，不结算。开通成功后电脑是 `booting`，
  没有 `MUSE_COMPUTER_RUNTIME`/noVNC 应答就不会出现画面或 `running`。
- 支付、结算、Provider 探测/审核上架、Grok Bot 实际派发都不在本插件里：
  「我的 Worker」只画发布向导的边界说明，不伪造审核状态。

## 组合行

`harness.local.yml`：

```yaml
  - id: market
    name: workspace-market
    config: { demo: true }     # 去掉 demo（或设 false）得到空目录的真实路径
```

依赖 seam：`requires: [storage, tools, approval]`。存储段写在 harness 自己的
`.harness-data`（`state.harnessMarket`），绝不写现有 Workspace `.data`。

## 测试

```sh
node --test plugins/workspace-market/test
```

- `plugin.test.mjs`：路由/工具/健康检查注册、demo 与空目录、方案页、开通校验与
  requestId 幂等、电脑数与 `booting`、屏幕 409、只读/审批工具、静态页面与 CSP。
- `ui.test.mjs`：页面无跨域地址、Muse 品牌与真实文案；用 jsdom 渲染真实夹具，
  点开方案页并提交开通，断言 POST 与「工作电脑 / 开机中 / 未配置」。

## 下一步（未做）

- `src/` 的 Vite 应用里挂 `page.body`，让产品首页能进入这个市场；目前市场页面由
  harness 自己在 `http://127.0.0.1:8790/market` 提供。
- Provider 注册表（草稿 → 探测 → 提交审核 → 平台人工上架）与 `MUSE_COMPUTER_RUNTIME`
  的 noVNC 画面；这两块需要真实运行时，当前 fail-closed 为「未接入」。
