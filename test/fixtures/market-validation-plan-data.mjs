export function marketPlan(mode = 'b2c') {
  const modes = mode === 'dual' ? ['b2b', 'b2c'] : [mode];
  const unknown = () => ({ status: 'unknown', detail: null });
  return { schemaVersion: 1, title: '合成测试产品验证草案', goal: '按实际证据判断是否继续，而非保证销量', mode,
    rationale: '根据合成用户目标提出，等待人工修订', productState: '已有原产品资料；库存等仍待确认',
    supply: { dropshipping: unknown(), oem: unknown(), odm: unknown() },
    paths: modes.map(kind => ({ mode: kind, buyer: kind === 'b2b' ? '合成目标进口商' : '合成目标消费者', targetMarket: '合成市场，需确认国家',
      offer: '仅评估方向，未报价或承诺供货', salesRequirement: { metric: kind === 'b2b' ? 'b2b_orders' : 'net_paid_units', target: null,
        definition: '人工确认口径；净支付扣退款，样品和询盘不计销量' },
      metrics: (kind === 'b2b' ? ['qualified_inquiries', 'quote_requests', 'sample_requests', 'b2b_orders'] : ['visits', 'add_to_cart', 'checkouts', 'net_paid_orders', 'net_paid_units', 'refunds'])
        .map(id => ({ id, definition: '合成待审核口径 ' + id, dataSource: null, availability: 'unverified' })),
      acquisition: [{ id: kind + '-source', channel: '待用户选择真实来源', kind: 'undecided', approach: '需原渠道授权后确定' }],
      steps: ['用户选择获客方式后再编辑具体行动'], successCriteria: ['结合样本和证据人工评估'], stopCriteria: ['资料或授权不足则暂停'] })),
    timeZone: 'Asia/Shanghai', budget: { status: 'undecided', currency: null, totalCap: null, lines: [] },
    commission: { status: 'undecided', payer: null, payee: null, basis: null, method: null, rateOrAmount: null,
      currency: null, settlement: null, refunds: null, cap: null, budgetLineId: null },
    questions: [{ topic: '销售要求', question: '您希望按哪种销量和目标值评估？', blocking: true }], assumptions: [] };
}
