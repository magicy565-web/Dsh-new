/**
 * Model-facing tools for the sourcing workflow. Mounted by the sourcing
 * preset, so these tools exist only for that agent; the durable store and
 * every gate live in `workflow.js`.
 */
import {
  ASSET_KINDS,
  GRADES,
  HANDOFF_CATEGORIES,
  LEAD_STATUSES,
  MODES,
  ProjectStore,
  SCORE_KEYS,
  STAGES,
  STAGE_LABELS,
  TIERS,
  VERIFICATIONS,
  WorkflowError,
  addEvidence,
  addLeads,
  attemptAdvance,
  evaluateGate,
  projectPathInfo,
  removeFact,
  resolveDataDir,
  sectionOf,
  setBrand,
  setDtcSection,
  setEconomics,
  setFacts,
  setMarkets,
  setSuppliers,
  updateLead,
  activateMandate,
  checkinMandate,
  clearPolicyOverride,
  mandateNextActions,
  mandateSummary,
  pauseMandate,
  resumeMandate,
  setPolicyOverride,
  skipStage,
  unskipStage,
  writeArtifacts,
} from './workflow.js'

export const inject = ['tools']

const OUTPUT = {
  schema: { type: 'object' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

const wrap = (error) => (error instanceof WorkflowError ? new Error(`${error.code}: ${error.message}`) : error)

const STAGE_GUIDE = {
  intake: '补齐事实：product / moq / priceBasis，然后 sourcing_stage advance。',
  market: '用 sourcing_evidence 录 A/B 级证据，用 sourcing_markets 录 3-6 个候选（六维评分）并给出推荐，然后 advance。',
  supply: '用 sourcing_leads 录 20 条以上线索（官网核实 ≥60%，A/B ≥8），然后 advance。',
  economics: '用 sourcing_economics 建模 FOB 成本与毛利率，然后 advance。',
  assets: '用 sourcing_render 生成 economics/buyers/outreach，然后 advance。',
  handoff: '用 sourcing_handoff 录 ≥6 项（≥4 类）并写 30/60/90，然后 advance 完成项目。',
  done: '项目已完成；如需追加工作，新建项目，或补证据后重新渲染。',
}

const DTC_GUIDE = {
  market: '用 sourcing_facts 确认 budget 与 targetMarket；用 sourcing_markets 录 3 个市场（六维评分 + 推荐）；render 生成 01-market.md 后 advance。',
  product: '用 sourcing_dtc 依次 set direction（≥3 个方向 + 选定理由）、product（名称/规格 ≥40 字/售价/包装）、suppliers（≥3 家，含 MOQ/交期/打样）、samples（≥1 个 received）、qc（≥10 项）；render 生成 02-product.md 与 02-suppliers.csv 后 advance。',
  economics: '用 sourcing_economics 录入 dtc 输入（售价/采购/头程/关税/平台费/支付费/履约/退货/广告），广告前毛利 ≥30%，render 03-economics.md 后 advance。',
  store: '用 sourcing_dtc set store：域名、平台、≥5 个页面、≥4 份政策、支付、运费、像素事件、邮件入口；render 04-store.md 后 advance。',
  launch: '用 sourcing_dtc set launch：≥9 条素材（3 角度 × 3 钩子）、≥1 个 campaign（日预算 + 止损规则 ≥20 字）、trackingVerified；render 05-launch.md 后 advance。',
  ops: '用 sourcing_dtc set ops：3PL 名称与 SLA（准确率/准时率 ≥95%）、截单、退货地址、SKU 核对、测试订单 passed、≥3 个客服模板、发货承诺 ≤72h；render 06-ops.md 后 advance。',
  growth: '用 sourcing_dtc set growth：四类流程（welcome/abandoned/post_purchase/winback）、评价、复购、≥10 个达人；render 07-growth.md 后 advance。',
  review: '用 sourcing_dtc set review：CVR/AOV/CAC/ROAS/退款率/库存周转、补货点、安全库存、下一轮计划；用 sourcing_handoff 录 ≥6 项；render 08-review.md 后 advance 完成。',
  done: '项目已完成；补数据后重新渲染，或新建项目。',
}

const SCORES_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    SCORE_KEYS.map((key) => [key, { type: 'integer', minimum: 1, maximum: 5, description: key === 'competition' ? '分数越高表示竞争越有利' : `1-5 分：${key}` }]),
  ),
  required: SCORE_KEYS,
  additionalProperties: false,
}

const LEAD_SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string', minLength: 2, maxLength: 160 },
    website: { type: 'string', description: '公司官网 http(s) 链接；域名用于去重。' },
    sourceUrl: { type: 'string', description: '你实际打开过的来源链接（目录页、名录、新闻、LinkedIn 等）。' },
    matchNote: { type: 'string', minLength: 10, maxLength: 500, description: '为什么匹配：主营、渠道、客户群，带具体事实。' },
    tier: { type: 'string', enum: TIERS },
    verification: { type: 'string', enum: VERIFICATIONS, description: 'website=已打开官网核实；third_party=第三方数据；directory=仅目录信息。' },
    country: { type: 'string', maxLength: 80 },
    segment: { type: 'string', maxLength: 80, description: 'importer / distributor / wholesaler / retailer / private-label / marketplace-seller。' },
    contactName: { type: 'string', maxLength: 120 },
    role: { type: 'string', maxLength: 120 },
    email: { type: 'string', maxLength: 200 },
    phone: { type: 'string', maxLength: 60 },
    importSignal: { type: 'string', maxLength: 300, description: '进口同类产品的证据，例如海关数据、品牌代理、平台在售。' },
    status: { type: 'string', enum: LEAD_STATUSES },
    nextStep: { type: 'string', maxLength: 300 },
  },
  required: ['company', 'website', 'sourceUrl', 'matchNote', 'tier', 'verification'],
  additionalProperties: false,
}

const EVIDENCE_SCHEMA = {
  type: 'object',
  properties: {
    url: { type: 'string', description: '实际打开过的 http(s) 链接。' },
    title: { type: 'string', minLength: 3, maxLength: 200 },
    claim: { type: 'string', minLength: 10, maxLength: 500, description: '这条来源支持的具体主张，一句话。' },
    grade: { type: 'string', enum: GRADES, description: 'A=官方/一手；B=协会/主流媒体；C=平台展示/卖家自述；D=论坛/二手。' },
    publisher: { type: 'string', maxLength: 120, description: 'A 级必填。' },
    accessedAt: { type: 'string', description: 'YYYY-MM-DD，默认今天。' },
    stage: { type: 'string', enum: STAGES.filter((stage) => stage !== 'done') },
    quote: { type: 'string', maxLength: 300, description: '原文短句，≤25 词。' },
    currency: { type: 'string', maxLength: 3 },
    unit: { type: 'string', maxLength: 40 },
  },
  required: ['url', 'title', 'claim', 'grade'],
  additionalProperties: false,
}

const HANDOFF_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: HANDOFF_CATEGORIES },
    title: { type: 'string', minLength: 4, maxLength: 160 },
    detail: { type: 'string', minLength: 12, maxLength: 1000, description: '在哪做、填什么、要什么材料、预计多久。' },
    status: { type: 'string', enum: ['todo', 'done'] },
  },
  required: ['category', 'title', 'detail'],
  additionalProperties: false,
}

function workspaceOf(exec) {
  try {
    const service = exec?.agent?.ctx?.get?.('workingDirectory')
    const dir = service?.get?.(exec.agent.session)
    if (typeof dir === 'string' && dir !== '') return dir
  } catch {
    // The project can set a workspace later.
  }
  return ''
}

function gateSummary(doc) {
  const gate = evaluateGate(doc, doc.stage)
  return { passed: gate.passed, blockers: gate.blockers.slice(0, 8) }
}

const nextOf = (doc) => (doc.mode === 'dtc' ? DTC_GUIDE[doc.stage] : STAGE_GUIDE[doc.stage]) ?? ''
const dirOf = (doc) => projectPathInfo(doc)

function mutate(store, projectId, expectedRevision, operation) {
  return store.mutate(projectId, async (doc) => operation(doc), { expectedRevision })
}

function created(project, extra = {}) {
  return {
    projectId: project.id,
    title: project.title,
    mode: project.mode,
    stage: project.stage,
    revision: project.revision,
    ...dirOf(project),
    gate: gateSummary(project),
    next: nextOf(project),
    ...extra,
  }
}

function normalizeRec(doc, recommendation) {
  if (recommendation === undefined || recommendation === null) throw new WorkflowError('INVALID_INPUT', 'recommend 需要 recommendation。')
  const marketId = String(recommendation.marketId ?? '').trim()
  if (!doc.markets.some((market) => market.id === marketId)) throw new WorkflowError('INVALID_INPUT', `推荐的市场 ${marketId} 不在候选里。`)
  const rationale = String(recommendation.rationale ?? '').trim()
  if (rationale.length < 24) throw new WorkflowError('INVALID_INPUT', 'recommendation.rationale 至少 24 个字符。')
  return { marketId, rationale, at: doc.updatedAt }
}

export function toolDefinitions(store) {
  return [
    {
      name: 'sourcing_project',
      description:
        'Create, list, read or update a sourcing project. A project is the durable record of one engagement: six gated stages (intake, market, supply, economics, assets, handoff), facts, evidence, leads or brand, economics and generated artifacts. Start every engagement with action=create, then read before writing to get the current revision and the gate blockers.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'read', 'update'] },
          projectId: { type: 'string', description: 'Required for read and update.' },
          section: {
            type: 'string',
            enum: ['overview', 'gate', 'facts', 'evidence', 'markets', 'leads', 'brand', 'dtc', 'policy', 'economics', 'assets', 'handoff', 'gates'],
            description: 'Read scope; default overview. Use leads/brand/economics/handoff for stage work.',
          },
          mode: { type: 'string', enum: MODES, description: 'b2b = supplier growth; dtc = own brand; hybrid = factory building its own brand.' },
          title: { type: 'string', minLength: 4, maxLength: 120 },
          goal: { type: 'string', minLength: 10, maxLength: 1000, description: 'A measurable success statement, e.g. 90 天内拿到 3 个德国买家样品单。' },
          currency: { type: 'string', description: 'Three-letter currency; default USD.' },
          targetMarkets: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 80 } },
          marketDecision: { type: 'string', enum: ['agent'], description: 'Set when the user asked you to choose the market; satisfies the intake gate without targetMarkets.' },
          workspaceDir: { type: 'string', description: 'Absolute directory where artifacts are written (sourcing/<slug>/). Defaults to the session working directory.' },
          slug: { type: 'string', description: 'Optional kebab-case directory name; default project-xxxxxx.' },
          policyId: { type: 'string', description: 'DTC policy pack id; default dtc-default. Policy thresholds and required artifacts are snapshotted into the project.' },
          notes: { type: 'string', maxLength: 2000 },
          expectedRevision: { type: 'integer', minimum: 1, description: 'Optional optimistic lock from the last read.' },
          status: { type: 'string', enum: ['active', 'completed', 'archived'], description: 'List filter.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async execute(args = {}, exec) {
        try {
          if (args.action === 'create') {
            const workspaceDir = args.workspaceDir ?? workspaceOf(exec)
            const project = await store.create({
              mode: args.mode,
              title: args.title,
              goal: args.goal,
              currency: args.currency,
              targetMarkets: args.targetMarkets,
              marketDecision: args.marketDecision,
              workspaceDir,
              slug: args.slug,
              policyId: args.policyId,
              notes: args.notes,
            })
            return created(project, workspaceDir === '' ? { warning: '没有工作区目录，产出物无法落盘；请用 action=update 设置 workspaceDir。' } : {})
          }
          if (args.action === 'list') return { projects: await store.list({ status: args.status ?? '', limit: args.limit ?? 50 }) }
          if (args.action === 'read') {
            if (!args.projectId) throw new WorkflowError('INVALID_INPUT', 'read 需要 projectId。')
            const doc = await store.load(args.projectId)
            return { projectId: doc.id, revision: doc.revision, stage: doc.stage, status: doc.status, ...sectionOf(doc, args.section ?? 'overview'), next: nextOf(doc) }
          }
          if (args.action === 'update') {
            if (!args.projectId) throw new WorkflowError('INVALID_INPUT', 'update 需要 projectId。')
            const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => {
              if (args.title !== undefined) doc.title = String(args.title).trim()
              if (args.goal !== undefined) doc.brief.goal = String(args.goal).trim()
              if (args.currency !== undefined) doc.brief.currency = String(args.currency).toUpperCase()
              if (args.targetMarkets !== undefined) doc.brief.targetMarkets = args.targetMarkets.map((entry) => String(entry).trim()).filter(Boolean)
              if (args.marketDecision !== undefined) doc.brief.marketDecision = args.marketDecision
              if (args.notes !== undefined) doc.brief.notes = String(args.notes).trim()
              if (args.workspaceDir !== undefined) doc.workspaceDir = String(args.workspaceDir).trim()
              doc.lastAction = 'project.update'
            })
            return created(outcome.project, { revision: outcome.revision })
          }
          throw new WorkflowError('INVALID_INPUT', 'action 必须是 create、list、read 或 update。')
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_facts',
      description:
        'Write the confirmed facts of the engagement (product, capacity, MOQ, price basis, certifications, budget). Facts carry a basis: `confirmed` for what the user or a source states, `assumed` for your own estimate. The intake gate requires the mode-specific keys confirmed; never mark an assumption confirmed.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'remove', 'list'] },
          projectId: { type: 'string' },
          facts: {
            type: 'array',
            maxItems: 40,
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'camelCase, e.g. product, moq, priceBasis, capacity, certifications, budget, targetMarket.' },
                value: { type: 'string', maxLength: 500 },
                unit: { type: 'string', maxLength: 40 },
                basis: { type: 'string', enum: ['confirmed', 'assumed'] },
                source: { type: 'string', description: 'Link when the fact came from a page.' },
                note: { type: 'string', maxLength: 500 },
              },
              required: ['key', 'value'],
              additionalProperties: false,
            },
          },
          key: { type: 'string', description: 'Required for remove.' },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'list') {
            const doc = await store.load(args.projectId)
            return { facts: doc.facts, gate: gateSummary(doc) }
          }
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => (args.action === 'remove' ? removeFact(doc, args.key) : setFacts(doc, args.facts)))
          return { projectId: outcome.project.id, revision: outcome.revision, ...outcome.result, gate: gateSummary(outcome.project) }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_evidence',
      description:
        'Record evidence you actually opened. Every market, price, competitor, buyer and regulation claim in the deliverables must trace to an evidence row with its URL, access date and grade. Duplicate URL+claim pairs are ignored. A grade requires a publisher; single-source numbers stay grade B/C and must be labelled 待交叉核验 in prose.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'list'] },
          projectId: { type: 'string' },
          items: { type: 'array', maxItems: 50, items: EVIDENCE_SCHEMA },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'list') {
            const doc = await store.load(args.projectId)
            return { evidence: doc.evidence, gate: gateSummary(doc) }
          }
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => addEvidence(doc, args.items))
          return { projectId: outcome.project.id, revision: outcome.revision, ...outcome.result, gate: gateSummary(outcome.project) }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_markets',
      description:
        'Score 3-6 candidate markets on six dimensions, link each to A/B evidence, and record the recommendation with a written rationale. Scores are 1-5 and higher is better, including the competition dimension. Setting markets replaces the previous list; the recommendation must name one of them.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'recommend', 'list'] },
          projectId: { type: 'string' },
          markets: {
            type: 'array',
            minItems: 3,
            maxItems: 8,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Keep an existing mkt_… id when updating that market.' },
                name: { type: 'string', maxLength: 80 },
                country: { type: 'string', maxLength: 80 },
                scores: SCORES_SCHEMA,
                notes: { type: 'string', maxLength: 1000 },
                evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } },
              },
              required: ['name', 'scores', 'evidenceIds'],
              additionalProperties: false,
            },
          },
          recommendation: {
            type: 'object',
            properties: {
              marketId: { type: 'string' },
              rationale: { type: 'string', minLength: 24, maxLength: 2000, description: '为什么是它、为什么不是其他候选，带证据编号。' },
            },
            required: ['marketId', 'rationale'],
            additionalProperties: false,
          },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'list') {
            const doc = await store.load(args.projectId)
            return { markets: doc.markets, recommendation: doc.recommendation, gate: gateSummary(doc) }
          }
          if (args.action === 'recommend') {
            const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => {
              doc.recommendation = normalizeRec(doc, args.recommendation)
              doc.lastAction = 'markets.recommend'
              return { recommendation: doc.recommendation }
            })
            return { projectId: outcome.project.id, revision: outcome.revision, ...outcome.result, gate: gateSummary(outcome.project) }
          }
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => setMarkets(doc, args.markets, args.recommendation))
          return { projectId: outcome.project.id, revision: outcome.revision, ...outcome.result, gate: gateSummary(outcome.project) }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_leads',
      description:
        'Maintain the B2B buyer and channel list. Adding validates every row, rejects a duplicate website domain, and enforces tier and verification enums. `website` is the company site used for de-duplication; `sourceUrl` is the page where you found the lead. The supply gate needs 20+ rows, 8+ A/B tiers, 60%+ verified beyond directory listings, and no duplicate domains.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'update', 'list'] },
          projectId: { type: 'string' },
          leads: { type: 'array', maxItems: 50, items: LEAD_SCHEMA },
          leadId: { type: 'string', description: 'Required for update.' },
          patch: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: LEAD_STATUSES },
              tier: { type: 'string', enum: TIERS },
              verification: { type: 'string', enum: VERIFICATIONS },
              email: { type: 'string', maxLength: 200 },
              contactName: { type: 'string', maxLength: 120 },
              role: { type: 'string', maxLength: 120 },
              phone: { type: 'string', maxLength: 60 },
              nextStep: { type: 'string', maxLength: 300 },
              importSignal: { type: 'string', maxLength: 300 },
              matchNote: { type: 'string', maxLength: 500 },
            },
            additionalProperties: false,
          },
          tier: { type: 'string', enum: TIERS, description: 'List filter.' },
          status: { type: 'string', enum: LEAD_STATUSES, description: 'List filter.' },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'list') {
            const doc = await store.load(args.projectId)
            const filtered = doc.leads.filter((lead) => (args.tier === undefined || lead.tier === args.tier) && (args.status === undefined || lead.status === args.status))
            const offset = args.offset ?? 0
            return { total: doc.leads.length, filtered: filtered.length, offset, leads: filtered.slice(offset, offset + (args.limit ?? 50)), gate: gateSummary(doc) }
          }
          if (args.action === 'update') {
            if (!args.leadId) throw new WorkflowError('INVALID_INPUT', 'update 需要 leadId。')
            const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => updateLead(doc, args.leadId, args.patch ?? {}))
            return { projectId: outcome.project.id, revision: outcome.revision, ...outcome.result, gate: gateSummary(outcome.project) }
          }
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => addLeads(doc, args.leads))
          return { projectId: outcome.project.id, revision: outcome.revision, ...outcome.result, gate: gateSummary(outcome.project) }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_brand',
      description:
        'DTC brand record: chosen name, positioning, voice, product, price and the naming checks, plus the supplier quotes behind the cost model. The supply gate needs a positioned brand, three checked name candidates, and three supplier quotes.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'suppliers', 'read'] },
          projectId: { type: 'string' },
          brand: {
            type: 'object',
            properties: {
              chosenName: { type: 'string', maxLength: 60 },
              positioning: { type: 'string', maxLength: 1000 },
              voice: { type: 'string', maxLength: 500 },
              palette: { type: 'string', maxLength: 200 },
              productName: { type: 'string', maxLength: 120 },
              productSpec: { type: 'string', maxLength: 2000 },
              price: { type: 'number', minimum: 0.01 },
              notes: { type: 'string', maxLength: 2000 },
              nameCandidates: {
                type: 'array',
                maxItems: 12,
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', maxLength: 60 },
                    note: { type: 'string', maxLength: 300 },
                    domainChecked: { type: 'boolean' },
                    socialChecked: { type: 'boolean' },
                    trademarkNote: { type: 'string', maxLength: 300 },
                  },
                  required: ['name'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
          suppliers: {
            type: 'array',
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', maxLength: 160 },
                url: { type: 'string' },
                product: { type: 'string', maxLength: 200 },
                quote: { type: 'string', maxLength: 120, description: '报价原文，例如 ¥38/件 含税。' },
                basis: { type: 'string', maxLength: 40, description: 'EXW / FOB / 含税 / 不含税。' },
                moq: { type: 'integer', minimum: 1 },
                leadTimeDays: { type: 'integer', minimum: 1, maximum: 3650 },
                evidenceId: { type: 'string' },
              },
              required: ['name', 'url', 'quote', 'basis', 'moq'],
              additionalProperties: false,
            },
          },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'read') {
            const doc = await store.load(args.projectId)
            return { brand: doc.brand, suppliers: doc.suppliers, gate: gateSummary(doc) }
          }
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) =>
            args.action === 'suppliers' ? setSuppliers(doc, args.suppliers) : setBrand(doc, args.brand ?? {}),
          )
          return { projectId: outcome.project.id, revision: outcome.revision, ...outcome.result, gate: gateSummary(outcome.project) }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_economics',
      description:
        'Store the unit economics and compute the decision metrics. B2B inputs: unitCost, packaging, inlandFreight, portHandling, fobPrice. DTC inputs: price, cogs, freightPerUnit, dutyRate, platformFeeRate, paymentFeeRate, fulfillmentPerUnit, returnsRate, adCost, optional targetMarginRate. Computed values (landed cost, margins, break-even and target ROAS) are derived by code, never by the model. Below-floor margins block the gate unless you record riskAccepted with a riskNote of 20+ characters.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'show'] },
          projectId: { type: 'string' },
          currency: { type: 'string', maxLength: 3 },
          inputs: { type: 'object', additionalProperties: true, description: 'Numbers in the project currency; see the tool description for the required keys.' },
          riskAccepted: { type: 'boolean' },
          riskNote: { type: 'string', maxLength: 1000, description: 'Why the below-floor margin is still acceptable.' },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'show') {
            const doc = await store.load(args.projectId)
            return { economics: doc.economics, gate: gateSummary(doc) }
          }
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) =>
            setEconomics(doc, { inputs: args.inputs, currency: args.currency, riskAccepted: args.riskAccepted, riskNote: args.riskNote }),
          )
          return { projectId: outcome.project.id, revision: outcome.revision, economics: outcome.result, gate: gateSummary(outcome.project) }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_dtc',
      description:
        'DTC track records for the eight gated stages. Section shapes: direction {candidates[], chosen{name,rationale}}; product {name,spec,packaging,price,warranty,heroSku,variants[]}; suppliers {items[]}; samples {items[]}; qc {items[]}; store {domain,platform,pages[],policies[],payments[],shippingRates[],pixelEvents[],emailCapture}; launch {creatives[],campaigns[],trackingVerified,startAt}; ops {threePl{},skuChecked,testOrder{},csTemplates[],shippingPromiseHours}; growth {flows[],reviews,loyalty,kols[]}; review {metrics{},reorderPoint,safetyStock,nextPlan}. `set` replaces that section; the stage gate checks the stored fields and the rendered artifact, so render before advancing.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'read'] },
          projectId: { type: 'string' },
          section: { type: 'string', enum: ['direction', 'product', 'suppliers', 'samples', 'qc', 'store', 'launch', 'ops', 'growth', 'review'] },
          payload: { type: 'object', additionalProperties: true, description: 'Section body; see the tool description for each section shape.' },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId', 'section'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'read') {
            const doc = await store.load(args.projectId)
            return { section: args.section, value: doc.dtc?.[args.section] ?? null, gate: gateSummary(doc) }
          }
          if (args.payload === undefined || args.payload === null) throw new WorkflowError('INVALID_INPUT', 'set 需要 payload。')
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => setDtcSection(doc, args.section, args.payload))
          return { projectId: outcome.project.id, revision: outcome.revision, ...outcome.result, gate: gateSummary(outcome.project) }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_mandate',
      description:
        'Turn a project into a long-term delegation. Activate with an objective, one to eight success criteria, a review cadence, a Horizon and the id of an existing schedule reminder that wakes this session; the Host restores a cold session when the reminder is due. On every wake read the mandate, execute nextActions, then `checkin` with what was done, blockers and any success criteria now met. `pause` stops the mandate and returns the schedule id to delete; `resume` needs a new schedule id. Authority records what may be done without asking: research, drafts, outreach (approval/allowed/never) and a spend limit.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['activate', 'read', 'checkin', 'pause', 'resume', 'list'] },
          projectId: { type: 'string' },
          objective: { type: 'string', minLength: 20, maxLength: 1000, description: 'Required for activate. What the delegation is for, in one paragraph.' },
          successCriteria: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 6, maxLength: 200 }, description: 'Required for activate. Each criterion must be checkable.' },
          scheduleId: { type: 'string', description: 'Required for activate and resume. The id returned by schedule_create.' },
          reviewCadenceDays: { type: 'integer', minimum: 1, maximum: 90, description: 'Review interval; default from the policy (7).' },
          horizonDays: { type: 'integer', minimum: 7, maximum: 3650, description: 'Delegation horizon; default from the policy (90).' },
          nextReviewAt: { type: 'string', description: 'YYYY-MM-DD; default now + reviewCadenceDays.' },
          authority: {
            type: 'object',
            properties: {
              research: { type: 'boolean' },
              drafts: { type: 'boolean' },
              outreach: { type: 'string', enum: ['approval', 'allowed', 'never'] },
              spendLimit: { type: ['number', 'null'], minimum: 0 },
              currency: { type: 'string', maxLength: 8 },
            },
            additionalProperties: false,
          },
          summary: { type: 'string', minLength: 10, maxLength: 1000, description: 'Required for checkin. What this run did.' },
          actions: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 300 }, description: 'checkin: concrete actions taken.' },
          blockers: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 300 }, description: 'checkin: what blocks progress.' },
          criteriaMet: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'checkin: 1-based indexes of success criteria now met.' },
          reason: { type: 'string', minLength: 6, maxLength: 500, description: 'Required for pause.' },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'list') {
            const projects = await store.list({ limit: 100 })
            return { mandates: projects.filter((project) => project.mandate !== null) }
          }
          if (!args.projectId) throw new WorkflowError('INVALID_INPUT', `${args.action} 需要 projectId。`)
          if (args.action === 'read') {
            const doc = await store.load(args.projectId)
            return {
              projectId: doc.id,
              revision: doc.revision,
              stage: doc.stage,
              mandate: doc.mandate,
              nextActions: mandateNextActions(doc),
              gate: gateSummary(doc),
            }
          }
          if (args.action !== 'activate' && args.action !== 'checkin' && args.action !== 'pause' && args.action !== 'resume') {
            throw new WorkflowError('INVALID_INPUT', 'action 必须是 activate、read、checkin、pause、resume 或 list。')
          }
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => {
            if (args.action === 'activate') return activateMandate(doc, args)
            if (args.action === 'checkin') return checkinMandate(doc, args)
            if (args.action === 'pause') return pauseMandate(doc, args.reason)
            return resumeMandate(doc, args.scheduleId)
          })
          const doc = outcome.project
          return {
            projectId: doc.id,
            revision: outcome.revision,
            ...outcome.result,
            nextActions: mandateNextActions(doc),
            gate: gateSummary(doc),
          }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_policy',
      description:
        'Read or adjust this project’s policy snapshot. Thresholds (suppliers, qcItems, marginFloor, creatives, slaAccuracy, kols, handoffItems, …), required artifacts and the stage list come from the policy pack; `override` changes one threshold for this project only and must record a reason, `skip` removes an optional stage that does not apply (for example ops for a digital product), `reset` restores one threshold. Every change is written to the project’s override log.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'override', 'reset', 'skip', 'unskip'] },
          projectId: { type: 'string' },
          key: { type: 'string', description: 'Threshold key from the policy, e.g. suppliers, qcItems, marginFloor. Required for override and reset.' },
          value: { type: 'number', minimum: 0, description: 'New threshold value. Required for override.' },
          reason: { type: 'string', minLength: 10, maxLength: 500, description: 'Why this project departs from the policy. Required for override and skip.' },
          stage: { type: 'string', description: 'Stage to skip or unskip. Required for skip and unskip.' },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'read') {
            const doc = await store.load(args.projectId)
            return { projectId: doc.id, revision: doc.revision, ...sectionOf(doc, 'policy') }
          }
          if (args.action === 'override' && !args.key) throw new WorkflowError('INVALID_INPUT', 'override 需要 key。')
          if (args.action === 'reset' && !args.key) throw new WorkflowError('INVALID_INPUT', 'reset 需要 key。')
          if ((args.action === 'skip' || args.action === 'unskip') && !args.stage) throw new WorkflowError('INVALID_INPUT', `${args.action} 需要 stage。`)
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => {
            if (args.action === 'override') return setPolicyOverride(doc, args.key, args.value, args.reason)
            if (args.action === 'reset') return clearPolicyOverride(doc, args.key)
            if (args.action === 'skip') return skipStage(doc, args.stage, args.reason)
            return unskipStage(doc, args.stage)
          })
          const doc = outcome.project
          return { projectId: doc.id, revision: outcome.revision, ...outcome.result, ...sectionOf(doc, 'policy'), gate: gateSummary(doc) }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_stage',
      description:
        'Read the current stage and its gate checklist, or attempt to advance. `advance` evaluates the gate from stored data and refuses to move while any check fails; the refusal lists every blocker. Passing records the gate and moves to the next stage; passing the handoff gate completes the project.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['status', 'advance'] },
          projectId: { type: 'string' },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'status') {
            const doc = await store.load(args.projectId)
            return { projectId: doc.id, stage: doc.stage, stageLabel: STAGE_LABELS[doc.stage], status: doc.status, gate: evaluateGate(doc, doc.stage), next: nextOf(doc) }
          }
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => attemptAdvance(doc))
          const doc = outcome.project
          return {
            projectId: doc.id,
            revision: outcome.revision,
            advanced: outcome.result.passed,
            stage: doc.stage,
            stageLabel: STAGE_LABELS[doc.stage],
            status: doc.status,
            gate: outcome.result.gate,
            next: nextOf(doc),
          }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_handoff',
      description:
        'Record the actions only the user can take (entity registration, store, payment, ads, certification, logistics, support) and the 30/60/90 plan. The final gate needs six items across four categories, each with executable detail, plus all three plan horizons.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'plan', 'complete', 'list'] },
          projectId: { type: 'string' },
          items: { type: 'array', maxItems: 40, items: HANDOFF_ITEM_SCHEMA },
          plan: {
            type: 'object',
            properties: {
              d30: { type: 'string', maxLength: 1000 },
              d60: { type: 'string', maxLength: 1000 },
              d90: { type: 'string', maxLength: 1000 },
            },
            additionalProperties: false,
          },
          itemId: { type: 'string', description: 'Required for complete.' },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'list') {
            const doc = await store.load(args.projectId)
            return { handoff: doc.handoff, plan: doc.plan, gate: gateSummary(doc) }
          }
          const outcome = await mutate(store, args.projectId, args.expectedRevision, (doc) => {
            if (args.action === 'complete') {
              const item = doc.handoff.find((entry) => entry.id === args.itemId)
              if (item === undefined) throw new WorkflowError('NOT_FOUND', `没有这个交接项：${args.itemId}。`, 404)
              item.status = 'done'
              doc.lastAction = 'handoff.complete'
              return { item }
            }
            if (args.action === 'plan') {
              doc.plan = {
                d30: String(args.plan?.d30 ?? doc.plan?.d30 ?? '').trim(),
                d60: String(args.plan?.d60 ?? doc.plan?.d60 ?? '').trim(),
                d90: String(args.plan?.d90 ?? doc.plan?.d90 ?? '').trim(),
              }
              doc.lastAction = 'handoff.plan'
              return { plan: doc.plan }
            }
            if (!Array.isArray(args.items) || args.items.length === 0) throw new WorkflowError('INVALID_INPUT', 'set 需要 items。')
            doc.handoff = args.items.map((item) => ({
              id: `ho_${Math.random().toString(36).slice(2, 10)}`,
              category: item.category,
              title: String(item.title).trim(),
              detail: String(item.detail).trim(),
              status: item.status === 'done' ? 'done' : 'todo',
            }))
            doc.lastAction = 'handoff.set'
            return { handoff: doc.handoff }
          })
          return { projectId: outcome.project.id, revision: outcome.revision, ...outcome.result, gate: gateSummary(outcome.project) }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
    {
      name: 'sourcing_render',
      description:
        'Render the project’s deliverables from stored data into the project directory (sourcing/<slug>/): brief, market report, buyer CSV, brand sheet, economics, outreach, launch plan, handoff, dashboard.html and data.json. Pass `markdown` per artifact to add narrative sections; tables and computed figures always come from the record. Re-rendering overwrites and updates the recorded SHA-256.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['render', 'list'] },
          projectId: { type: 'string' },
          kinds: { type: 'array', items: { type: 'string', enum: Object.keys(ASSET_KINDS) }, description: 'Default: all artifacts.' },
          markdown: { type: 'object', additionalProperties: { type: 'string', maxLength: 20000 }, description: 'Optional narrative body per artifact kind, appended after the generated tables.' },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
        required: ['action', 'projectId'],
        additionalProperties: false,
      },
      async execute(args = {}) {
        try {
          if (args.action === 'list') {
            const doc = await store.load(args.projectId)
            return { assets: doc.assets, ...dirOf(doc), gate: gateSummary(doc) }
          }
          const outcome = await store.mutate(
            args.projectId,
            async (doc) => writeArtifacts(doc, { kinds: args.kinds, markdown: args.markdown ?? {} }),
            { expectedRevision: args.expectedRevision },
          )
          const doc = outcome.project
          return { projectId: doc.id, revision: outcome.revision, ...outcome.result, ...dirOf(doc), gate: gateSummary(doc), next: nextOf(doc) }
        } catch (error) {
          throw wrap(error)
        }
      },
    },
  ]
}

export function apply(ctx, config = {}) {
  const store = new ProjectStore({ dir: resolveDataDir(config) })
  const definitions = toolDefinitions(store)
  for (const definition of definitions) {
    ctx.effect(() => ctx.tools.register({ ...definition, output: OUTPUT }), `sourcing: ${definition.name}`)
  }
  ctx.logger?.info?.(`sourcing-tools: ${definitions.length} tools registered`)
}
