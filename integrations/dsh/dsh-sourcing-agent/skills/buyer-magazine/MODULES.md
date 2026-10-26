# 微刊模块输入

本包只有一个 Skill、十个内容模块和一个 Node 文件渲染器。无服务器、数据库、插件市场或项目状态机。模块清单随本期 JSON 保存。

创建由对话驱动。输入资料来自实际可读的用户电脑工作区，或当前工单上传到服务器的附件。云端不能直接读取未接入的用户电脑。工单接入尚未实现；可选 mini-erp 插件另行提供本机交易工具。此输入格式和渲染器本身不提供上传或交易服务。

```json
{
  "title": "本期标题",
  "audience": "本期读者和用途",
  "language": "zh",
  "preview": false,
  "blocks": [
    {
      "id": "product-a",
      "type": "product",
      "product": "产品名称（整期模块可省略）",
      "data": {"summary": "有依据的介绍", "features": ["有依据的特点"]},
      "evidence": [{"label": "产品规格表", "reference": "用户提供的规格表及对应页码", "date": "2026-10-26", "kind": "provided"}]
    }
  ]
}
```

`blocks` 必须显式提供且至少一项；删除即省略，重排即改变展示顺序。可重复类型，不可重复 id。`title` 可为某个块指定自定义标题；`product` 是读者可见标签，不建立产品数据库或依赖产品展示模块。

`evidence` 可含 label、reference（文件位置或来源描述）、date、kind 及可选 url。kind 为 observed（实际读取）、provided（提供资料）、estimated（估算）或 illustrative（仅排版示意）。这些标签由编辑者提供，脚本不证明来源真实性。illustrative 只能出现在 `preview: true` 的文件中。preview 会显示醒目标识并禁用产品／申请操作入口；来源链接仍可查看。所有输出均标为未发布工作稿或排版预览。

## 各模块 data

字符串必须有内容，文本列表至少一项；未知文本可以如实写“待确认”。字段目录也可用 `node scripts/render.mjs --list` 查看。

| type | 字段 |
| --- | --- |
| product | summary：文字；features：文字列表；可选 imageUrl + imageAlt、productUrl |
| buyer-fit | buyerContext：文字；reasons：列表；可选 unknowns：列表 |
| opportunity | signals：列表；interpretation：文字；uncertainties：列表 |
| launch | status、timing、availability：文字，明确确认状态 |
| sales-history | comparables：对象列表，详见下方 |
| margin | currency：三位币种；salePrice、purchaseCost、freight、duty、otherCost：非负单件金额，售价 > 0；channelFeeRate：0–1；assumptions：列表 |
| comparison | columns：列名列表；rows：二维文字列表（与列数一致）；caveats：限制列表 |
| procurement | terms：条款列表 |
| sample | terms：条件列表；可选 actionUrl |
| exclusive | status：proposed / confirmed；territory、channel、term：文字；conditions：列表；可选 slots：非负整数、asOf：快照时间、actionUrl |

sales-history 中每个 comparable 含 name、period、market、channel、currency、basis（统计口径）、comparability（可比性说明）、revenue（非负数）、measurement（reported / estimated）、source（本块 evidence 的零起始索引）。reported 表示来源报告，不代表我们获得审计权限；estimated 必须保留估算标记。每行必须绑定来源。该模块允许不同币种，但不跨币种汇总或默认换汇。

margin 按以下公式计算，不接受模型直接写入利润结果：

```text
渠道费 = 售价 × 渠道费率
贡献利润 = 售价 − 采购成本 − 运费 − 关税 − 其他单件成本 − 渠道费
贡献利润率 = 贡献利润 / 售价
```

固定成本、税、退货等若未列入，应在 assumptions 说明；这不是完整利润预测，也不模拟售出率。

exclusive 的 confirmed 必须带供应方依据，表示权益条件已确认，不表示买手已锁定；slots 仅可与 confirmed 和 asOf 一起出现。零名额时禁用申请入口。交易 actionUrl 应由实际 ERP 接入提供，HTML 本身不提供并发名额扣减或锁定结果。proposed 的动作显示申请洽谈，不能称作已经持有权益。样品和采购等交易状态同样以 ERP 为准。

链接仅允许无内嵌账号密码的 HTTP(S) 地址；不允许输入 HTML。文本统一转义。图片仅作为 URL 引用，不下载、授权或验证图片本身。

## 组合示例

- 新品预告：product → launch → sample。
- 个性化选品：buyer-fit → opportunity → sales-history → comparison。
- 采购洽谈：product → margin → procurement → exclusive。

以上只是示例，每期由用户要求决定，不是固定套餐或必经顺序。
