# workspace-purchases

采购单：与报价单对称，但**多了审批闸门**——采购是承诺，不是草稿。

## 规则

- **服务端算钱**：整数分存储与计算，客户端提交总额会被拒绝；
- **批准是管理员专属**：`draft → approved` 只有 `role: admin` 能做，operator 尝试返回 403
  `PURCHASE_APPROVAL_REQUIRED`；批准会记录 `approvedBy` / `approvedAt`；
- **状态机**：`draft → approved → ordered → received`，任意阶段可 `cancelled`；
  跳过批准直接下单返回 409；终态不可回退；
- **幂等**：`requestId` 重放返回同一张单；
- **审计**：`purchases.create` / `purchases.status` 都进审计。

## 关键设计：模型没有“批准”工具

| 工具 | 审批 | 说明 |
| --- | --- | --- |
| `purchase_order_create` | `always` | 模型起草采购单，需一次人工批准才落库 |
| `purchase_order_list` | `never`（只读） | 列出采购单 |

**没有任何工具能批准采购单**。批准只能通过 `POST /api/purchases/:id/status` 由管理员会话发起，
所以“模型自己下单”在结构上不可能——测试里专门断言了 `purchase_order_approve` 不存在。

## HTTP

```text
GET  /api/purchases/status
POST /api/purchases              { requestId, supplier, currency, lines[], note? }
GET  /api/purchases?status=
GET  /api/purchases/:id
POST /api/purchases/:id/status   { status }
GET  /purchases                  页面
```

## 验证

```powershell
node --test plugins/workspace-purchases/test/purchases.test.mjs
node scripts/purchases-smoke.mjs
```

冒烟：草稿 → 管理员批准（记录批准人）→ 跳过状态 409 → 下单 → 收货 → 页面 200。
