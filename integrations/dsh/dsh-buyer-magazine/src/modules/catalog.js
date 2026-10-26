// Portable module catalogue. No host services, network requests or business state.
export const modules = [
  { id: 'product', name: '产品展示', en: 'Product', purpose: '介绍产品及有依据的差异', fields: ['summary', 'features'], optional: ['imageUrl', 'imageAlt', 'productUrl'] },
  { id: 'buyer-fit', name: '为什么推荐给你', en: 'Why this fits you', purpose: '连接买手的实际客群、价格带和渠道', fields: ['buyerContext', 'reasons'], optional: ['unknowns'] },
  { id: 'opportunity', name: '产品机会点', en: 'The opportunity', purpose: '区分市场信号、判断与待验证假设', fields: ['signals', 'interpretation', 'uncertainties'] },
  { id: 'launch', name: '新品首发', en: 'Launch preview', purpose: '说明上市状态、时间依据和首批安排', fields: ['status', 'timing', 'availability'] },
  { id: 'sales-history', name: '同类历史销售', en: 'Comparable sales', purpose: '展示有来源及可比口径的历史表现', fields: ['comparables'] },
  { id: 'margin', name: '销售利润测算', en: 'Unit economics', purpose: '按明确成本假设测算单件贡献利润', fields: ['currency', 'salePrice', 'purchaseCost', 'freight', 'duty', 'otherCost', 'channelFeeRate', 'assumptions'] },
  { id: 'comparison', name: '同类产品对比', en: 'Product comparison', purpose: '逐项比较，而不预设本品胜出', fields: ['columns', 'rows', 'caveats'] },
  { id: 'procurement', name: '采购条件', en: 'Buying terms', purpose: '呈现已知条款及尚需确认的条件', fields: ['terms'] },
  { id: 'sample', name: '样品申请', en: 'Request a sample', purpose: '说明样品条件并进入真实申请渠道', fields: ['terms'], optional: ['actionUrl'] },
  { id: 'exclusive', name: '独家供应名额', en: 'Exclusive supply', purpose: '呈现供应商确认的权益范围及锁定入口', fields: ['status', 'territory', 'channel', 'term', 'conditions'], optional: ['slots', 'asOf', 'actionUrl'] },
];
export const moduleById = new Map(modules.map(item => [item.id, item]));

export function economics(data) {
  for (const key of ['salePrice', 'purchaseCost', 'freight', 'duty', 'otherCost', 'channelFeeRate']) {
    if (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0) throw new Error(`margin.${key}: expected a non-negative finite number`);
  }
  if (!/^[A-Z]{3}$/.test(data.currency)) throw new Error('margin.currency: use a three-letter currency code');
  if (data.salePrice <= 0 || data.channelFeeRate > 1) throw new Error('margin: salePrice must be positive and channelFeeRate between 0 and 1');
  const fee = data.salePrice * data.channelFeeRate;
  const cost = data.purchaseCost + data.freight + data.duty + data.otherCost + fee;
  if (!Number.isFinite(cost)) throw new Error('margin: calculated cost exceeds numeric range');
  return { fee, cost, contribution: data.salePrice - cost, contributionRate: (data.salePrice - cost) / data.salePrice };
}
