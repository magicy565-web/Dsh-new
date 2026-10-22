# workspace-quotes

报价单：一个最小但完整的商业单据域。

## 规则

- **服务端算钱**：客户端只能提交明细（描述、数量、单价），总额由服务端计算，提交 `total` 会被拒绝；
- **整数分**：金额以 minor units（分）存储与计算，避免浮点漂移；展示时格式化为两位小数；
- **状态机**：`draft → sent → accepted | rejected`，`draft → rejected`；终态不可回退，越级返回 409；
- **幂等**：同一 `requestId` 重放返回同一张报价，不会重复创建；
- **权限**：viewer 可读不可建不可改；写操作写 audit（`quotes.create` / `quotes.status`）。

## HTTP

```text
GET  /api/quotes/status
POST /api/quotes                { requestId, customer, currency, lines[], note? }
GET  /api/quotes?status=all|draft|sent|accepted|rejected
GET  /api/quotes/:id
POST /api/quotes/:id/status     { status }
GET  /quotes                    页面
```

## 模型工具

| 工具 | 审批 | 说明 |
| --- | --- | --- |
| `quote_create` | `always` | 模型起草报价，必须经一次人工批准才落库 |
| `quote_list` | `never`（只读） | 列出报价与状态 |

## 验证

```powershell
node --test plugins/workspace-quotes/test/quotes.test.mjs
node scripts/quotes-smoke.mjs
```

冒烟：创建草稿 → 服务端总额 `6550.00` → 列表 → 标记已发送 → 非法回退 409 → 页面 200。
