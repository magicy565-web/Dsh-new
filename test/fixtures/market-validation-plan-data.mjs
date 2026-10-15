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

// Normalized synthetic external MCP result, not a native vendor schema or live data.
export function marketServicePlan(productId, revision = 1, days = 28) {
  const plan = marketPlan('b2c'), path = plan.paths[0];
  const from = '2026-06-01T00:00:00.000Z', to = new Date(Date.parse(from) + days * 86400000).toISOString();
  path.metrics = [{ id: 'net_paid_units', definition: 'Exact product/all-variants, execution-channel net paid units', dataSource: null, availability: 'unverified' }];
  path.marketReference = { id: 'pre-service-cups', sourcePlatform: 'tiktok', identifierKind: 'platform_product_id', unitsKind: 'estimated', salesUnit: 'units', channelId: 'tiktok_shop', region: 'US', leafCategory: 'Kitchen/Drinkware/Insulated-cups', useCase: 'Reusable insulated drinking cup', currency: 'USD',
    timeBasis: 'historical_estimated', salesCoverage: { from, to, days }, timeBasisSource: 'Synthetic past-period product units field and explicit coverage; not inferred from estimated.',
    salesScope: 'product_all_variants', salesDefinition: 'Synthetic provider estimated product unit sales; refund/payment definition is not equivalent to net paid execution units.',
    source: { provider: 'synthetic-external-mcp', tool: 'synthetic_comparable_products', schemaUrl: 'https://modelcontextprotocol.io/specification/2025-06-18/server/tools',
      evidenceRef: 'synthetic-mcp-response-reference', snapshotSha256: 'b'.repeat(64), observedAt: to },
    match: { factoryProductId: productId, factoryProductRevision: revision, priceLow: '15.00', priceHigh: '30.00', rationale: 'Original uploaded cup purpose and price match this proposed leaf category; classification remains a draft.' },
    history: { from, to, days }, selection: { method: 'search_sample', criteria: 'Comparable catalog search, not a viral ranking; keep zero-sale products eligible.', exclusions: ['Different region, use case, leaf category or price band'], zeroSales: 'included', populationCount: null, limitations: ['Synthetic non-probability sample of three products; no market population estimate.'] },
    products: [70, 100, 130].map((weekly, i) => ({ productId: 'synthetic-product-' + i, evidenceRef: 'synthetic-row-' + i, region: 'US', leafCategory: 'Kitchen/Drinkware/Insulated-cups',
      useCase: 'Reusable insulated drinking cup', price: '19.99', units: weekly * days / 7, availability: 'available', unitsKind: 'estimated', listingAgeDays: 180 })),
    seasonality: 'Historical period is not a forecast; seasonal transfer remains uncertain.', newProductDifferences: 'Uploaded product is a new offer; mature competitor traffic and reviews do not transfer.' };
  path.serviceTarget = { status: 'proposed', metric: 'net_paid_units', unit: 'net_paid_units_per_168h', referenceId: 'pre-service-cups', executionChannelId: 'shopify-execution',
    salesScope: 'product_all_variants', targetUnits: 50, adjustmentBasisPoints: 5000, productPrice: { amount: '19.99', currency: 'USD' }, supplyUnits: 200,
    supplyEvidenceRef: 'synthetic-user-supply-report', supplyVerification: 'reported_unverified', pricingRationale: 'Proposed price is inside the sample band.', budgetRationale: 'Proposed USD100 acquisition budget; no spend approved.',
    supplyRationale: 'User-reported 200 units covers this proposal, not verified inventory.', crossChannelRationale: 'TikTok demand is a reference for an adjusted Shopify target, not a same-channel comparison.',
    seasonalAdjustmentRationale: 'No seasonal uplift assumed.', newProductAdjustmentRationale: 'Propose 50% of the sample daily-rate reference for a new offer.', salesDefinitionDifference: 'Estimated market units inform a target measured as actual net paid execution units; user must review the difference.' };
  path.salesRequirement.target = 50; plan.budget = { status: 'proposed', currency: 'USD', totalCap: '100.00', lines: [{ id: 'acquisition-budget', category: 'acquisition', acquisitionId: path.acquisition[0].id, cap: '100.00', purpose: 'Unapproved acquisition proposal' }] };
  return plan;
}
