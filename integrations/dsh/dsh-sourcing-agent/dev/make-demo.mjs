/**
 * Build a clearly-labelled demo project and copy its dashboard and market
 * report into examples/. Run with the Harness Electron-as-node runtime:
 *
 *   $env:ELECTRON_RUN_AS_NODE="1"
 *   & "<DeepSeek Harness.exe>" --expose-internals dev/make-demo.mjs
 */
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addEvidence,
  addLeads,
  attemptAdvance,
  createProject,
  evaluateGate,
  setEconomics,
  setFacts,
  setMarkets,
  writeArtifacts,
} from '../workflow.js'

const here = dirname(fileURLToPath(import.meta.url))
const examples = join(dirname(here), 'examples')
const workspace = await mkdtemp(join(tmpdir(), 'sourcing-demo-'))

const doc = createProject({
  mode: 'b2b',
  title: '示例：折叠收纳箱 · 德国供货',
  goal: '90 天内拿到 3 个德国买家样品单，并在第 120 天前完成首单',
  targetMarkets: ['DE'],
  currency: 'USD',
  slug: 'demo-storage-de',
  workspaceDir: workspace,
})

setFacts(doc, [
  { key: 'product', value: '折叠布艺收纳箱（66L / 88L 两个尺寸）', basis: 'confirmed' },
  { key: 'moq', value: '500', unit: 'pcs', basis: 'confirmed' },
  { key: 'priceBasis', value: 'FOB Ningbo，USD，含中性包装', basis: 'confirmed' },
  { key: 'capacity', value: '每月 3 万件', basis: 'confirmed' },
  { key: 'certifications', value: '已有 CE，REACH 检测待补', basis: 'confirmed' },
])

attemptAdvance(doc)

addEvidence(doc, [
  {
    url: 'https://www.destatis.de/example-import-report',
    title: '德国 2025 年家居收纳用品进口统计（示例数据）',
    claim: '德国收纳用品进口额连续三年增长，中国是最大来源国。',
    grade: 'A',
    publisher: 'Statistisches Bundesamt',
    accessedAt: '2026-10-02',
  },
  {
    url: 'https://example-market.de/housewares-channel',
    title: '德国家居渠道结构（示例）',
    claim: '专业零售与折扣店合计占家居收纳线下渠道六成以上。',
    grade: 'B',
    publisher: 'Handelsverband Haushalt',
    accessedAt: '2026-10-02',
  },
  {
    url: 'https://example-access2markets.eu/storage-box',
    title: 'EU Access2Markets 关税查询（示例）',
    claim: '该品类进口关税约 3.7%，无配额限制。',
    grade: 'A',
    publisher: 'European Commission',
    accessedAt: '2026-10-02',
  },
  {
    url: 'https://example-amazon.de/bestsellers/storage',
    title: '德国站收纳类目畅销榜（示例）',
    claim: '前 20 名中 12 款为中国卖家或中国供应链品牌。',
    grade: 'C',
    accessedAt: '2026-10-02',
  },
])

const ids = doc.evidence.map((row) => row.id)
setMarkets(doc, [
  { name: '德国', country: 'DE', scores: { demand: 5, competition: 3, compliance: 4, logistics: 4, payment: 5, access: 4 }, evidenceIds: [ids[0], ids[1]] },
  { name: '法国', country: 'FR', scores: { demand: 4, competition: 3, compliance: 4, logistics: 3, payment: 4, access: 3 }, evidenceIds: [ids[2]] },
  { name: '荷兰', country: 'NL', scores: { demand: 3, competition: 4, compliance: 4, logistics: 5, payment: 4, access: 4 }, evidenceIds: [ids[1]] },
])
doc.recommendation = { marketId: doc.markets[0].id, rationale: '德国进口规模最大、专业零售渠道成熟、清关与物流成本可控，先用德国验证再辐射法语区。', at: doc.updatedAt }

attemptAdvance(doc)

const segments = ['importer', 'distributor', 'wholesaler', 'retailer', 'private-label']
addLeads(
  doc,
  Array.from({ length: 22 }, (_, index) => ({
    company: `Muster Haushalt ${index + 1} GmbH`,
    country: 'DE',
    segment: segments[index % segments.length],
    website: `https://muster-haushalt-${index + 1}.example`,
    contactName: index % 3 === 0 ? 'Anna Weber' : '',
    role: index % 3 === 0 ? 'Einkauf' : '',
    email: index % 4 === 0 ? `einkauf@muster-haushalt-${index + 1}.example` : '',
    sourceUrl: `https://www.kompass.com/de/company/muster-${index + 1}`,
    matchNote: '主营家居收纳与布艺用品，覆盖德国南部 300+ 门店，品类与我们的产品线重合。',
    importSignal: index % 2 === 0 ? '海关数据可见同类产品进口记录' : '',
    tier: index < 9 ? 'A' : index < 16 ? 'B' : 'C',
    verification: index < 10 ? 'website' : index < 16 ? 'third_party' : 'directory',
    status: index < 4 ? 'contacted' : 'new',
  })),
)

attemptAdvance(doc)
setEconomics(doc, { inputs: { unitCost: 11.2, packaging: 0.9, inlandFreight: 0.5, portHandling: 0.4, fobPrice: 16.5 } })
attemptAdvance(doc)

await writeArtifacts(doc, {
  markdown: {
    market:
      '## 结论\n\n先做德国：进口规模、渠道结构与物流成本三项同时占优；法国作为第二站，荷兰用于测试跨境小包。\n\n## 关键判断\n\n1. 德国专业零售与折扣店是主战场，不是电商。\n2. 认证是唯一硬门槛：REACH 与包装法注册必须在首单前完成。\n3. 价格带 16.5 美元 FOB 对 25% 毛利率成立，但海运费上涨 20% 会压到 18%。',
    outreach:
      '## 首封思路\n\n用「德国南部 300 家门店的收纳品类」开场，只问一个问题：是否需要 66L 样品。',
  },
})

attemptAdvance(doc)

doc.handoff = [
  { id: 'ho_1', category: 'entity', title: '确认出口主体与收款账户', detail: '核对营业执照经营范围与外汇收款账户，向银行确认 FOB 收汇与结汇流程。', status: 'todo' },
  { id: 'ho_2', category: 'compliance', title: '补齐 REACH 与包装法注册', detail: '联系检测机构做 REACH 检测；在德国 LUCID 注册包装并取得注册号后再发货。', status: 'todo' },
  { id: 'ho_3', category: 'store', title: '准备德语产品资料包', detail: '把 66L / 88L 的规格、承重、洗涤说明与包装尺寸整理成德语 PDF。', status: 'todo' },
  { id: 'ho_4', category: 'payment', title: '确认贸易条款与保险', detail: '与货代确认 FOB Ningbo 到汉堡的运价、保险与目的港费用分摊。', status: 'todo' },
  { id: 'ho_5', category: 'ads', title: '准备样品寄送清单', detail: '按 A 级线索整理 10 份样品收件地址，确认快递账号与关税承担方式。', status: 'todo' },
  { id: 'ho_6', category: 'support', title: '设定英文与德语回复模板', detail: '准备报价、交期、样品三套回复模板，承诺 24 小时内响应。', status: 'todo' },
]
doc.plan = {
  d30: '完成认证与资料包，触达 30 家 A/B 级买家，寄出 7 份样品。',
  d60: '拿到 3 个样品单与 5 份正式报价，确定德国独家分销候选。',
  d90: '完成首个正式订单并复盘报价成交率与回款周期。',
}
attemptAdvance(doc)
await writeArtifacts(doc)

const dir = join(workspace, 'sourcing', 'demo-storage-de')
await mkdir(examples, { recursive: true })
await copyFile(join(dir, 'dashboard.html'), join(examples, 'dashboard-demo.html'))
await copyFile(join(dir, '01-market.md'), join(examples, 'market-demo.md'))
console.log('gate:', evaluateGate(doc, doc.stage).passed, 'stage:', doc.stage, 'status:', doc.status, 'leads:', doc.leads.length)
console.log('written to', examples)
await rm(workspace, { recursive: true, force: true })
