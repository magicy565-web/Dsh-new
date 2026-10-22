/**
 * Build a clearly-labelled DTC demo project and copy its dashboard and product
 * sheet into examples/. Run with the Harness Electron-as-node runtime.
 */
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  activateMandate,
  addEvidence,
  attemptAdvance,
  createProject,
  evaluateGate,
  setDtcSection,
  setEconomics,
  setFacts,
  setMarkets,
  writeArtifacts,
} from '../workflow.js'

const here = dirname(fileURLToPath(import.meta.url))
const examples = join(dirname(here), 'examples')
const workspace = await mkdtemp(join(tmpdir(), 'sourcing-dtc-demo-'))

const doc = createProject({
  mode: 'dtc',
  title: '示例：SlowBowl 宠物慢食碗',
  goal: '14 天上线，30 天内跑出 50 单并把 CAC 压到 8 美元以内',
  targetMarkets: ['US'],
  currency: 'USD',
  slug: 'demo-slowbowl',
  workspaceDir: workspace,
})

setFacts(doc, [
  { key: 'budget', value: '30000', unit: 'USD', basis: 'confirmed' },
  { key: 'targetMarket', value: 'US', basis: 'confirmed' },
  { key: 'category', value: '宠物用品 / 慢食碗', basis: 'confirmed' },
])

addEvidence(doc, [
  { url: 'https://example-trends.com/pet-slow-feeder', title: '慢食碗搜索趋势（示例）', claim: '过去 24 个月“slow feeder”搜索量年增 18%，美国占比最高。', grade: 'B', publisher: 'Google Trends', accessedAt: '2026-10-01' },
  { url: 'https://example-amazon.com/bestsellers/slow-feeder', title: '亚马逊慢食碗畅销榜（示例）', claim: '前 20 名平均售价 26 美元，评论集中在“难清洗”和“太小”。', grade: 'C', accessedAt: '2026-10-01' },
  { url: 'https://example-pet-association.org/market', title: '美国宠物用品市场报告（示例）', claim: '美国宠物用品线上渗透率 38%，慢食类目年规模约 2.1 亿美元。', grade: 'A', publisher: 'American Pet Products Association', accessedAt: '2026-10-01' },
  { url: 'https://example-retailer.com/slow-feeder-prices', title: '慢食碗零售价格带（示例）', claim: '主流零售价集中在 24-32 美元，可拆洗款溢价约 15%。', grade: 'B', publisher: 'Pet Business Magazine', accessedAt: '2026-10-01' },
])

setMarkets(doc, [
  { name: '美国', country: 'US', scores: { demand: 5, competition: 3, compliance: 5, logistics: 4, payment: 5, access: 5 }, evidenceIds: [doc.evidence[0].id, doc.evidence[2].id] },
  { name: '加拿大', country: 'CA', scores: { demand: 3, competition: 4, compliance: 3, logistics: 5, payment: 4, access: 4 }, evidenceIds: [doc.evidence[0].id] },
  { name: '英国', country: 'UK', scores: { demand: 4, competition: 3, compliance: 4, logistics: 4, payment: 4, access: 4 }, evidenceIds: [doc.evidence[2].id] },
])
doc.recommendation = { marketId: doc.markets[0].id, rationale: '美国需求规模与支付基础设施最好，宠物内容生态成熟，先用单一市场验证投放模型再扩。', at: doc.updatedAt }
await writeArtifacts(doc, { kinds: ['market'] })
attemptAdvance(doc)

setDtcSection(doc, 'direction', {
  candidates: [
    { name: '慢食碗', audience: '忙碌的宠物主人', problem: '狗吃太快导致呕吐与胀气', priceBand: '$25-35', evidenceIds: [doc.evidence[0].id, doc.evidence[2].id] },
    { name: '旅行水杯', audience: '带狗出行的人', problem: '户外饮水不方便', priceBand: '$18-28', evidenceIds: [doc.evidence[1].id] },
    { name: '益智喂食垫', audience: '长时间在家的狗', problem: '无聊拆家', priceBand: '$20-30', evidenceIds: [doc.evidence[3].id] },
  ],
  chosen: { name: '慢食碗', rationale: '需求明确、差评集中在可清洗与尺寸，正好是产品差异点；供应链在宁波成熟，首单风险低。' },
})
setDtcSection(doc, 'product', {
  name: 'SlowBowl 迷宫慢食碗',
  spec: '食品级 PP 材质，直径 22cm，容量 400ml，碗内 12 道迷宫凸筋，可整体拆洗，底部防滑硅胶圈，适配中小型犬。',
  packaging: '牛皮纸盒 + 可降解内衬，盒内附使用说明、30 天退换卡与一张训练小卡。',
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
setDtcSection(doc, 'samples', {
  items: [{ sku: 'SB-66', status: 'received', receivedAt: '2026-10-10', feedback: '迷宫深度合适，边缘需要倒圆，防滑圈粘合牢固。', issues: ['边缘毛刺'] }],
})
setDtcSection(doc, 'qc', {
  items: [
    { item: '外形尺寸', method: '卡尺抽检 5 件', standard: '直径 22±0.3cm' },
    { item: '容量', method: '注水称重', standard: '400ml ±5%' },
    { item: '材质', method: '供应商报告 + 抽检', standard: '食品级 PP，附 FDA 报告' },
    { item: '边缘毛刺', method: '目测 + 手触', standard: '无刮手感' },
    { item: '防滑圈粘合', method: '拉力测试', standard: '≥5N 不脱落' },
    { item: '迷宫凸筋', method: '目测 + 卡尺', standard: '12 道，高 8mm' },
    { item: '颜色色差', method: '封样对比', standard: 'ΔE ≤ 2' },
    { item: '清洗测试', method: '洗碗机 3 次', standard: '不变形、不褪色' },
    { item: '包装跌落', method: '1.2m 六面跌落', standard: '产品无破损' },
    { item: '条码与标签', method: '扫码核对', standard: '与 SKU 一致，含成分与警示' },
  ],
})
await writeArtifacts(doc, { kinds: ['product', 'suppliers'] })
attemptAdvance(doc)

setEconomics(doc, {
  inputs: { price: 29.9, cogs: 4.2, freightPerUnit: 0.8, dutyRate: 0.075, platformFeeRate: 0.029, paymentFeeRate: 0.029, fulfillmentPerUnit: 3.5, returnsRate: 0.04, adCost: 8 },
})
await writeArtifacts(doc, { kinds: ['economics', 'unitEconomics'] })
attemptAdvance(doc)

setDtcSection(doc, 'store', {
  domain: 'slowbowl.example',
  platform: 'Shopify',
  pages: ['home', 'product', 'about', 'faq', 'contact'].map((key) => ({ key, done: true })),
  policies: ['shipping', 'returns', 'privacy', 'terms'].map((key) => ({ key, done: true })),
  payments: ['stripe', 'paypal'],
  shippingRates: [{ zone: 'US', method: 'standard', price: 5, days: 4 }],
  pixelEvents: [{ event: 'Purchase', verified: true }, { event: 'AddToCart', verified: true }],
  emailCapture: true,
})
await writeArtifacts(doc, { kinds: ['store'] })
attemptAdvance(doc)

setDtcSection(doc, 'launch', {
  creatives: ['pain', 'comparison', 'story'].flatMap((angle) =>
    ['3 秒钩子 A', '3 秒钩子 B', '3 秒钩子 C'].map((hook) => ({ angle, hook: `${angle} · ${hook}`, format: 'UGC 15s' })),
  ),
  campaigns: [{ platform: 'meta', name: 'US prospecting', budgetDaily: 50, adSets: 3, killRules: '花费超过两倍客单价仍无加购就关素材，ROAS 连续三天低于盈亏平衡 30% 关 ad set。' }],
  trackingVerified: true,
})
await writeArtifacts(doc, { kinds: ['launch'] })
attemptAdvance(doc)

setDtcSection(doc, 'ops', {
  threePl: { name: 'US 3PL', slaAccuracy: 98, slaOnTime: 97, cutoff: '14:00 PT', returnsAddress: '1200 Warehouse Ave, Los Angeles, CA' },
  skuChecked: true,
  testOrder: { at: '2026-10-12', result: 'passed' },
  csTemplates: ['发货查询', '退换处理', '尺寸咨询'],
  shippingPromiseHours: 48,
})
await writeArtifacts(doc, { kinds: ['ops'] })
attemptAdvance(doc)

setDtcSection(doc, 'growth', {
  flows: ['welcome', 'abandoned', 'post_purchase', 'winback'].map((key) => ({ key, done: true })),
  reviews: '发货后 7 天邀评，晒图返 5 美元券；差评 24 小时内私信处理。',
  loyalty: '满 60 美元包邮 + 复购 9 折 + 订阅装每 8 周配送。',
  kols: Array.from({ length: 10 }, (_, index) => ({ name: `PetKOL ${index + 1}`, platform: 'tiktok', followers: 20000 + index * 1500, status: 'contacted' })),
})
await writeArtifacts(doc, { kinds: ['growth'] })
attemptAdvance(doc)

setDtcSection(doc, 'review', {
  metrics: { cvr: 0.021, aov: 32.4, cac: 8.6, roas: 3.6, refundRate: 0.028, inventoryTurnover: 6.2 },
  reorderPoint: 320,
  safetyStock: 110,
  nextPlan: '下一轮补 3 条 UGC 素材，预算从 50 提到 80，测试订阅装与第二个颜色。',
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
await writeArtifacts(doc, { kinds: ['review'] })
const done = attemptAdvance(doc)

activateMandate(doc, {
  objective: '上线后 90 天把 SlowBowl 做成稳定出单与复购的美国 DTC 品牌，月销 2 万美元',
  successCriteria: ['连续 4 周 ROAS ≥ 3.5', '复购率 ≥ 15%', 'CAC ≤ 8 美元'],
  scheduleId: 'sched_demo_weekly',
  reviewCadenceDays: 7,
  horizonDays: 90,
  authority: { research: true, drafts: true, outreach: 'approval', spendLimit: 500, currency: 'USD' },
})
await writeArtifacts(doc)

const dir = join(workspace, 'sourcing', 'demo-slowbowl')
await mkdir(examples, { recursive: true })
await copyFile(join(dir, 'dashboard.html'), join(examples, 'dashboard-dtc-demo.html'))
await copyFile(join(dir, '02-product.md'), join(examples, 'product-demo.md'))
await copyFile(join(dir, '09-mandate.md'), join(examples, 'mandate-demo.md'))
console.log('gate:', evaluateGate(doc, doc.stage).passed, 'stage:', done.stage, 'status:', doc.status)
console.log('written to', examples)
await rm(workspace, { recursive: true, force: true })
