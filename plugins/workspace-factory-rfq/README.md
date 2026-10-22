# workspace-factory-rfq

把「客户询盘」和「工厂供给」整理成**草稿**，并诚实标注缺失与不可验证项。

## 两个工具（都是只读）

| 工具 | 作用 |
| --- | --- |
| `factory_rfq_capture` | 把客户 RFQ 整理成草稿：product / spec / quantity / target_market / requested_delivery / requirements；缺的字段进 `pending` |
| `factory_match_prepare` | 用显式提供的 `rfq` 与 `offer` 字段做匹配准备：`matched` / `differs` / `unverifiable` / `pending` 四类 |

两者都是 `readOnly: true` + `approval: 'never'`：**不落库、不需要审批、没有任何副作用**。

## 诚实边界（写进返回值）

- `status` 永远是 `draft` 或 `preparation`，不是 verified / confirmed；
- `notice` 明确写“不是报价、不是承诺、不是已验证匹配”；
- 数量非数字时进 `unverifiable`（`NON_NUMERIC`），不猜；
- 交期与 `lead_time` 需要日历才能比较，一律进 `unverifiable`（`NEEDS_CALENDAR`）；
- 未知字段直接 400，避免模型塞入价格、客户隐私等不该处理的字段。

## HTTP

```text
GET /api/factory/capabilities   → { supported, verification: 'none', storesAnything: false, tools }
```

## 验证

```powershell
node --test plugins/workspace-factory-rfq/test/factory-rfq.test.mjs
```

**已知缺口**：还没有模型驱动的端到端冒烟（工具在组合里注册、doctor 通过，但尚未跑
一次“模型调用该工具”的 run）。下一轮补一个 `factory-smoke.mjs`。
