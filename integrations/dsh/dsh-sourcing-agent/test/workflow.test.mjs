import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import {
  ProjectStore,
  activateMandate,
  addEvidence,
  addLeads,
  attemptAdvance,
  checkinMandate,
  computeEconomics,
  createProject,
  evaluateGate,
  mandateNextActions,
  mandateSummary,
  pauseMandate,
  resumeMandate,
  setBrand,
  setDtcSection,
  setEconomics,
  setFacts,
  setMarkets,
  setPolicyOverride,
  setSuppliers,
  skipStage,
  writeArtifacts,
} from '../workflow.js'
import { toolDefinitions } from '../tools.js'

const roots = []
const tempDir = (label) => {
  const dir = mkdtempSync(join(tmpdir(), `sourcing-${label}-`))
  roots.push(dir)
  return dir
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

const baseProject = (overrides = {}) =>
  createProject({
    mode: 'b2b',
    title: '收纳箱供货德国',
    goal: '90 天内拿到 3 个德国买家样品单',
    targetMarkets: ['DE'],
    workspaceDir: tempDir('project'),
    slug: 'storage-boxes-de',
    ...overrides,
  })

const evidence = (n, grade = 'A') => ({
  url: `https://example-${n}.de/report`,
  title: `德国收纳箱进口报告 ${n}`,
  claim: `2025 年德国收纳箱进口额增长 ${n}%，主要来自中国。`,
  grade,
  publisher: grade === 'A' ? 'Statistisches Bundesamt' : 'Handelsblatt',
  accessedAt: '2026-10-01',
})

const marketRow = (name, evidenceIds, total = 4) => ({
  name,
  country: name,
  scores: { demand: total, competition: total, compliance: total, logistics: total, payment: total, access: total },
  evidenceIds,
  notes: `${name} 候选`,
})

const leadRow = (n, { tier = 'A', verification = 'website' } = {}) => ({
  company: `Distributor ${n} GmbH`,
  website: `https://distributor-${n}.de`,
  sourceUrl: `https://www.kompass.com/company/${n}`,
  matchNote: `主营收纳用品，覆盖德国南部 400 家门店，与我们的产品线匹配。`,
  tier,
  verification,
})

function factsFor(doc) {
  return setFacts(doc, [
    { key: 'product', value: '折叠收纳箱', basis: 'confirmed' },
    { key: 'moq', value: '500', basis: 'confirmed' },
    { key: 'priceBasis', value: 'FOB Ningbo, USD', basis: 'confirmed' },
  ])
}

describe('project lifecycle', () => {
  test('create validates the intake inputs', () => {
    assert.throws(() => createProject({ mode: 'x', title: 'abc', goal: '0123456789' }), /mode/)
    assert.throws(() => createProject({ mode: 'b2b', title: 'abc', goal: 'short' }), /title|goal/)
    const doc = baseProject()
    assert.equal(doc.stage, 'intake')
    assert.equal(doc.status, 'active')
    assert.equal(doc.revision, 1)
    assert.match(doc.id, /^src_[a-z0-9]+$/u)
  })

  test('store persists, lists and guards revisions', async () => {
    const dir = tempDir('store')
    const store = new ProjectStore({ dir })
    const doc = await store.create({ mode: 'b2b', title: '测试项目', goal: '90 天内拿到十个买家回复', workspaceDir: tempDir('w'), slug: 'test-project' })
    const loaded = await store.load(doc.id)
    assert.equal(loaded.title, '测试项目')
    const first = await store.mutate(doc.id, (draft) => factsFor(draft))
    assert.equal(first.revision, 2)
    await assert.rejects(() => store.mutate(doc.id, (draft) => factsFor(draft), { expectedRevision: 1 }), /REVISION_CONFLICT|已被修改/u)
    const listed = await store.list({})
    assert.equal(listed.length, 1)
    assert.equal(listed[0].projectId, doc.id)
  })
})

describe('gates', () => {
  test('intake requires confirmed facts and a market decision', () => {
    const doc = baseProject()
    const before = evaluateGate(doc, 'intake')
    assert.equal(before.passed, false)
    assert.ok(before.blockers.some((entry) => entry.includes('事实')))

    factsFor(doc)
    assert.equal(evaluateGate(doc, 'intake').passed, true)

    doc.brief.targetMarkets = []
    assert.equal(evaluateGate(doc, 'intake').passed, false)
    doc.brief.marketDecision = 'agent'
    assert.equal(evaluateGate(doc, 'intake').passed, true)
  })

  test('advance is refused while a check fails and records the attempt', () => {
    const doc = baseProject()
    const result = attemptAdvance(doc)
    assert.equal(result.passed, false)
    assert.equal(doc.stage, 'intake')
    assert.equal(doc.gates.length, 1)
    assert.equal(doc.gates[0].passed, false)
  })

  test('market gate needs three scored candidates with A/B evidence', () => {
    const doc = baseProject()
    factsFor(doc)
    attemptAdvance(doc)
    addEvidence(doc, [evidence(1), evidence(2), evidence(3)])
    const ids = doc.evidence.map((row) => row.id)

    assert.throws(() => setMarkets(doc, [marketRow('DE', [ids[0]])]), /至少 3 个/u)
    const three = [marketRow('DE', [ids[0]]), marketRow('FR', [ids[1]]), marketRow('NL', [ids[2]])]
    setMarkets(doc, three)
    assert.equal(evaluateGate(doc, 'market').passed, false)
    doc.recommendation = { marketId: doc.markets[0].id, rationale: '德国进口规模最大，认证路径清晰，物流成本可控，且已有三条 A 级证据支撑。', at: doc.updatedAt }
    assert.equal(evaluateGate(doc, 'market').passed, true)

    doc.markets[1].evidenceIds = []
    assert.equal(evaluateGate(doc, 'market').passed, false)
  })

  test('evidence rejects malformed rows and dedupes', () => {
    const doc = baseProject()
    assert.throws(() => addEvidence(doc, [{ url: 'ftp://x', title: 'x', claim: '0123456789', grade: 'A', publisher: 'p' }]), /http/u)
    assert.throws(() => addEvidence(doc, [{ url: 'https://x.de', title: 'x', claim: 'short', grade: 'A', publisher: 'p' }]), /claim/u)
    assert.throws(() => addEvidence(doc, [{ url: 'https://x.de', title: 'x', claim: '0123456789', grade: 'A' }]), /publisher/u)
    const first = addEvidence(doc, [evidence(1)])
    assert.equal(first.added, 1)
    const second = addEvidence(doc, [evidence(1)])
    assert.equal(second.added, 0)
  })

  test('supply gate enforces volume, verification ratio and dedupe', () => {
    const doc = baseProject()
    factsFor(doc)
    attemptAdvance(doc)
    addEvidence(doc, [evidence(1), evidence(2), evidence(3)])
    const ids = doc.evidence.map((row) => row.id)
    setMarkets(doc, [marketRow('DE', [ids[0]]), marketRow('FR', [ids[1]]), marketRow('NL', [ids[2]])])
    doc.recommendation = { marketId: doc.markets[0].id, rationale: '德国进口规模最大，认证路径清晰，物流成本可控，且已有三条 A 级证据支撑。', at: doc.updatedAt }
    attemptAdvance(doc)
    assert.equal(doc.stage, 'supply')

    assert.equal(evaluateGate(doc, 'supply').passed, false)
    const rows = []
    for (let index = 0; index < 20; index += 1) {
      rows.push(leadRow(index, { tier: index < 10 ? 'A' : 'B', verification: index < 14 ? 'website' : 'third_party' }))
    }
    addLeads(doc, rows)
    assert.equal(evaluateGate(doc, 'supply').passed, true)

    assert.throws(() => addLeads(doc, [leadRow(0)]), /DUPLICATE_LEAD|域名已存在/u)
  })

  test('economics computes deterministic figures and enforces the margin floor', () => {
    const b2b = computeEconomics('b2b', { unitCost: 10, packaging: 1, inlandFreight: 0.5, portHandling: 0.5, fobPrice: 16 })
    assert.equal(b2b.computed.fobCost, 12)
    assert.equal(b2b.computed.grossProfit, 4)
    assert.equal(b2b.computed.grossMargin, 0.25)
    assert.equal(b2b.warnings.length, 0)

    const dtc = computeEconomics('dtc', {
      price: 100,
      cogs: 30,
      freightPerUnit: 5,
      dutyRate: 0.1,
      platformFeeRate: 0.03,
      paymentFeeRate: 0.029,
      fulfillmentPerUnit: 6,
      returnsRate: 0.03,
      adCost: 20,
    })
    assert.equal(dtc.computed.duty, 3.5)
    assert.equal(dtc.computed.landedCost, 38.5)
    assert.equal(dtc.computed.contributionBeforeAds, 46.6)
    assert.equal(dtc.computed.marginBeforeAds, 0.466)
    assert.equal(dtc.computed.breakevenRoas, 2.1459)
    assert.equal(dtc.computed.contributionAfterAds, 26.6)

    const doc = baseProject()
    factsFor(doc)
    attemptAdvance(doc)
    addEvidence(doc, [evidence(1), evidence(2), evidence(3)])
    const ids = doc.evidence.map((row) => row.id)
    setMarkets(doc, [marketRow('DE', [ids[0]]), marketRow('FR', [ids[1]]), marketRow('NL', [ids[2]])])
    doc.recommendation = { marketId: doc.markets[0].id, rationale: '德国进口规模最大，认证路径清晰，物流成本可控，且已有三条 A 级证据支撑。', at: doc.updatedAt }
    attemptAdvance(doc)
    addLeads(doc, Array.from({ length: 20 }, (_, index) => leadRow(index, { tier: index < 10 ? 'A' : 'B', verification: index < 14 ? 'website' : 'third_party' })))
    attemptAdvance(doc)
    assert.equal(doc.stage, 'economics')

    setEconomics(doc, { inputs: { unitCost: 10, packaging: 1, inlandFreight: 0.5, portHandling: 0.5, fobPrice: 10.5 } })
    assert.equal(evaluateGate(doc, 'economics').passed, false)
    setEconomics(doc, { inputs: { unitCost: 10, packaging: 1, inlandFreight: 0.5, portHandling: 0.5, fobPrice: 10.5 }, riskAccepted: true, riskNote: '首单用于打开渠道，接受低于常规门槛的毛利率。' })
    assert.equal(evaluateGate(doc, 'economics').passed, true)
  })

  test('dtc market gate requires budget, market fact and rendered report', async () => {
    const doc = createProject({ mode: 'dtc', title: '宠物慢食碗品牌', goal: '14 天上线并跑出第一笔订单', targetMarkets: ['US'], workspaceDir: tempDir('dtc'), slug: 'slowbowl' })
    assert.equal(doc.stage, 'market')
    assert.equal(evaluateGate(doc, 'market').passed, false)

    setFacts(doc, [
      { key: 'budget', value: '50000', unit: 'USD', basis: 'confirmed' },
      { key: 'targetMarket', value: 'US', basis: 'confirmed' },
    ])
    addEvidence(doc, [evidence(1), evidence(2), evidence(3)])
    const ids = doc.evidence.map((row) => row.id)
    setMarkets(doc, [marketRow('US', [ids[0]]), marketRow('CA', [ids[1]]), marketRow('UK', [ids[2]])])
    doc.recommendation = { marketId: doc.markets[0].id, rationale: '美国宠物用品线上渗透率最高，支付与物流基础设施成熟，适合独立站首站。', at: doc.updatedAt }
    assert.equal(evaluateGate(doc, 'market').passed, false)
    await writeArtifacts(doc, { kinds: ['market'] })
    assert.equal(evaluateGate(doc, 'market').passed, true)
  })
})

describe('dtc track', () => {
  const dtcProject = () =>
    createProject({ mode: 'dtc', title: '宠物慢食碗品牌', goal: '14 天上线并跑出第一笔订单', targetMarkets: ['US'], workspaceDir: tempDir('dtc-flow'), slug: 'slowbowl' })

  const passMarket = async (doc) => {
    setFacts(doc, [
      { key: 'budget', value: '50000', unit: 'USD', basis: 'confirmed' },
      { key: 'targetMarket', value: 'US', basis: 'confirmed' },
    ])
    addEvidence(doc, [evidence(1), evidence(2), evidence(3)])
    const ids = doc.evidence.map((row) => row.id)
    setMarkets(doc, [marketRow('US', [ids[0]]), marketRow('CA', [ids[1]]), marketRow('UK', [ids[2]])])
    doc.recommendation = { marketId: doc.markets[0].id, rationale: '美国宠物用品线上渗透率最高，支付与物流基础设施成熟，适合独立站首站。', at: doc.updatedAt }
    await writeArtifacts(doc, { kinds: ['market'] })
    return attemptAdvance(doc)
  }

  const fillProduct = (doc) => {
    setDtcSection(doc, 'direction', {
      candidates: [
        { name: '慢食碗', audience: '忙碌的宠物主人', problem: '宠物吃太快导致呕吐', priceBand: '$25-35' },
        { name: '旅行水杯', audience: '带狗出行的人', problem: '户外饮水不方便', priceBand: '$18-28' },
        { name: '益智喂食垫', audience: '长时间在家的狗', problem: '无聊拆家', priceBand: '$20-30' },
      ],
      chosen: { name: '慢食碗', rationale: '需求明确、内容传播性强、供应链在宁波成熟，先用单一英雄款验证。' },
    })
    setDtcSection(doc, 'product', {
      name: 'SlowBowl 迷宫慢食碗',
      spec: '食品级 PP 材质，直径 22cm，容量 400ml，碗内 12 道迷宫凸筋，可拆洗，适配中小型犬。',
      packaging: '牛皮纸盒 + 可降解内衬，盒内附使用说明与 30 天退换卡。',
      price: 29.9,
      warranty: '30 天无理由退换，1 年非人为损坏换新。',
      heroSku: 'SB-66',
      variants: ['薄荷绿', '奶油白'],
    })
    setDtcSection(doc, 'suppliers', {
      items: [
        { name: '宁波塑业', url: 'https://supplier-a.example', quote: '¥38/件 含税', basis: 'EXW', moq: 500, leadTimeDays: 25, sampleFee: '¥200', sampleLeadDays: 7 },
        { name: '东莞硅胶', url: 'https://supplier-b.example', quote: '$5.2/件', basis: 'FOB Shenzhen', moq: 300, leadTimeDays: 20, sampleLeadDays: 10 },
        { name: '义乌家居', url: 'https://supplier-c.example', quote: '¥41/件 含税', basis: 'EXW', moq: 1000, leadTimeDays: 30, sampleLeadDays: 5 },
      ],
    })
    setDtcSection(doc, 'samples', { items: [{ sku: 'SB-66', status: 'received', receivedAt: '2026-10-10', feedback: '迷宫深度合适，边缘需要倒圆。', issues: ['边缘毛刺'] }] })
    setDtcSection(doc, 'qc', {
      items: Array.from({ length: 10 }, (_, index) => ({ item: `检验项 ${index + 1}`, method: '目测 + 卡尺', standard: '按图纸与封样' })),
    })
  }

  test('eight gates take a dtc project from market to completed', async () => {
    const doc = dtcProject()
    assert.equal((await passMarket(doc)).stage, 'product')

    fillProduct(doc)
    assert.equal(evaluateGate(doc, 'product').passed, false)
    await writeArtifacts(doc, { kinds: ['product', 'suppliers'] })
    assert.equal(evaluateGate(doc, 'product').passed, true)
    assert.equal(attemptAdvance(doc).stage, 'economics')

    setEconomics(doc, {
      inputs: { price: 29.9, cogs: 4.2, freightPerUnit: 0.8, dutyRate: 0.075, platformFeeRate: 0.029, paymentFeeRate: 0.029, fulfillmentPerUnit: 3.5, returnsRate: 0.04, adCost: 8 },
    })
    assert.equal(evaluateGate(doc, 'economics').passed, false)
    await writeArtifacts(doc, { kinds: ['economics', 'unitEconomics'] })
    assert.equal(evaluateGate(doc, 'economics').passed, true)
    assert.equal(attemptAdvance(doc).stage, 'store')

    setDtcSection(doc, 'store', {
      domain: 'slowbowl.example',
      platform: 'Shopify',
      pages: ['home', 'product', 'about', 'faq', 'contact'].map((key) => ({ key, done: true })),
      policies: ['shipping', 'returns', 'privacy', 'terms'].map((key) => ({ key, done: true })),
      payments: ['stripe', 'paypal'],
      shippingRates: [{ zone: 'US', method: 'standard', price: 5, days: 4 }],
      pixelEvents: [{ event: 'Purchase', verified: true }],
      emailCapture: true,
    })
    await writeArtifacts(doc, { kinds: ['store'] })
    assert.equal(evaluateGate(doc, 'store').passed, true)
    assert.equal(attemptAdvance(doc).stage, 'launch')

    setDtcSection(doc, 'launch', {
      creatives: ['pain', 'comparison', 'story'].flatMap((angle) =>
        ['3 秒钩子 A', '3 秒钩子 B', '3 秒钩子 C'].map((hook) => ({ angle, hook: `${angle} · ${hook}`, format: 'UGC 15s' })),
      ),
      campaigns: [{ platform: 'meta', name: 'US prospecting', budgetDaily: 50, adSets: 3, killRules: '花费超过两倍客单价仍无加购就关素材，ROAS 连续三天低于盈亏平衡 30% 关 ad set。' }],
      trackingVerified: true,
    })
    await writeArtifacts(doc, { kinds: ['launch'] })
    assert.equal(evaluateGate(doc, 'launch').passed, true)
    assert.equal(attemptAdvance(doc).stage, 'ops')

    setDtcSection(doc, 'ops', {
      threePl: { name: 'US 3PL', slaAccuracy: 98, slaOnTime: 97, cutoff: '14:00 PT', returnsAddress: '1200 Warehouse Ave, Los Angeles, CA' },
      skuChecked: true,
      testOrder: { at: '2026-10-12', result: 'passed' },
      csTemplates: ['发货查询', '退换处理', '尺码咨询'],
      shippingPromiseHours: 48,
    })
    await writeArtifacts(doc, { kinds: ['ops'] })
    assert.equal(evaluateGate(doc, 'ops').passed, true)
    assert.equal(attemptAdvance(doc).stage, 'growth')

    setDtcSection(doc, 'growth', {
      flows: ['welcome', 'abandoned', 'post_purchase', 'winback'].map((key) => ({ key, done: true })),
      reviews: '发货后 7 天邀评，晒图返 5 美元券。',
      loyalty: '满 60 美元包邮 + 复购 9 折。',
      kols: Array.from({ length: 10 }, (_, index) => ({ name: `KOL ${index + 1}`, platform: 'tiktok', followers: 20000, status: 'contacted' })),
    })
    await writeArtifacts(doc, { kinds: ['growth'] })
    assert.equal(evaluateGate(doc, 'growth').passed, true)
    assert.equal(attemptAdvance(doc).stage, 'review')

    setDtcSection(doc, 'review', {
      metrics: { cvr: 0.02, aov: 32, cac: 9, roas: 3.5, refundRate: 0.03, inventoryTurnover: 6 },
      reorderPoint: 300,
      safetyStock: 100,
      nextPlan: '下一轮补 3 条 UGC 素材，预算从 50 提到 80，测试订阅装。',
    })
    doc.handoff = [
      { id: 'ho_1', category: 'entity', title: '注册美国主体', detail: '在 Delaware 注册 LLC，需要护照与地址证明，预计 2 周。', status: 'todo' },
      { id: 'ho_2', category: 'store', title: '绑定域名与邮箱', detail: '在 Namecheap 注册 .com，配置企业邮箱与 SPF/DKIM。', status: 'todo' },
      { id: 'ho_3', category: 'payment', title: '开通收款账户', detail: '开通 Stripe 与 PayPal 商业账户，提交 EIN 与银行账户。', status: 'todo' },
      { id: 'ho_4', category: 'compliance', title: '确认产品合规', detail: '确认 FDA 食品接触材料要求与加州 Prop 65 标签。', status: 'todo' },
      { id: 'ho_5', category: 'logistics', title: '签约 3PL', detail: '确认入库标准、退货地址与每单操作费，签署 SLA。', status: 'todo' },
      { id: 'ho_6', category: 'ads', title: '开通广告账户', detail: '开通 Meta 商务账户并绑定支付方式，验证 Purchase 事件。', status: 'todo' },
    ]
    doc.plan = { d30: '跑通首 50 单并压到 CAC 8 美元以内。', d60: '把复购率提到 15%，测试订阅装。', d90: '月销 2 万美元，确定第二款产品。' }
    assert.equal(evaluateGate(doc, 'review').passed, false)
    await writeArtifacts(doc, { kinds: ['review'] })
    const done = attemptAdvance(doc)
    assert.equal(done.passed, true)
    assert.equal(doc.stage, 'done')
    assert.equal(doc.status, 'completed')
  })

  test('product gate rejects missing samples and missing artifact', async () => {
    const doc = dtcProject()
    await passMarket(doc)
    fillProduct(doc)
    doc.dtc.samples = []
    assert.equal(evaluateGate(doc, 'product').passed, false)
    doc.dtc.samples = [{ id: 'smp_x', status: 'received' }]
    assert.equal(evaluateGate(doc, 'product').passed, false)
    await writeArtifacts(doc, { kinds: ['product', 'suppliers'] })
    assert.equal(evaluateGate(doc, 'product').passed, true)
  })

  test('ops gate rejects weak SLA and an unshipped test order', async () => {
    const doc = dtcProject()
    doc.stage = 'ops'
    setDtcSection(doc, 'ops', {
      threePl: { name: 'US 3PL', slaAccuracy: 90, slaOnTime: 80, cutoff: '14:00 PT', returnsAddress: '1200 Warehouse Ave, Los Angeles, CA' },
      skuChecked: true,
      testOrder: { at: '2026-10-12', result: 'pending' },
      csTemplates: ['发货查询'],
      shippingPromiseHours: 96,
    })
    const gate = evaluateGate(doc, 'ops')
    assert.equal(gate.passed, false)
    const failed = gate.checklist.filter((check) => !check.ok).map((check) => check.id)
    assert.ok(failed.includes('sla'))
    assert.ok(failed.includes('testOrder'))
    assert.ok(failed.includes('shipping'))
    assert.ok(failed.includes('artifact'))
  })
})

describe('policy', () => {
  const policyProject = () =>
    createProject({ mode: 'dtc', title: '政策测试项目', goal: '14 天内上线并跑出第一单', targetMarkets: ['US'], workspaceDir: tempDir('policy'), slug: 'policy-test' })

  test('project snapshots the policy pack', () => {
    const doc = policyProject()
    assert.equal(doc.policy.id, 'dtc-default')
    assert.equal(doc.policy.version, 2)
    assert.equal(doc.policy.thresholds.suppliers, 3)
    assert.deepEqual(doc.policyOverrides, {})
    assert.deepEqual(doc.policySkips, {})
  })

  test('override changes one threshold, is audit-logged, and needs a reason', () => {
    const doc = policyProject()
    doc.stage = 'product'
    assert.throws(() => setPolicyOverride(doc, 'suppliers', 4, 'short'), /理由/u)
    setPolicyOverride(doc, 'suppliers', 4, '买家要求至少四家比价，本次按四家执行。')
    assert.equal(doc.policyOverrides.suppliers, 4)
    assert.equal(doc.policyOverrideLog.at(-1).key, 'suppliers')
    assert.equal(doc.policyOverrideLog.at(-1).from, 3)
    setDtcSection(doc, 'suppliers', {
      items: [1, 2, 3].map((index) => ({ name: `S${index}`, url: `https://s${index}.example`, quote: '$1', basis: 'FOB', moq: 100, leadTimeDays: 10 })),
    })
    const suppliers = evaluateGate(doc, 'product').checklist.find((check) => check.id === 'suppliers')
    assert.equal(suppliers.ok, false)
    assert.match(suppliers.detail, /3\/4/u)
  })

  test('skipping a stage jumps it on advance', async () => {
    const doc = policyProject()
    doc.stage = 'launch'
    assert.throws(() => skipStage(doc, 'launch', '不能跳过当前阶段。'), /当前阶段/u)
    skipStage(doc, 'ops', '数字产品没有实物履约，跳过 3PL。')
    setDtcSection(doc, 'launch', {
      creatives: Array.from({ length: 9 }, (_, index) => ({ angle: 'pain', hook: `UGC 钩子 ${index + 1}`, format: 'UGC' })),
      campaigns: [{ platform: 'meta', name: 'US', budgetDaily: 50, adSets: 3, killRules: '花费超过两倍客单价仍无加购就关素材，ROAS 连续三天低于盈亏平衡 30% 关 ad set。' }],
      trackingVerified: true,
    })
    await writeArtifacts(doc, { kinds: ['launch'] })
    const result = attemptAdvance(doc)
    assert.equal(result.passed, true)
    assert.equal(doc.stage, 'growth')
    assert.equal(result.gate.stage, 'launch')
  })
})

describe('mandate', () => {
  const mandateProject = () =>
    createProject({ mode: 'dtc', title: '长期委托测试', goal: '90 天内做到首单并稳定复购', targetMarkets: ['US'], workspaceDir: tempDir('mandate'), slug: 'mandate-test' })

  const activate = (doc, overrides = {}) =>
    activateMandate(doc, {
      objective: '把 SlowBowl 做成稳定出单的美国 DTC 品牌，覆盖选品到尾程复盘',
      successCriteria: ['首月 50 单', 'CAC 低于 8 美元'],
      scheduleId: 'schedule_abc123',
      nextReviewAt: '2026-10-01',
      ...overrides,
    })

  test('activate validates criteria and schedule, and snapshots authority', () => {
    const doc = mandateProject()
    assert.throws(() => activate(doc, { successCriteria: [] }), /成功标准/u)
    assert.throws(() => activate(doc, { scheduleId: '' }), /scheduleId/u)
    const mandate = activate(doc)
    assert.equal(mandate.status, 'active')
    assert.equal(mandate.reviewCadenceDays, 7)
    assert.equal(mandate.authority.outreach, 'approval')
    assert.equal(mandate.authority.research, true)
    assert.equal(mandateSummary(doc).criteriaTotal, 2)
  })

  test('next actions surface gate blockers and a due review', () => {
    const doc = mandateProject()
    activate(doc)
    const actions = mandateNextActions(doc, '2026-10-22T00:00:00.000Z')
    assert.ok(actions.some((action) => action.kind === 'gate'))
    assert.ok(actions.some((action) => action.kind === 'review'))
  })

  test('checkin logs runs and completes when every criterion is met', () => {
    const doc = mandateProject()
    activate(doc)
    checkinMandate(doc, { summary: '完成市场研究与三条证据录入', actions: ['录证据'], criteriaMet: [1] })
    assert.equal(doc.mandate.runs.length, 1)
    assert.equal(doc.mandate.status, 'active')
    assert.equal(doc.mandate.nextReviewAt, new Date(new Date(doc.updatedAt).getTime() + 7 * 86_400_000).toISOString().slice(0, 10))
    checkinMandate(doc, { summary: '完成产品比价与样品确认', actions: [], criteriaMet: [2] })
    assert.equal(doc.mandate.status, 'completed')
    assert.deepEqual(doc.mandate.criteriaMet, [1, 2])
  })

  test('pause and resume swap the schedule binding', () => {
    const doc = mandateProject()
    activate(doc)
    const paused = pauseMandate(doc, '等待买家确认预算')
    assert.equal(paused.scheduleId, 'schedule_abc123')
    assert.equal(doc.mandate.status, 'paused')
    assert.throws(() => checkinMandate(doc, { summary: '暂停期间不应该 checkin' }), /不能 checkin/u)
    resumeMandate(doc, 'schedule_new456')
    assert.equal(doc.mandate.status, 'active')
    assert.equal(doc.mandate.scheduleId, 'schedule_new456')
  })
})

describe('artifacts', () => {
  test('render writes every artifact and records hashes', async () => {
    const doc = baseProject()
    factsFor(doc)
    attemptAdvance(doc)
    addEvidence(doc, [evidence(1), evidence(2), evidence(3)])
    const ids = doc.evidence.map((row) => row.id)
    setMarkets(doc, [marketRow('DE', [ids[0]]), marketRow('FR', [ids[1]]), marketRow('NL', [ids[2]])])
    doc.recommendation = { marketId: doc.markets[0].id, rationale: '德国进口规模最大，认证路径清晰，物流成本可控，且已有三条 A 级证据支撑。', at: doc.updatedAt }

    const result = await writeArtifacts(doc, { markdown: { market: '## 结论\n\n先做德国。' } })
    assert.ok(result.written.length >= 9)
    const dir = result.dir
    for (const name of ['00-brief.md', '01-market.md', '02-buyers.csv', '03-economics.md', '03-unit-economics.csv', '04-outreach.md', 'handoff.md', 'dashboard.html', 'data.json']) {
      assert.ok(existsSync(join(dir, name)), `${name} missing`)
    }
    const dash = readFileSync(join(dir, 'dashboard.html'), 'utf8')
    assert.match(dash, /市场选择/u)
    assert.match(dash, /当前阶段闸门/u)
    const market = readFileSync(join(dir, '01-market.md'), 'utf8')
    assert.match(market, /先做德国/u)
    assert.match(market, /Statistisches Bundesamt/u)
    const buyers = readFileSync(join(dir, '02-buyers.csv'), 'utf8')
    assert.match(buyers, /公司,国家,细分/u)
    assert.equal(JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')).id, doc.id)
    assert.ok(doc.assets.every((asset) => /^[a-f0-9]{64}$/u.test(asset.sha256)))
    // A full render includes data.json; it must not skew the assets gate ratio.
    assert.equal(evaluateGate(doc, 'assets').passed, true)
  })

  test('assets gate requires the mode-specific artifacts on disk', async () => {
    const doc = baseProject()
    factsFor(doc)
    attemptAdvance(doc)
    addEvidence(doc, [evidence(1), evidence(2), evidence(3)])
    const ids = doc.evidence.map((row) => row.id)
    setMarkets(doc, [marketRow('DE', [ids[0]]), marketRow('FR', [ids[1]]), marketRow('NL', [ids[2]])])
    doc.recommendation = { marketId: doc.markets[0].id, rationale: '德国进口规模最大，认证路径清晰，物流成本可控，且已有三条 A 级证据支撑。', at: doc.updatedAt }
    attemptAdvance(doc)
    addLeads(doc, Array.from({ length: 20 }, (_, index) => leadRow(index, { tier: index < 10 ? 'A' : 'B', verification: index < 14 ? 'website' : 'third_party' })))
    attemptAdvance(doc)
    setEconomics(doc, { inputs: { unitCost: 10, packaging: 1, inlandFreight: 0.5, portHandling: 0.5, fobPrice: 16 } })
    attemptAdvance(doc)
    assert.equal(doc.stage, 'assets')

    assert.equal(evaluateGate(doc, 'assets').passed, false)
    await writeArtifacts(doc, { kinds: ['economics', 'buyers', 'outreach'] })
    assert.equal(evaluateGate(doc, 'assets').passed, true)
  })
})

describe('completion', () => {
  test('handoff gate completes the project', async () => {
    const doc = baseProject()
    factsFor(doc)
    attemptAdvance(doc)
    addEvidence(doc, [evidence(1), evidence(2), evidence(3)])
    const ids = doc.evidence.map((row) => row.id)
    setMarkets(doc, [marketRow('DE', [ids[0]]), marketRow('FR', [ids[1]]), marketRow('NL', [ids[2]])])
    doc.recommendation = { marketId: doc.markets[0].id, rationale: '德国进口规模最大，认证路径清晰，物流成本可控，且已有三条 A 级证据支撑。', at: doc.updatedAt }
    attemptAdvance(doc)
    addLeads(doc, Array.from({ length: 20 }, (_, index) => leadRow(index, { tier: index < 10 ? 'A' : 'B', verification: index < 14 ? 'website' : 'third_party' })))
    attemptAdvance(doc)
    setEconomics(doc, { inputs: { unitCost: 10, packaging: 1, inlandFreight: 0.5, portHandling: 0.5, fobPrice: 16 } })
    attemptAdvance(doc)
    await writeArtifacts(doc, { kinds: ['economics', 'buyers', 'outreach'] })
    attemptAdvance(doc)
    assert.equal(doc.stage, 'handoff')

    doc.handoff = [
      { id: 'ho_1', category: 'entity', title: '注册德国公司主体', detail: '在德国工商会登记，需要护照、地址证明，预计 3 周，费用约 800 欧元。', status: 'todo' },
      { id: 'ho_2', category: 'store', title: '注册品牌域名与商店', detail: '在 Namecheap 注册 .de 与 .com，绑定 Shopify，需要营业执照与地址。', status: 'todo' },
      { id: 'ho_3', category: 'payment', title: '开通收款账户', detail: '开通 Stripe 德国账户，需要公司注册文件、法人证件与银行账户。', status: 'todo' },
      { id: 'ho_4', category: 'compliance', title: '办理 CE 与包装法注册', detail: '联系 TÜV 做 CE 检测，同时在 LUCID 注册包装，预计 4 周。', status: 'todo' },
      { id: 'ho_5', category: 'logistics', title: '签约海外仓', detail: '对比两家德国海外仓，确认入库标准、退货地址与每件操作费。', status: 'todo' },
      { id: 'ho_6', category: 'ads', title: '开通广告账户', detail: '开通 Meta 商务账户并绑定支付方式，安装像素并验证购买事件。', status: 'todo' },
    ]
    doc.plan = { d30: '完成主体、店铺与首批 20 个买家触达。', d60: '完成 3 个样品单与首轮报价。', d90: '拿到首个正式订单并复盘转化。' }
    const result = attemptAdvance(doc)
    assert.equal(result.passed, true)
    assert.equal(doc.stage, 'done')
    assert.equal(doc.status, 'completed')
  })
})

describe('tool layer', () => {
  test('model tools drive a project through every gate', async () => {
    const workspace = tempDir('tools-ws')
    const store = new ProjectStore({ dir: tempDir('tools-store') })
    const tools = new Map(toolDefinitions(store).map((tool) => [tool.name, tool]))
    const call = async (name, args) => tools.get(name).execute(args, {})
    const advance = async (projectId) => {
      const result = await call('sourcing_stage', { action: 'advance', projectId })
      assert.equal(result.advanced, true, `advance refused at ${result.stage}: ${JSON.stringify(result.gate.blockers)}`)
      return result
    }

    const created = await call('sourcing_project', {
      action: 'create',
      mode: 'b2b',
      title: '工具层集成项目',
      goal: '90 天内拿到三个德国样品单',
      targetMarkets: ['德国'],
      workspaceDir: workspace,
      slug: 'tools-flow',
    })
    const projectId = created.projectId
    assert.equal(created.gate.passed, false)

    await call('sourcing_facts', {
      action: 'set',
      projectId,
      facts: [
        { key: 'product', value: '折叠收纳箱', basis: 'confirmed' },
        { key: 'moq', value: '500', basis: 'confirmed' },
        { key: 'priceBasis', value: 'FOB Ningbo USD', basis: 'confirmed' },
      ],
    })
    await advance(projectId)

    const evidence = await call('sourcing_evidence', {
      action: 'add',
      projectId,
      items: [1, 2, 3].map((n) => ({
        url: `https://tool-${n}.example/report`,
        title: `来源 ${n}`,
        claim: `德国收纳品类进口数据第 ${n} 条，用于市场评分。`,
        grade: n === 3 ? 'B' : 'A',
        publisher: n === 3 ? 'Handelsblatt' : 'Statistisches Bundesamt',
        accessedAt: '2026-10-01',
      })),
    })
    assert.equal(evidence.added, 3)
    const listed = await call('sourcing_evidence', { action: 'list', projectId })
    const ids = listed.evidence.map((row) => row.id)
    await call('sourcing_markets', {
      action: 'set',
      projectId,
      markets: [
        { name: '德国', scores: { demand: 5, competition: 3, compliance: 4, logistics: 4, payment: 5, access: 5 }, evidenceIds: [ids[0]] },
        { name: '法国', scores: { demand: 4, competition: 3, compliance: 4, logistics: 3, payment: 4, access: 3 }, evidenceIds: [ids[1]] },
        { name: '荷兰', scores: { demand: 3, competition: 4, compliance: 4, logistics: 5, payment: 4, access: 4 }, evidenceIds: [ids[2]] },
      ],
    })
    await call('sourcing_markets', {
      action: 'recommend',
      projectId,
      recommendation: { marketId: 'MISSING', rationale: '这一条会被校验拒绝。' },
    }).then(
      () => assert.fail('a bad market id must be rejected'),
      (error) => assert.match(String(error), /不在候选里/u),
    )
    const markets = await call('sourcing_markets', { action: 'list', projectId })
    await call('sourcing_markets', {
      action: 'recommend',
      projectId,
      recommendation: { marketId: markets.markets[0].id, rationale: '德国进口规模最大、渠道成熟、物流成本可控，先用德国验证。' },
    })
    await advance(projectId)

    await call('sourcing_leads', {
      action: 'add',
      projectId,
      leads: Array.from({ length: 20 }, (_, index) => ({
        company: `Tool Buyer ${index + 1} GmbH`,
        website: `https://tool-buyer-${index + 1}.de`,
        sourceUrl: `https://www.kompass.com/tool/${index + 1}`,
        matchNote: '主营家居收纳，覆盖德国南部门店，与我们的产品线重合。',
        tier: index < 10 ? 'A' : 'B',
        verification: index < 14 ? 'website' : 'third_party',
      })),
    })
    await advance(projectId)

    const economics = await call('sourcing_economics', {
      action: 'set',
      projectId,
      inputs: { unitCost: 10, packaging: 1, inlandFreight: 0.5, portHandling: 0.5, fobPrice: 16 },
    })
    assert.equal(economics.economics.computed.grossMargin, 0.25)
    await advance(projectId)

    const rendered = await call('sourcing_render', { action: 'render', projectId })
    assert.ok(rendered.written.length >= 10)
    assert.ok(existsSync(join(workspace, 'sourcing', 'tools-flow', 'dashboard.html')))
    await advance(projectId)

    await call('sourcing_handoff', {
      action: 'set',
      projectId,
      items: [
        { category: 'entity', title: '确认出口主体', detail: '核对营业执照经营范围与外汇收款账户，确认 FOB 收汇流程。' },
        { category: 'store', title: '准备德语资料包', detail: '把规格、承重、洗涤说明与包装尺寸整理成德语 PDF。' },
        { category: 'payment', title: '确认贸易条款', detail: '与货代确认 FOB 宁波到汉堡的运价、保险与目的港费用。' },
        { category: 'compliance', title: '补齐 REACH 检测', detail: '联系检测机构做 REACH，并在 LUCID 注册包装后发货。' },
        { category: 'logistics', title: '确定样品寄送', detail: '整理十份样品收件地址，确认快递账号与关税承担。' },
        { category: 'support', title: '设定回复模板', detail: '准备报价、交期、样品三套模板，承诺 24 小时内响应。' },
      ],
    })
    await call('sourcing_handoff', {
      action: 'plan',
      projectId,
      plan: { d30: '完成认证与资料包，触达 30 家买家。', d60: '拿到 3 个样品单与 5 份报价。', d90: '完成首个正式订单并复盘。' },
    })
    const done = await advance(projectId)
    assert.equal(done.stage, 'done')
    assert.equal(done.status, 'completed')
  })

  test('sourcing_dtc stores dtc sections and rejects unknown ones', async () => {
    const store = new ProjectStore({ dir: tempDir('tools-dtc') })
    const tools = new Map(toolDefinitions(store).map((tool) => [tool.name, tool]))
    const call = (name, args) => tools.get(name).execute(args, {})
    const created = await call('sourcing_project', {
      action: 'create',
      mode: 'dtc',
      title: 'DTC 工具测试',
      goal: '14 天内上线并跑出第一单',
      targetMarkets: ['US'],
      workspaceDir: tempDir('tools-dtc-ws'),
      slug: 'dtc-tools',
    })
    assert.equal(created.stage, 'market')

    const saved = await call('sourcing_dtc', {
      action: 'set',
      projectId: created.projectId,
      section: 'direction',
      payload: { candidates: [{ name: '方向 A', audience: '人群', problem: '问题' }], chosen: null },
    })
    assert.equal(saved.value.candidates.length, 1)
    await assert.rejects(
      () => call('sourcing_dtc', { action: 'set', projectId: created.projectId, section: 'nope', payload: {} }),
      /未知 dtc 分区/u,
    )
    const read = await call('sourcing_project', { action: 'read', projectId: created.projectId, section: 'dtc' })
    assert.equal(read.dtc.direction.candidates.length, 1)
  })

  test('sourcing_policy overrides a threshold and exposes effective values', async () => {
    const store = new ProjectStore({ dir: tempDir('tools-policy') })
    const tools = new Map(toolDefinitions(store).map((tool) => [tool.name, tool]))
    const call = (name, args) => tools.get(name).execute(args, {})
    const created = await call('sourcing_project', {
      action: 'create',
      mode: 'dtc',
      title: '政策工具测试',
      goal: '14 天内上线并跑出第一单',
      targetMarkets: ['US'],
      workspaceDir: tempDir('tools-policy-ws'),
      slug: 'policy-tools',
    })
    const overridden = await call('sourcing_policy', {
      action: 'override',
      projectId: created.projectId,
      key: 'suppliers',
      value: 4,
      reason: '买家要求至少四家比价，本次按四家执行。',
    })
    assert.equal(overridden.effective.suppliers, 4)
    const read = await call('sourcing_policy', { action: 'read', projectId: created.projectId })
    assert.equal(read.overrides.suppliers, 4)
    assert.equal(read.overrideLog.length, 1)
    await assert.rejects(
      () => call('sourcing_policy', { action: 'override', projectId: created.projectId, key: 'suppliers', value: 2, reason: '短' }),
      /理由/u,
    )
  })
})
