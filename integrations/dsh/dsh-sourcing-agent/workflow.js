/**
 * Sourcing workflow engine.
 *
 * A sourcing engagement is a durable, revisioned project document with six
 * gated stages. Every write is an explicit operation, and a stage advances
 * only when `evaluateGate` passes: the checklist is computed from stored data,
 * never from model prose. Rendering is deterministic and re-runnable.
 *
 * Plain Node on purpose: no Harness imports, so it is unit-testable and can be
 * loaded from a profile-linked package.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const SCHEMA_VERSION = 1
export const B2B_STAGES = ['intake', 'market', 'supply', 'economics', 'assets', 'handoff', 'done']
export const DTC_STAGES = ['market', 'product', 'economics', 'store', 'launch', 'ops', 'growth', 'review', 'done']
export const STAGES_BY_MODE = { b2b: B2B_STAGES, dtc: DTC_STAGES }
export const STAGES = [...new Set([...B2B_STAGES, ...DTC_STAGES])]
export const STAGE_LABELS = {
  intake: '立项',
  market: '市场选择',
  supply: '供给与对象',
  product: '产品与供应链',
  economics: '单位经济',
  assets: '资产生产',
  store: '品牌与店铺',
  launch: '上线与投放',
  ops: '履约与客服',
  growth: '增长与复购',
  review: '复盘与补货',
  handoff: '交接',
  done: '已完成',
}
export const MODES = ['b2b', 'dtc', 'hybrid']
export const GRADES = ['A', 'B', 'C', 'D']
export const SCORE_KEYS = ['demand', 'competition', 'compliance', 'logistics', 'payment', 'access']
export const SCORE_WEIGHTS = { demand: 0.25, competition: 0.15, compliance: 0.2, logistics: 0.15, payment: 0.1, access: 0.15 }
export const TIERS = ['A', 'B', 'C']
export const VERIFICATIONS = ['website', 'third_party', 'directory']
export const LEAD_STATUSES = ['new', 'queued', 'contacted', 'replied', 'sample', 'quoted', 'won', 'lost']
export const HANDOFF_CATEGORIES = ['entity', 'store', 'payment', 'ads', 'compliance', 'logistics', 'support']
export const ASSET_KINDS = {
  brief: { file: '00-brief.md', mime: 'text/markdown' },
  market: { file: '01-market.md', mime: 'text/markdown' },
  buyers: { file: '02-buyers.csv', mime: 'text/csv' },
  brand: { file: '02-brand.md', mime: 'text/markdown' },
  product: { file: '02-product.md', mime: 'text/markdown' },
  suppliers: { file: '02-suppliers.csv', mime: 'text/csv' },
  economics: { file: '03-economics.md', mime: 'text/markdown' },
  unitEconomics: { file: '03-unit-economics.csv', mime: 'text/csv' },
  outreach: { file: '04-outreach.md', mime: 'text/markdown' },
  store: { file: '04-store.md', mime: 'text/markdown' },
  launch: { file: '05-launch.md', mime: 'text/markdown' },
  ops: { file: '06-ops.md', mime: 'text/markdown' },
  growth: { file: '07-growth.md', mime: 'text/markdown' },
  review: { file: '08-review.md', mime: 'text/markdown' },
  mandate: { file: '09-mandate.md', mime: 'text/markdown' },
  handoff: { file: 'handoff.md', mime: 'text/markdown' },
  dashboard: { file: 'dashboard.html', mime: 'text/html' },
  data: { file: 'data.json', mime: 'application/json' },
}
export const DTC_STAGE_ARTIFACTS = {
  market: ['market'],
  product: ['product', 'suppliers'],
  economics: ['economics', 'unitEconomics'],
  store: ['store'],
  launch: ['launch'],
  ops: ['ops'],
  growth: ['growth'],
  review: ['review'],
}
export const DTC_ARTIFACT_KINDS = ['brief', 'market', 'product', 'suppliers', 'economics', 'unitEconomics', 'store', 'launch', 'ops', 'growth', 'review', 'mandate', 'handoff', 'dashboard', 'data']
export const REQUIRED_FACTS = {
  b2b: ['product', 'moq', 'priceBasis'],
  dtc: ['budget', 'targetMarket'],
  hybrid: ['product', 'moq', 'priceBasis', 'category', 'budget'],
}
export const REQUIRED_ASSETS = {
  b2b: ['economics', 'buyers', 'outreach'],
  dtc: ['economics', 'launch'],
  hybrid: ['economics', 'buyers', 'launch'],
}
const MARGIN_FLOOR = { b2b: 0.15, dtc: 0.3, hybrid: 0.2 }
const CURRENCY = /^[A-Z]{3}$/u
const DATE = /^\d{4}-\d{2}-\d{2}$/u
const HTTP = /^https?:\/\/[^\s]+$/iu
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/u

// ---------------------------------------------------------------------------
// Policy: thresholds and required artifacts are data, snapshotted per project
// so a running engagement never changes rules underneath the user. Overrides
// are explicit, per key, and audit-logged with a reason.

const POLICY_CACHE = new Map()

export function loadPolicy(policyId = 'dtc-default') {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/u.test(policyId)) fail('INVALID_INPUT', `policy id 不合法：${policyId}。`)
  if (POLICY_CACHE.has(policyId)) return structuredClone(POLICY_CACHE.get(policyId))
  const file = new URL(`./policies/${policyId}.json`, import.meta.url)
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    fail('NOT_FOUND', `没有这个政策包：${policyId}。`, 404)
  }
  let policy
  try {
    policy = JSON.parse(raw)
  } catch {
    fail('STORAGE_UNAVAILABLE', `政策文件不是有效 JSON：${policyId}。`, 503)
  }
  if (!Array.isArray(policy.stages) || policy.stages.length === 0) fail('STORAGE_UNAVAILABLE', `政策 ${policyId} 缺少 stages。`, 503)
  if (typeof policy.thresholds !== 'object' || policy.thresholds === null) fail('STORAGE_UNAVAILABLE', `政策 ${policyId} 缺少 thresholds。`, 503)
  POLICY_CACHE.set(policyId, policy)
  return structuredClone(policy)
}

/** Effective threshold: project override wins over the policy snapshot. */
export function policyValue(doc, key) {
  const override = doc.policyOverrides?.[key]
  if (override !== undefined) return override
  const value = doc.policy?.thresholds?.[key]
  if (value === undefined) fail('INVALID_INPUT', `政策没有这个阈值：${key}。`)
  return value
}

export function policyLabel(doc, key) {
  return doc.policy?.thresholdLabels?.[key] ?? key
}

export function policyStages(doc) {
  const stages = doc.policy?.stages
  return Array.isArray(stages) && stages.length > 0 ? [...stages, 'done'] : DTC_STAGES
}

export function skipStage(doc, stage, reason) {
  if (!policyStages(doc).includes(stage) || stage === 'done') fail('INVALID_INPUT', `不能跳过阶段：${stage}。`)
  if (stage === doc.stage) fail('INVALID_INPUT', '不能跳过当前阶段：先完成或推进它。')
  const why = requiredText(reason, '跳过理由', 10, 500)
  doc.policySkips = { ...(doc.policySkips ?? {}), [stage]: why }
  doc.lastAction = 'policy.skip'
  return { skipped: doc.policySkips }
}

export function unskipStage(doc, stage) {
  if (doc.policySkips?.[stage] === undefined) fail('NOT_FOUND', `这个阶段没有被跳过：${stage}。`, 404)
  const next = { ...doc.policySkips }
  delete next[stage]
  doc.policySkips = next
  doc.lastAction = 'policy.unskip'
  return { skipped: doc.policySkips }
}

export function setPolicyOverride(doc, key, value, reason) {
  if (doc.policy?.thresholds?.[key] === undefined) fail('INVALID_INPUT', `政策没有这个阈值：${key}。`)
  const numeric = number(value, `阈值 ${key}`, { min: 0 })
  const why = requiredText(reason, '覆盖理由', 10, 500)
  const previous = policyValue(doc, key)
  doc.policyOverrides = { ...(doc.policyOverrides ?? {}), [key]: numeric }
  doc.policyOverrideLog = [
    ...(doc.policyOverrideLog ?? []),
    { at: doc.updatedAt, key, from: previous, to: numeric, reason: why },
  ].slice(-50)
  doc.lastAction = 'policy.override'
  return { key, from: previous, to: numeric, reason: why }
}

export function clearPolicyOverride(doc, key) {
  if (doc.policyOverrides?.[key] === undefined) fail('NOT_FOUND', `这个阈值没有覆盖：${key}。`, 404)
  const next = { ...doc.policyOverrides }
  delete next[key]
  doc.policyOverrides = next
  doc.lastAction = 'policy.reset'
  return { key, value: policyValue(doc, key) }
}

// ---------------------------------------------------------------------------
// Mandate: a long-term delegation. The mandate owns the objective, success
// criteria, authority and review rhythm; a Host schedule provides the clock
// and restores a cold session when the next check-in is due.

export const MANDATE_STATUSES = ['active', 'paused', 'completed']
export const OUTREACH_POLICIES = ['approval', 'allowed', 'never']

const addDays = (iso, days) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString().slice(0, 10)

const normalizeAuthority = (authority = {}) => {
  const outreach = text(authority.outreach) || 'approval'
  if (!OUTREACH_POLICIES.includes(outreach)) fail('INVALID_INPUT', `authority.outreach 必须是 ${OUTREACH_POLICIES.join('、')}。`)
  const spendLimit = authority.spendLimit === undefined || authority.spendLimit === null || authority.spendLimit === '' ? null : number(authority.spendLimit, 'spendLimit', { min: 0 })
  return {
    research: authority.research === undefined ? true : boolean(authority.research),
    drafts: authority.drafts === undefined ? true : boolean(authority.drafts),
    outreach,
    spendLimit,
    currency: clampText(authority.currency, 8) || 'USD',
  }
}

export function activateMandate(doc, input = {}) {
  if (doc.mandate?.status === 'active') fail('MANDATE_ACTIVE', '已有生效中的委托：先 pause 或完成它，再开新的。', 409)
  const defaults = doc.policy?.mandate ?? {}
  const objective = requiredText(input.objective, '委托目标', 20, 1000)
  const criteriaInput = Array.isArray(input.successCriteria) ? input.successCriteria : []
  if (criteriaInput.length === 0) fail('INVALID_INPUT', '至少要一条成功标准。')
  if (criteriaInput.length > 8) fail('INVALID_INPUT', '成功标准最多 8 条。')
  const successCriteria = criteriaInput.map((criterion, index) => requiredText(criterion, `成功标准 ${index + 1}`, 6, 200))
  const scheduleId = requiredText(input.scheduleId, 'scheduleId', 3, 120)
  const reviewCadenceDays = number(input.reviewCadenceDays ?? defaults.reviewCadenceDays ?? 7, '检查周期（天）', { min: 1, max: 90 })
  const horizonDays = number(input.horizonDays ?? defaults.horizonDays ?? 90, '委托周期（天）', { min: 7, max: 3650 })
  doc.mandate = {
    status: 'active',
    objective,
    successCriteria,
    criteriaMet: [],
    scheduleId,
    reviewCadenceDays,
    horizonDays,
    startedAt: doc.updatedAt,
    expiresAt: addDays(doc.updatedAt, horizonDays),
    nextReviewAt: input.nextReviewAt ? dateOnly(input.nextReviewAt, 'nextReviewAt') : addDays(doc.updatedAt, reviewCadenceDays),
    authority: normalizeAuthority({ ...(defaults.authority ?? {}), ...(input.authority ?? {}) }),
    runs: [],
    blockers: [],
    pauseReason: '',
  }
  doc.lastAction = 'mandate.activate'
  return doc.mandate
}

export function checkinMandate(doc, input = {}) {
  const mandate = doc.mandate
  if (mandate === null || mandate === undefined) fail('MANDATE_MISSING', '这个项目还没有委托。', 404)
  if (mandate.status !== 'active') fail('MANDATE_INACTIVE', `委托当前是 ${mandate.status}，不能 checkin。`, 409)
  const summary = requiredText(input.summary, '检查总结', 10, 1000)
  const actions = stringList(input.actions, '本次动作', 10).map((action) => action.slice(0, 300))
  const blockers = stringList(input.blockers, '阻塞项', 10).map((blocker) => blocker.slice(0, 300))
  const criteriaMet = Array.isArray(input.criteriaMet)
    ? [...new Set(input.criteriaMet.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= mandate.successCriteria.length))]
    : []
  const run = { at: doc.updatedAt, stage: doc.stage, summary, actions, blockers, criteriaMet }
  mandate.runs = [...mandate.runs, run].slice(-100)
  mandate.criteriaMet = [...new Set([...(mandate.criteriaMet ?? []), ...criteriaMet])].sort((left, right) => left - right)
  mandate.blockers = blockers
  mandate.nextReviewAt = input.nextReviewAt ? dateOnly(input.nextReviewAt, 'nextReviewAt') : addDays(doc.updatedAt, mandate.reviewCadenceDays)
  if (mandate.criteriaMet.length >= mandate.successCriteria.length) mandate.status = 'completed'
  doc.lastAction = 'mandate.checkin'
  return { run, mandate }
}

export function pauseMandate(doc, reason) {
  const mandate = doc.mandate
  if (mandate?.status !== 'active') fail('MANDATE_INACTIVE', '只有生效中的委托可以暂停。', 409)
  mandate.status = 'paused'
  mandate.pauseReason = requiredText(reason, '暂停理由', 6, 500)
  mandate.pausedAt = doc.updatedAt
  doc.lastAction = 'mandate.pause'
  return { scheduleId: mandate.scheduleId, mandate }
}

export function resumeMandate(doc, scheduleId) {
  const mandate = doc.mandate
  if (mandate?.status !== 'paused') fail('MANDATE_INACTIVE', '只有暂停中的委托可以恢复。', 409)
  mandate.status = 'active'
  mandate.scheduleId = requiredText(scheduleId, 'scheduleId', 3, 120)
  mandate.pausedAt = null
  mandate.pauseReason = ''
  mandate.nextReviewAt = addDays(doc.updatedAt, mandate.reviewCadenceDays)
  doc.lastAction = 'mandate.resume'
  return mandate
}

export function mandateNextActions(doc, now = doc.updatedAt) {
  const mandate = doc.mandate
  if (mandate?.status !== 'active') return []
  const actions = []
  if (doc.stage === 'done') {
    actions.push({ kind: 'complete', text: '项目已完成：写交付总结，并在 checkin 里把所有成功标准标记完成。' })
  } else {
    const gate = evaluateGate(doc, doc.stage)
    if (!gate.passed) {
      for (const blocker of gate.blockers.slice(0, 4)) actions.push({ kind: 'gate', text: `补齐闸门：${blocker}` })
    } else {
      actions.push({ kind: 'advance', text: `阶段「${STAGE_LABELS[doc.stage] ?? doc.stage}」已通过：调用 sourcing_stage advance。` })
    }
  }
  const today = new Date(now).toISOString().slice(0, 10)
  if (mandate.nextReviewAt <= today) actions.push({ kind: 'review', text: `检查到期（${mandate.nextReviewAt}）：执行后写 checkin 并安排下一次。` })
  if (mandate.blockers.length > 0) actions.push({ kind: 'blocker', text: `上次阻塞：${mandate.blockers[0]}` })
  return actions.slice(0, 6)
}

export function mandateSummary(doc) {
  const mandate = doc.mandate
  if (mandate === null || mandate === undefined) return null
  return {
    status: mandate.status,
    objective: mandate.objective,
    nextReviewAt: mandate.nextReviewAt,
    scheduleId: mandate.scheduleId,
    criteriaMet: mandate.criteriaMet?.length ?? 0,
    criteriaTotal: mandate.successCriteria?.length ?? 0,
    runs: mandate.runs?.length ?? 0,
    blockers: mandate.blockers ?? [],
  }
}

export class WorkflowError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'WorkflowError'
    this.code = code
    this.status = status
  }
}

const fail = (code, message, status = 400) => {
  throw new WorkflowError(code, message, status)
}
const nowIso = (clock) => new Date(clock()).toISOString()
const id = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 8)}`
const text = (value) => (typeof value === 'string' ? value.trim() : '')
const clampText = (value, max, field) => {
  const cleaned = text(value)
  if (cleaned.length > max) fail('INVALID_INPUT', `${field} 超过 ${max} 字符。`)
  return cleaned
}
const requiredText = (value, field, min = 1, max = 2000) => {
  const cleaned = clampText(value, max, field)
  if (cleaned.length < min) fail('INVALID_INPUT', `${field} 至少 ${min} 个字符。`)
  return cleaned
}
const number = (value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === undefined || value === null || value === '') fail('INVALID_INPUT', `${field} 必填。`)
  const parsed = typeof value === 'number' ? value : Number(String(value).replaceAll(',', ''))
  if (!Number.isFinite(parsed)) fail('INVALID_INPUT', `${field} 必须是数字。`)
  if (parsed < min || parsed > max) fail('INVALID_INPUT', `${field} 必须在 ${min} 到 ${max} 之间。`)
  return parsed
}
const optionalNumber = (value, field, options) => (value === undefined || value === null || value === '' ? 0 : number(value, field, options))
const boolean = (value) => value === true || value === 'true'
const httpUrl = (value, field) => {
  const cleaned = text(value)
  if (!HTTP.test(cleaned)) fail('INVALID_INPUT', `${field} 必须是 http(s) 链接。`)
  return cleaned
}
const dateOnly = (value, field) => {
  const cleaned = text(value)
  if (!DATE.test(cleaned)) fail('INVALID_INPUT', `${field} 必须是 YYYY-MM-DD。`)
  return cleaned
}
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits
const pct = (value) => `${(value * 100).toFixed(1)}%`
const money = (value, currency) => `${currency} ${value.toFixed(2)}`

export function normalizeDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, '')
  } catch {
    return ''
  }
}

export function resolveDataDir(config = {}) {
  if (typeof config.dataDir === 'string' && config.dataDir.trim()) return resolve(config.dataDir.trim())
  const profile = process.env.DSH_PROFILE_DIR
  const home = profile ? resolve(profile, '..', '..') : join(homedir(), '.dsh')
  return join(home, 'data', 'sourcing')
}

// ---------------------------------------------------------------------------
// Store

export class ProjectStore {
  #queue = new Map()

  constructor({ dir, clock = Date.now } = {}) {
    if (typeof dir !== 'string' || dir === '') throw new TypeError('ProjectStore requires a directory.')
    this.dir = resolve(dir)
    this.clock = clock
  }

  get projectsDir() {
    return join(this.dir, 'projects')
  }

  fileOf(projectId) {
    if (!/^src_[a-z0-9_]+$/u.test(projectId)) fail('INVALID_INPUT', 'projectId 不合法。')
    return join(this.projectsDir, `${projectId}.json`)
  }

  async list({ status = '', limit = 50 } = {}) {
    let names = []
    try {
      names = await readdir(this.projectsDir)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const projects = []
    for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
      try {
        const doc = JSON.parse(await readFile(join(this.projectsDir, name), 'utf8'))
        if (status === '' || doc.status === status) projects.push(doc)
      } catch {
        // One corrupt file must not hide the readable projects.
      }
    }
    return projects
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map(overviewOf)
  }

  async load(projectId) {
    const file = this.fileOf(projectId)
    let raw
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') fail('NOT_FOUND', `没有找到项目 ${projectId}。`, 404)
      throw error
    }
    let doc
    try {
      doc = JSON.parse(raw)
    } catch {
      fail('STORAGE_UNAVAILABLE', `项目文件不是有效 JSON：${file}`, 503)
    }
    return validateProject(doc)
  }

  async create(input) {
    const doc = createProject(input, this.clock)
    await this.#write(this.fileOf(doc.id), doc)
    return doc
  }

  /** Serialize one project's mutations, then read-modify-write atomically. */
  async mutate(projectId, operation, { expectedRevision } = {}) {
    const previous = this.#queue.get(projectId) ?? Promise.resolve()
    const run = previous.then(async () => {
      const doc = await this.load(projectId)
      if (expectedRevision !== undefined && doc.revision !== expectedRevision) {
        fail('REVISION_CONFLICT', `项目已被修改（当前 revision ${doc.revision}）。请重新读取再提交。`, 409)
      }
      const draft = structuredClone(doc)
      const result = await operation(draft)
      draft.revision = doc.revision + 1
      draft.sequence = (doc.sequence ?? 0) + 1
      draft.updatedAt = nowIso(this.clock)
      trimOperations(draft)
      await this.#write(this.fileOf(projectId), draft)
      return { result, revision: draft.revision, project: draft }
    })
    this.#queue.set(projectId, run.then(() => undefined, () => undefined))
    try {
      return await run
    } finally {
      this.#queue.delete(projectId)
    }
  }

  async #write(file, doc) {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 6)}.tmp`
    await writeFile(temporary, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  }
}

function trimOperations(doc) {
  doc.operations.push({ at: doc.updatedAt, action: doc.lastAction ?? 'update', revision: doc.revision })
  delete doc.lastAction
  if (doc.operations.length > 200) doc.operations.splice(0, doc.operations.length - 200)
}

// ---------------------------------------------------------------------------
// Project lifecycle

export function createProject(input = {}, clock = Date.now) {
  const mode = text(input.mode)
  if (!MODES.includes(mode)) fail('INVALID_INPUT', `mode 必须是 ${MODES.join('、')}。`)
  const title = requiredText(input.title, 'title', 4, 120)
  const goal = requiredText(input.goal, 'goal', 10, 1000)
  const currency = (text(input.currency) || 'USD').toUpperCase()
  if (!CURRENCY.test(currency)) fail('INVALID_INPUT', 'currency 必须是三位币种，例如 USD、EUR。')
  const targetMarkets = Array.isArray(input.targetMarkets)
    ? input.targetMarkets.map((entry) => clampText(entry, 80, 'targetMarkets')).filter(Boolean).slice(0, 12)
    : []
  const workspaceDir = text(input.workspaceDir)
  if (workspaceDir !== '' && !isAbsolute(workspaceDir)) fail('INVALID_INPUT', 'workspaceDir 必须是绝对路径。')
  const slugInput = text(input.slug).toLowerCase()
  const slug = SLUG.test(slugInput) ? slugInput : `project-${randomUUID().slice(0, 6)}`
  const at = nowIso(clock)
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id('src'),
    slug,
    title,
    mode,
    status: 'active',
    stage: mode === 'dtc' ? 'market' : 'intake',
    createdAt: at,
    updatedAt: at,
    revision: 1,
    sequence: 0,
    operations: [],
    workspaceDir: workspaceDir === '' ? '' : resolve(workspaceDir),
    brief: {
      goal,
      targetMarkets,
      currency,
      notes: clampText(input.notes, 2000),
      marketDecision: text(input.marketDecision) || null,
    },
    facts: [],
    evidence: [],
    markets: [],
    recommendation: null,
    leads: [],
    brand: null,
    suppliers: [],
    dtc: emptyDtc(),
    policy: mode === 'dtc' ? loadPolicy(text(input.policyId) || 'dtc-default') : null,
    policyOverrides: {},
    policyOverrideLog: [],
    policySkips: {},
    mandate: null,
    economics: null,
    assets: [],
    handoff: [],
    plan: null,
    gates: [],
  }
}

export function emptyDtc() {
  return {
    direction: { candidates: [], chosen: null },
    product: null,
    suppliers: [],
    samples: [],
    qc: [],
    store: null,
    launch: null,
    ops: null,
    growth: null,
    review: null,
  }
}

function validateProject(doc) {
  if (doc?.schemaVersion !== SCHEMA_VERSION) fail('STORAGE_UNAVAILABLE', '项目文件版本不受支持。', 503)
  for (const key of ['facts', 'evidence', 'markets', 'leads', 'suppliers', 'assets', 'handoff', 'gates']) {
    if (!Array.isArray(doc[key])) doc[key] = []
  }
  if (doc.mode === 'dtc' && (doc.dtc === null || typeof doc.dtc !== 'object')) doc.dtc = emptyDtc()
  if (doc.mode === 'dtc' && (doc.policy === null || typeof doc.policy !== 'object')) doc.policy = loadPolicy('dtc-default')
  if (doc.mode === 'dtc' && (doc.policyOverrides === null || typeof doc.policyOverrides !== 'object')) doc.policyOverrides = {}
  if (doc.mode === 'dtc' && (doc.policySkips === null || typeof doc.policySkips !== 'object')) doc.policySkips = {}
  if (doc.mandate === undefined) doc.mandate = null
  const sequence = doc.mode === 'dtc' ? policyStages(doc) : STAGES_BY_MODE[doc.mode] ?? B2B_STAGES
  if (!sequence.includes(doc.stage)) doc.stage = sequence[0]
  return doc
}

export function projectDirOf(doc) {
  if (!doc.workspaceDir) fail('WORKSPACE_MISSING', '项目没有工作区目录：请在 sourcing_project update 里设置 workspaceDir。')
  return join(doc.workspaceDir, 'sourcing', doc.slug)
}

// ---------------------------------------------------------------------------
// Writes

export function setFacts(doc, facts) {
  if (!Array.isArray(facts) || facts.length === 0) fail('INVALID_INPUT', 'facts 至少包含一项。')
  for (const fact of facts) {
    const key = text(fact.key)
    if (!/^[a-z][a-zA-Z0-9]{1,40}$/u.test(key)) fail('INVALID_INPUT', `fact key 不合法：${key}。使用 camelCase，例如 product、moq、priceBasis。`)
    const value = fact.value === undefined || fact.value === null ? '' : String(fact.value).trim()
    if (value === '') fail('INVALID_INPUT', `fact ${key} 的 value 不能为空。`)
    if (value.length > 500) fail('INVALID_INPUT', `fact ${key} 超过 500 字符。`)
    const basis = text(fact.basis) || 'confirmed'
    if (basis !== 'confirmed' && basis !== 'assumed') fail('INVALID_INPUT', `fact ${key} 的 basis 必须是 confirmed 或 assumed。`)
    const source = text(fact.source)
    const next = {
      key,
      value,
      unit: clampText(fact.unit, 40),
      basis,
      source: source === '' ? '' : httpUrl(source, `fact ${key} 的 source`),
      note: clampText(fact.note, 500),
      updatedAt: doc.updatedAt,
    }
    const index = doc.facts.findIndex((entry) => entry.key === key)
    if (index >= 0) doc.facts[index] = next
    else doc.facts.push(next)
  }
  doc.lastAction = 'facts.set'
  return { facts: doc.facts.length }
}

export function removeFact(doc, key) {
  const before = doc.facts.length
  doc.facts = doc.facts.filter((entry) => entry.key !== key)
  if (doc.facts.length === before) fail('NOT_FOUND', `没有这个事实：${key}。`, 404)
  doc.lastAction = 'facts.remove'
  return { facts: doc.facts.length }
}

export function addEvidence(doc, items) {
  const list = Array.isArray(items) ? items : [items]
  if (list.length === 0) fail('INVALID_INPUT', 'evidence 至少包含一项。')
  const added = []
  for (const item of list) {
    const url = httpUrl(item.url, 'evidence.url')
    const claim = requiredText(item.claim, 'evidence.claim', 10, 500)
    const grade = text(item.grade).toUpperCase()
    if (!GRADES.includes(grade)) fail('INVALID_INPUT', 'evidence.grade 必须是 A、B、C 或 D。')
    const publisher = clampText(item.publisher, 120)
    if (grade === 'A' && publisher === '') fail('INVALID_INPUT', 'A 级证据必须写 publisher（发布方）。')
    const accessedAt = item.accessedAt === undefined || item.accessedAt === '' ? new Date(doc.updatedAt).toISOString().slice(0, 10) : dateOnly(item.accessedAt, 'evidence.accessedAt')
    const stage = text(item.stage) || doc.stage
    if (!STAGES.includes(stage) || stage === 'done') fail('INVALID_INPUT', `evidence.stage 不合法：${stage}。`)
    if (doc.evidence.some((entry) => entry.url === url && entry.claim === claim)) continue
    const record = {
      id: id('ev'),
      stage,
      url,
      title: requiredText(item.title, 'evidence.title', 3, 200),
      publisher,
      accessedAt,
      grade,
      claim,
      quote: clampText(item.quote, 300),
      currency: text(item.currency).toUpperCase().slice(0, 3),
      unit: clampText(item.unit, 40),
      createdAt: doc.updatedAt,
    }
    doc.evidence.push(record)
    added.push(record)
  }
  doc.lastAction = 'evidence.add'
  return { added: added.length, evidence: doc.evidence.length }
}

export function setMarkets(doc, markets, recommendation) {
  if (!Array.isArray(markets) || markets.length < 3) fail('INVALID_INPUT', 'markets 至少 3 个候选市场。')
  if (markets.length > 8) fail('INVALID_INPUT', 'markets 最多 8 个候选市场。')
  const strong = new Set(doc.evidence.filter((entry) => entry.grade === 'A' || entry.grade === 'B').map((entry) => entry.id))
  const next = markets.map((market) => {
    const name = requiredText(market.name, 'market.name', 2, 80)
    const scores = {}
    for (const key of SCORE_KEYS) {
      const score = number(market.scores?.[key], `market ${name} 的 ${key} 分数`, { min: 1, max: 5 })
      if (!Number.isInteger(score)) fail('INVALID_INPUT', `market ${name} 的 ${key} 必须是 1-5 的整数。`)
      scores[key] = score
    }
    const ids = Array.isArray(market.evidenceIds) ? [...new Set(market.evidenceIds.map((entry) => text(entry)))].filter(Boolean) : []
    if (ids.length === 0) fail('INVALID_INPUT', `market ${name} 至少关联 1 条证据。`)
    for (const evidenceId of ids) {
      if (!doc.evidence.some((entry) => entry.id === evidenceId)) fail('INVALID_INPUT', `market ${name} 关联了不存在的证据 ${evidenceId}。`)
    }
    if (!ids.some((evidenceId) => strong.has(evidenceId))) fail('INVALID_INPUT', `market ${name} 需要至少 1 条 A/B 级证据。`)
    return {
      id: market.id && /^mkt_[a-z0-9]+$/u.test(market.id) ? market.id : id('mkt'),
      name,
      country: clampText(market.country, 80),
      scores,
      total: round(SCORE_KEYS.reduce((sum, key) => sum + scores[key] * SCORE_WEIGHTS[key], 0) / 5, 3),
      notes: clampText(market.notes, 1000),
      evidenceIds: ids,
    }
  })
  doc.markets = next
  if (recommendation !== undefined) doc.recommendation = normalizeRecommendation(doc, recommendation)
  doc.lastAction = 'markets.set'
  return { markets: next.length, recommendation: doc.recommendation?.marketId ?? null }
}

export function normalizeRecommendation(doc, recommendation) {
  if (recommendation === null) return null
  const marketId = text(recommendation.marketId)
  if (!doc.markets.some((entry) => entry.id === marketId)) fail('INVALID_INPUT', `推荐的市场 ${marketId} 不在候选里。`)
  const rationale = requiredText(recommendation.rationale, 'recommendation.rationale', 24, 2000)
  return { marketId, rationale, at: doc.updatedAt }
}

export function addLeads(doc, leads) {
  const list = Array.isArray(leads) ? leads : [leads]
  if (list.length === 0) fail('INVALID_INPUT', 'leads 至少包含一条。')
  const domains = new Set(doc.leads.map((entry) => normalizeDomain(entry.website)).filter(Boolean))
  const added = []
  for (const lead of list) {
    const website = httpUrl(lead.website, 'lead.website')
    const domain = normalizeDomain(website)
    if (domain === '') fail('INVALID_INPUT', `lead.website 无法解析域名：${website}。`)
    if (domains.has(domain)) fail('DUPLICATE_LEAD', `域名已存在：${domain}。先 update 已有线索，不要重复添加。`, 409)
    const tier = text(lead.tier).toUpperCase()
    if (!TIERS.includes(tier)) fail('INVALID_INPUT', 'lead.tier 必须是 A、B 或 C。')
    const verification = text(lead.verification)
    if (!VERIFICATIONS.includes(verification)) fail('INVALID_INPUT', `lead.verification 必须是 ${VERIFICATIONS.join('、')}。`)
    const email = text(lead.email)
    if (email !== '' && !EMAIL.test(email)) fail('INVALID_INPUT', `邮箱格式不合法：${email}。`)
    const status = text(lead.status) || 'new'
    if (!LEAD_STATUSES.includes(status)) fail('INVALID_INPUT', `lead.status 必须是 ${LEAD_STATUSES.join('、')}。`)
    const record = {
      id: id('lead'),
      company: requiredText(lead.company, 'lead.company', 2, 160),
      country: clampText(lead.country, 80),
      segment: clampText(lead.segment, 80),
      website,
      domain,
      contactName: clampText(lead.contactName, 120),
      role: clampText(lead.role, 120),
      email,
      phone: clampText(lead.phone, 60),
      sourceUrl: httpUrl(lead.sourceUrl, 'lead.sourceUrl'),
      matchNote: requiredText(lead.matchNote, 'lead.matchNote', 10, 500),
      importSignal: clampText(lead.importSignal, 300),
      tier,
      verification,
      status,
      nextStep: clampText(lead.nextStep, 300),
      updatedAt: doc.updatedAt,
    }
    domains.add(domain)
    doc.leads.push(record)
    added.push(record)
  }
  doc.lastAction = 'leads.add'
  return { added: added.length, leads: doc.leads.length }
}

export function updateLead(doc, leadId, patch = {}) {
  const lead = doc.leads.find((entry) => entry.id === leadId)
  if (lead === undefined) fail('NOT_FOUND', `没有这条线索：${leadId}。`, 404)
  if (patch.status !== undefined) {
    if (!LEAD_STATUSES.includes(patch.status)) fail('INVALID_INPUT', `status 必须是 ${LEAD_STATUSES.join('、')}。`)
    lead.status = patch.status
  }
  if (patch.tier !== undefined) {
    if (!TIERS.includes(patch.tier)) fail('INVALID_INPUT', 'tier 必须是 A、B 或 C。')
    lead.tier = patch.tier
  }
  if (patch.email !== undefined) {
    const email = text(patch.email)
    if (email !== '' && !EMAIL.test(email)) fail('INVALID_INPUT', `邮箱格式不合法：${email}。`)
    lead.email = email
  }
  for (const key of ['contactName', 'role', 'phone', 'nextStep', 'importSignal', 'matchNote']) {
    if (patch[key] !== undefined) lead[key] = clampText(patch[key], key === 'nextStep' ? 300 : 500)
  }
  if (patch.verification !== undefined) {
    if (!VERIFICATIONS.includes(patch.verification)) fail('INVALID_INPUT', 'verification 必须是 website、third_party 或 directory。')
    lead.verification = patch.verification
  }
  lead.updatedAt = doc.updatedAt
  doc.lastAction = 'leads.update'
  return { lead }
}

export function setBrand(doc, brand = {}) {
  const nameCandidates = Array.isArray(brand.nameCandidates)
    ? brand.nameCandidates.map((candidate) => ({
        name: requiredText(candidate.name, 'nameCandidate.name', 2, 60),
        note: clampText(candidate.note, 300),
        domainChecked: boolean(candidate.domainChecked),
        socialChecked: boolean(candidate.socialChecked),
        trademarkNote: clampText(candidate.trademarkNote, 300),
      }))
    : []
  doc.brand = {
    chosenName: clampText(brand.chosenName, 60),
    positioning: clampText(brand.positioning, 1000),
    voice: clampText(brand.voice, 500),
    palette: clampText(brand.palette, 200),
    productName: clampText(brand.productName, 120),
    productSpec: clampText(brand.productSpec, 2000),
    price: brand.price === undefined || brand.price === '' ? null : number(brand.price, 'brand.price', { min: 0.01 }),
    notes: clampText(brand.notes, 2000),
    nameCandidates,
  }
  doc.lastAction = 'brand.set'
  return { brand: doc.brand }
}

export function setSuppliers(doc, suppliers) {
  if (!Array.isArray(suppliers) || suppliers.length === 0) fail('INVALID_INPUT', 'suppliers 至少包含一家供应商。')
  doc.suppliers = suppliers.map((supplier) => ({
    id: supplier.id && /^sup_[a-z0-9]+$/u.test(supplier.id) ? supplier.id : id('sup'),
    name: requiredText(supplier.name, 'supplier.name', 2, 160),
    url: httpUrl(supplier.url, 'supplier.url'),
    product: clampText(supplier.product, 200),
    quote: requiredText(supplier.quote, 'supplier.quote', 1, 120),
    basis: requiredText(supplier.basis, 'supplier.basis', 2, 40),
    moq: number(supplier.moq, 'supplier.moq', { min: 1 }),
    leadTimeDays: supplier.leadTimeDays === undefined || supplier.leadTimeDays === '' ? null : number(supplier.leadTimeDays, 'supplier.leadTimeDays', { min: 1, max: 3650 }),
    evidenceId: clampText(supplier.evidenceId, 60),
  }))
  doc.lastAction = 'suppliers.set'
  return { suppliers: doc.suppliers.length }
}

// ---------------------------------------------------------------------------
// Economics

export function computeEconomics(kind, inputs = {}) {
  if (kind === 'b2b') {
    const unitCost = number(inputs.unitCost, 'unitCost')
    const packaging = optionalNumber(inputs.packaging, 'packaging')
    const inlandFreight = optionalNumber(inputs.inlandFreight, 'inlandFreight')
    const portHandling = optionalNumber(inputs.portHandling, 'portHandling')
    const fobPrice = number(inputs.fobPrice, 'fobPrice', { min: 0.01 })
    const fobCost = round(unitCost + packaging + inlandFreight + portHandling)
    const grossMargin = round((fobPrice - fobCost) / fobPrice)
    return {
      kind: 'b2b',
      computed: {
        fobCost,
        grossProfit: round(fobPrice - fobCost),
        grossMargin,
        markup: fobCost === 0 ? 0 : round((fobPrice - fobCost) / fobCost),
      },
      warnings: grossMargin < MARGIN_FLOOR.b2b ? [`毛利率 ${pct(grossMargin)} 低于 ${pct(MARGIN_FLOOR.b2b)} 门槛。`] : [],
    }
  }
  const price = number(inputs.price, 'price', { min: 0.01 })
  const cogs = number(inputs.cogs, 'cogs')
  const freightPerUnit = optionalNumber(inputs.freightPerUnit, 'freightPerUnit')
  const dutyRate = optionalNumber(inputs.dutyRate, 'dutyRate', { min: 0, max: 1 })
  const platformFeeRate = optionalNumber(inputs.platformFeeRate, 'platformFeeRate', { min: 0, max: 0.5 })
  const paymentFeeRate = optionalNumber(inputs.paymentFeeRate, 'paymentFeeRate', { min: 0, max: 0.2 })
  const fulfillmentPerUnit = optionalNumber(inputs.fulfillmentPerUnit, 'fulfillmentPerUnit')
  const returnsRate = optionalNumber(inputs.returnsRate, 'returnsRate', { min: 0, max: 0.5 })
  const adCost = optionalNumber(inputs.adCost, 'adCost')
  const targetMarginRate = optionalNumber(inputs.targetMarginRate, 'targetMarginRate', { min: 0, max: 0.9 }) || 0.2
  const duty = round((cogs + freightPerUnit) * dutyRate)
  const landedCost = round(cogs + freightPerUnit + duty)
  const platformFee = round(price * platformFeeRate)
  const paymentFee = round(price * paymentFeeRate)
  const returnsCost = round(price * returnsRate)
  const contributionBeforeAds = round(price - landedCost - platformFee - paymentFee - fulfillmentPerUnit - returnsCost)
  const marginBeforeAds = round(contributionBeforeAds / price)
  const contributionAfterAds = round(contributionBeforeAds - adCost)
  const breakevenRoas = contributionBeforeAds <= 0 ? null : round(price / contributionBeforeAds)
  const targetRoas = marginBeforeAds - targetMarginRate <= 0 ? null : round(1 / (marginBeforeAds - targetMarginRate))
  const warnings = []
  if (marginBeforeAds < MARGIN_FLOOR.dtc) warnings.push(`广告前毛利率 ${pct(marginBeforeAds)} 低于 ${pct(MARGIN_FLOOR.dtc)} 门槛。`)
  if (breakevenRoas === null) warnings.push('单件贡献为负，盈亏平衡 ROAS 不存在：先改定价或成本。')
  return {
    kind: 'dtc',
    computed: {
      duty,
      landedCost,
      platformFee,
      paymentFee,
      returnsCost,
      contributionBeforeAds,
      marginBeforeAds,
      contributionAfterAds,
      breakevenRoas,
      targetRoas,
      targetMarginRate,
    },
    warnings,
  }
}

export function setEconomics(doc, payload = {}) {
  const kind = doc.mode === 'dtc' ? 'dtc' : 'b2b'
  const inputs = sanitizeEconomicsInputs(kind, payload.inputs ?? payload)
  const result = computeEconomics(kind, inputs)
  doc.economics = {
    kind,
    currency: (text(payload.currency) || doc.brief.currency).toUpperCase(),
    inputs,
    computed: result.computed,
    warnings: result.warnings,
    riskAccepted: boolean(payload.riskAccepted),
    riskNote: clampText(payload.riskNote, 1000),
    updatedAt: doc.updatedAt,
  }
  doc.lastAction = 'economics.set'
  return doc.economics
}

function sanitizeEconomicsInputs(kind, inputs) {
  if (kind === 'b2b') {
    return {
      unitCost: number(inputs.unitCost, 'unitCost'),
      packaging: optionalNumber(inputs.packaging, 'packaging'),
      inlandFreight: optionalNumber(inputs.inlandFreight, 'inlandFreight'),
      portHandling: optionalNumber(inputs.portHandling, 'portHandling'),
      fobPrice: number(inputs.fobPrice, 'fobPrice', { min: 0.01 }),
    }
  }
  return {
    price: number(inputs.price, 'price', { min: 0.01 }),
    cogs: number(inputs.cogs, 'cogs'),
    freightPerUnit: optionalNumber(inputs.freightPerUnit, 'freightPerUnit'),
    dutyRate: optionalNumber(inputs.dutyRate, 'dutyRate', { min: 0, max: 1 }),
    platformFeeRate: optionalNumber(inputs.platformFeeRate, 'platformFeeRate', { min: 0, max: 0.5 }),
    paymentFeeRate: optionalNumber(inputs.paymentFeeRate, 'paymentFeeRate', { min: 0, max: 0.2 }),
    fulfillmentPerUnit: optionalNumber(inputs.fulfillmentPerUnit, 'fulfillmentPerUnit'),
    returnsRate: optionalNumber(inputs.returnsRate, 'returnsRate', { min: 0, max: 0.5 }),
    adCost: optionalNumber(inputs.adCost, 'adCost'),
    targetMarginRate: optionalNumber(inputs.targetMarginRate, 'targetMarginRate', { min: 0, max: 0.9 }) || 0.2,
  }
}

// ---------------------------------------------------------------------------
// Gates

export function evaluateGate(doc, stage = doc.stage) {
  if (doc.mode === 'dtc') return evaluateDtcGate(doc, stage)
  return evaluateB2bGate(doc, stage)
}

export function evaluateB2bGate(doc, stage = doc.stage) {
  const checks = []
  const add = (checkId, label, ok, detail = '') => checks.push({ id: checkId, label, ok, detail })
  const factsByKey = new Map(doc.facts.map((fact) => [fact.key, fact]))
  const confirmedFacts = doc.facts.filter((fact) => fact.basis === 'confirmed').length
  const strongEvidence = doc.evidence.filter((entry) => entry.grade === 'A' || entry.grade === 'B')

  if (stage === 'intake') {
    add('title', '项目名称与目标', doc.title.length >= 4 && doc.brief.goal.length >= 10, '标题与目标至少一句话')
    add('mode', '业务模式', MODES.includes(doc.mode), doc.mode)
    add('currency', '币种', CURRENCY.test(doc.brief.currency), doc.brief.currency)
    const missing = REQUIRED_FACTS[doc.mode].filter((key) => factsByKey.get(key)?.basis !== 'confirmed')
    add('facts', '关键事实已确认', missing.length === 0, missing.length === 0 ? `${confirmedFacts} 项已确认` : `缺少或未确认：${missing.join('、')}`)
    const marketKnown = doc.brief.targetMarkets.length > 0 || doc.brief.marketDecision === 'agent'
    add('market', '目标市场（或委托选择）', marketKnown, marketKnown ? doc.brief.targetMarkets.join('、') || '委托 agent 选择' : '未填写目标市场')
  }

  if (stage === 'market') {
    add('candidates', '候选市场数量', doc.markets.length >= 3, `${doc.markets.length}/3`)
    const incomplete = doc.markets.filter((market) => SCORE_KEYS.some((key) => !Number.isInteger(market.scores?.[key])))
    add('scores', '六维评分完整', doc.markets.length > 0 && incomplete.length === 0, incomplete.length === 0 ? '' : `${incomplete.length} 个市场评分不完整`)
    const unlinked = doc.markets.filter((market) => !market.evidenceIds?.some((evidenceId) => strongEvidence.some((entry) => entry.id === evidenceId)))
    add('marketEvidence', '每个市场有 A/B 级证据', doc.markets.length > 0 && unlinked.length === 0, unlinked.length === 0 ? '' : `${unlinked.map((market) => market.name).join('、')} 缺证据`)
    add('evidenceVolume', 'A/B 级证据总量', strongEvidence.length >= 3, `${strongEvidence.length}/3`)
    add(
      'recommendation',
      '推荐结论与理由',
      doc.recommendation !== null && doc.recommendation.rationale.length >= 24,
      doc.recommendation === null ? '未给出推荐' : `已推荐 ${doc.markets.find((market) => market.id === doc.recommendation.marketId)?.name ?? '?'}`,
    )
  }

  if (stage === 'supply') {
    if (doc.mode === 'dtc') {
      const brand = doc.brand ?? {}
      add('brandName', '品牌名与定位', text(brand.chosenName) !== '' && text(brand.positioning).length >= 40, brand.chosenName ?? '未定名')
      add('product', '产品与价格', text(brand.productName) !== '' && Number.isFinite(brand.price) && brand.price > 0, brand.productName ?? '未定义产品')
      const checked = (brand.nameCandidates ?? []).filter((candidate) => candidate.domainChecked && candidate.trademarkNote.length >= 10)
      add('nameChecks', '命名可用性核查', checked.length >= 3, `${checked.length}/3`)
      const suppliers = doc.suppliers.filter((supplier) => HTTP.test(supplier.url) && supplier.moq > 0)
      add('suppliers', '供应商报价', suppliers.length >= 3, `${suppliers.length}/3`)
    } else {
      add('leads', '合格线索数量', doc.leads.length >= 20, `${doc.leads.length}/20`)
      const invalid = doc.leads.filter((lead) => lead.matchNote.length < 10 || lead.sourceUrl === '' || lead.domain === '')
      add('leadFields', '线索字段完整', doc.leads.length > 0 && invalid.length === 0, invalid.length === 0 ? '' : `${invalid.length} 条缺字段`)
      const duplicates = doc.leads.length - new Set(doc.leads.map((lead) => lead.domain)).size
      add('dedupe', '域名去重', doc.leads.length > 0 && duplicates === 0, duplicates === 0 ? '' : `${duplicates} 条重复域名`)
      const verified = doc.leads.filter((lead) => lead.verification !== 'directory').length
      const ratio = doc.leads.length === 0 ? 0 : verified / doc.leads.length
      add('verified', '已核实比例', ratio >= 0.6, `${Math.round(ratio * 100)}% (${verified}/${doc.leads.length})`)
      const strong = doc.leads.filter((lead) => lead.tier === 'A' || lead.tier === 'B').length
      add('tiers', 'A/B 级线索', strong >= 8, `${strong}/8`)
    }
  }

  if (stage === 'economics') {
    const economics = doc.economics
    add('exists', '单位经济已建模', economics !== null, economics === null ? '未建模' : economics.kind)
    if (economics !== null) {
      const isB2b = doc.mode !== 'dtc'
      const margin = isB2b ? economics.computed.grossMargin : economics.computed.marginBeforeAds
      const floor = MARGIN_FLOOR[doc.mode] ?? MARGIN_FLOOR.b2b
      const accepted = economics.riskAccepted && economics.riskNote.length >= 20
      add('margin', '毛利/贡献毛利达标', margin >= floor || accepted, `${pct(margin)} (门槛 ${pct(floor)})${accepted ? ' · 已记录风险接受' : ''}`)
      if (!isB2b) {
        add(
          'roas',
          '盈亏平衡 ROAS 可计算',
          Number.isFinite(economics.computed.breakevenRoas) && economics.computed.breakevenRoas > 1,
          economics.computed.breakevenRoas === null ? '贡献为负' : String(economics.computed.breakevenRoas),
        )
      }
    }
  }

  if (stage === 'assets') {
    const required = REQUIRED_ASSETS[doc.mode] ?? REQUIRED_ASSETS.b2b
    let dir = ''
    try {
      dir = projectDirOf(doc)
    } catch {
      dir = ''
    }
    const present = new Set(doc.assets.map((asset) => asset.kind))
    const missing = required.filter((kind) => !present.has(kind))
    add('kinds', '必需产出物', missing.length === 0, missing.length === 0 ? required.join('、') : `缺少：${missing.join('、')}`)
    const files = doc.assets.filter((asset) => asset.kind !== 'data')
    const missingFiles = dir === '' ? files.length : files.filter((asset) => !existsSync(join(dir, asset.file))).length
    add('files', '文件已落盘', dir !== '' && files.length > 0 && missingFiles === 0, dir === '' ? '未设置工作区' : missingFiles === 0 ? `${files.length} 个文件` : `${missingFiles} 个文件缺失`)
    const ready = files.filter((asset) => asset.status === 'ready').length
    add('ready', '产出物标记完成', files.length > 0 && ready === files.length, `${ready}/${files.length}`)
  }

  if (stage === 'handoff') {
    add('items', '交接项数量', doc.handoff.length >= 6, `${doc.handoff.length}/6`)
    const categories = new Set(doc.handoff.map((item) => item.category))
    add('categories', '交接覆盖度', categories.size >= 4, `${categories.size}/4 类`)
    const incomplete = doc.handoff.filter((item) => item.title.length < 4 || item.detail.length < 12)
    add('details', '每一项可执行', doc.handoff.length > 0 && incomplete.length === 0, incomplete.length === 0 ? '' : `${incomplete.length} 项缺细节`)
    const plan = doc.plan ?? {}
    add('plan', '30/60/90 计划', ['d30', 'd60', 'd90'].every((key) => text(plan[key]).length >= 12), '每段至少一句话')
  }

  if (stage === 'done') {
    add('completed', '项目已完成', doc.status === 'completed', `${doc.gates.filter((gate) => gate.passed).length} 道闸门已通过`)
  }

  const passed = checks.length > 0 && checks.every((check) => check.ok)
  return {
    stage,
    stageLabel: STAGE_LABELS[stage] ?? stage,
    passed,
    checklist: checks,
    blockers: checks.filter((check) => !check.ok).map((check) => `${check.label}：${check.detail}`),
  }
}

export function nextStage(stage, mode = 'b2b') {
  const sequence = STAGES_BY_MODE[mode] ?? B2B_STAGES
  const index = sequence.indexOf(stage)
  return index < 0 || index === sequence.length - 1 ? stage : sequence[index + 1]
}

/** Record the attempt, then advance only on a pass. */
export function attemptAdvance(doc) {
  const gate = evaluateGate(doc, doc.stage)
  doc.gates.push({ stage: doc.stage, passed: gate.passed, at: doc.updatedAt, checklist: gate.checklist })
  if (doc.gates.length > 50) doc.gates.splice(0, doc.gates.length - 50)
  if (!gate.passed) {
    doc.lastAction = 'stage.blocked'
    return { passed: false, stage: doc.stage, status: doc.status, gate }
  }
  const from = doc.stage
  if (doc.mode === 'dtc') {
    const sequence = policyStages(doc)
    let index = sequence.indexOf(from) + 1
    while (index < sequence.length && doc.policySkips?.[sequence[index]] !== undefined) index += 1
    doc.stage = sequence[Math.min(index, sequence.length - 1)]
  } else {
    doc.stage = nextStage(from, doc.mode)
  }
  if (doc.stage === 'done') doc.status = 'completed'
  doc.lastAction = 'stage.advance'
  return { passed: true, from, stage: doc.stage, status: doc.status, gate }
}

// ---------------------------------------------------------------------------
// Rendering

const escapeCsv = (value) => {
  const cell = value === undefined || value === null ? '' : String(value)
  return /[",\n]/u.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell
}
const csv = (headers, rows) => [headers.join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n') + '\n'
const escapeHtml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const mdEscape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')

const ECON_LABELS = {
  unitCost: '单件成本',
  packaging: '包装',
  inlandFreight: '国内运费',
  portHandling: '港口费用',
  fobPrice: 'FOB 报价',
  fobCost: 'FOB 成本',
  grossProfit: '单件毛利',
  grossMargin: '毛利率',
  markup: '加价率',
  price: '售价',
  cogs: '采购成本',
  freightPerUnit: '头程运费',
  dutyRate: '关税率',
  platformFeeRate: '平台费率',
  paymentFeeRate: '支付费率',
  fulfillmentPerUnit: '履约费',
  returnsRate: '退货率',
  adCost: '广告成本（CAC）',
  targetMarginRate: '目标利润率',
  duty: '关税',
  landedCost: '到岸成本',
  platformFee: '平台费',
  paymentFee: '支付费',
  returnsCost: '退货成本',
  contributionBeforeAds: '广告前贡献',
  marginBeforeAds: '广告前毛利率',
  contributionAfterAds: '广告后贡献',
  breakevenRoas: '盈亏平衡 ROAS',
  targetRoas: '目标 ROAS',
}

const HEAD = {
  entity: '主体与账户',
  store: '店铺与域名',
  payment: '支付与收款',
  ads: '广告与流量',
  compliance: '认证与合规',
  logistics: '物流与售后',
  support: '客服',
}

function header(doc, title) {
  return `# ${title}\n\n> ${doc.title} · ${STAGE_LABELS[doc.stage]} · 更新 ${doc.updatedAt.slice(0, 10)}\n`
}

export function renderArtifact(doc, kind, { markdown = '' } = {}) {
  const meta = ASSET_KINDS[kind]
  if (meta === undefined) fail('INVALID_INPUT', `未知产出物类型：${kind}。可选：${Object.keys(ASSET_KINDS).join('、')}。`)
  if (kind === 'dashboard') return dashboardHtml(doc)
  if (kind === 'data') return `${JSON.stringify(doc, null, 2)}\n`
  if (kind === 'buyers') return buyersCsv(doc)
  if (kind === 'unitEconomics') return unitEconomicsCsv(doc)
  if (kind === 'brief') return briefMarkdown(doc, markdown)
  if (kind === 'market') return marketMarkdown(doc, markdown)
  if (kind === 'brand') return brandMarkdown(doc, markdown)
  if (kind === 'product') return dtcProductMarkdown(doc, markdown)
  if (kind === 'suppliers') return dtcSuppliersCsv(doc)
  if (kind === 'economics') return economicsMarkdown(doc, markdown)
  if (kind === 'outreach') return outreachMarkdown(doc, markdown)
  if (kind === 'store') return dtcStoreMarkdown(doc, markdown)
  if (kind === 'launch') return doc.mode === 'dtc' ? dtcLaunchMarkdown(doc, markdown) : launchMarkdown(doc, markdown)
  if (kind === 'ops') return dtcOpsMarkdown(doc, markdown)
  if (kind === 'growth') return dtcGrowthMarkdown(doc, markdown)
  if (kind === 'review') return dtcReviewMarkdown(doc, markdown)
  if (kind === 'mandate') return mandateMarkdown(doc, markdown)
  if (kind === 'handoff') return handoffMarkdown(doc, markdown)
  return ''
}

function briefMarkdown(doc, extra) {
  const facts =
    doc.facts.length === 0
      ? '_尚无事实，使用 sourcing_facts 录入。_'
      : ['| Key | 值 | 依据 | 来源 |', '|---|---|---|---|', ...doc.facts.map((fact) => `| ${fact.key} | ${mdEscape(fact.value)}${fact.unit ? ` ${fact.unit}` : ''} | ${fact.basis === 'confirmed' ? '已确认' : '假设'} | ${fact.source || '—'} |`)].join('\n')
  const market = doc.brief.targetMarkets.length > 0 ? doc.brief.targetMarkets.join('、') : doc.brief.marketDecision === 'agent' ? '委托 agent 选择' : '待确认'
  return `${header(doc, '项目简报')}
## 目标

${doc.brief.goal}

## 基本设定

| 项目 | 内容 |
|---|---|
| 模式 | ${doc.mode} |
| 目标市场 | ${market} |
| 币种 | ${doc.brief.currency} |
| 阶段 | ${STAGE_LABELS[doc.stage]} |

## 事实与假设

${facts}

${doc.brief.notes === '' ? '' : `## 备注\n\n${doc.brief.notes}\n`}
${extra}
`
}

function marketMarkdown(doc, extra) {
  const rows = doc.markets.map((market) => `| ${market.name} | ${market.country || '—'} | ${market.total.toFixed(2)} | ${SCORE_KEYS.map((key) => market.scores[key]).join('/')} | ${market.evidenceIds.length} |`)
  const evidence =
    doc.evidence.length === 0
      ? '_尚无证据。_'
      : ['| 级别 | 主张 | 来源 | 访问日期 |', '|---|---|---|---|', ...doc.evidence.map((entry) => `| ${entry.grade} | ${mdEscape(entry.claim)} | ${entry.publisher || entry.url} | ${entry.accessedAt} |`)].join('\n')
  const recommendation =
    doc.recommendation === null
      ? '_尚未给出推荐。_'
      : `**推荐：${doc.markets.find((market) => market.id === doc.recommendation.marketId)?.name ?? '?'}**\n\n${doc.recommendation.rationale}`
  return `${header(doc, '市场选择')}
## 候选与评分

| 市场 | 国家 | 加权总分 | 需求/竞争/合规/物流/付款/渠道 | 证据数 |
|---|---|---|---|---|
${rows.join('\n') || '| — | — | — | — | — |'}

评分说明：1-5 分，竞争项分数越高表示竞争越有利；总分 = Σ(分数 × 权重)。

## 推荐

${recommendation}

## 证据

${evidence}

${extra}
`
}

function brandMarkdown(doc, extra) {
  const brand = doc.brand ?? {}
  const names = (brand.nameCandidates ?? []).map((candidate) => `| ${candidate.name} | ${candidate.domainChecked ? '已查' : '未查'} | ${candidate.trademarkNote || '—'} |`).join('\n')
  const suppliers = doc.suppliers.map((supplier) => `| ${supplier.name} | ${supplier.quote} | ${supplier.basis} | ${supplier.moq} | ${supplier.leadTimeDays ?? '—'} | ${supplier.url} |`).join('\n')
  return `${header(doc, '品牌与产品')}
## 品牌

| 项目 | 内容 |
|---|---|
| 品牌名 | ${brand.chosenName || '待定'} |
| 定位 | ${brand.positioning || '待定'} |
| 语调 | ${brand.voice || '待定'} |
| 视觉 | ${brand.palette || '待定'} |

## 产品

| 项目 | 内容 |
|---|---|
| 产品名 | ${brand.productName || '待定'} |
| 售价 | ${brand.price === null || brand.price === undefined ? '待定' : money(brand.price, doc.brief.currency)} |
| 规格 | ${brand.productSpec || '待定'} |

## 命名核查

| 名称 | 域名 | 商标备注 |
|---|---|---|
${names || '| — | — | — |'}

## 供应商

| 供应商 | 报价 | 口径 | MOQ | 交期（天） | 链接 |
|---|---|---|---|---|---|
${suppliers || '| — | — | — | — | — | — |'}

${extra}
`
}

function economicsMarkdown(doc, extra) {
  const economics = doc.economics
  if (economics === null) return `${header(doc, '单位经济')}\n_尚未建模，使用 sourcing_economics 录入。_\n\n${extra}`
  const rows = Object.entries(economics.computed)
    .filter(([key]) => key !== 'currency')
    .map(([key, value]) => `| ${ECON_LABELS[key] ?? key} | ${typeof value === 'number' ? (Math.abs(value) < 1 && Math.abs(value) > 0 ? pct(value) : value.toFixed(2)) : String(value)} |`)
  const inputs = Object.entries(economics.inputs).map(([key, value]) => `| ${ECON_LABELS[key] ?? key} | ${value} |`)
  return `${header(doc, '单位经济')}
## 输入

| 项目 | 数值 |
|---|---|
${inputs.join('\n')}

## 计算

| 指标 | 数值 |
|---|---|
${rows.join('\n')}

${economics.warnings.length === 0 ? '' : `## 风险\n\n${economics.warnings.map((warning) => `- ${warning}`).join('\n')}\n`}
${economics.riskAccepted ? `## 风险接受\n\n${economics.riskNote}\n` : ''}
${extra}
`
}

function buyersCsv(doc) {
  const headers = ['公司', '国家', '细分', '网站', '联系人', '职位', '邮箱', '电话', '来源链接', '匹配点', '进口信号', '分级', '核验级别', '状态', '下一步']
  return csv(
    headers,
    doc.leads.map((lead) => [lead.company, lead.country, lead.segment, lead.website, lead.contactName, lead.role, lead.email, lead.phone, lead.sourceUrl, lead.matchNote, lead.importSignal, lead.tier, lead.verification, lead.status, lead.nextStep]),
  )
}

function unitEconomicsCsv(doc) {
  const rows = []
  if (doc.economics !== null) {
    for (const [key, value] of Object.entries(doc.economics.inputs)) rows.push([ECON_LABELS[key] ?? key, value, '输入'])
    for (const [key, value] of Object.entries(doc.economics.computed)) rows.push([ECON_LABELS[key] ?? key, value, '计算'])
  }
  return csv(['项目', '数值', '口径'], rows)
}

function outreachMarkdown(doc, extra) {
  const target = doc.leads.find((lead) => lead.tier === 'A') ?? doc.leads[0]
  const sample = target === undefined ? '<Company>' : target.company
  return `${header(doc, '开发信与跟进')}
## 首封

\`\`\`
Hi <First name>,

I saw ${sample} carries <specific product/category> for <market>. We make
<product> for <buyer type> in <country>, and <one concrete proof>.

Two things that may matter for your line:
- <benefit with a number>
- <second benefit>

Would a sample be useful? I can send one <this week> so your team can check the finish.

<Name>, <Title>, <Company>
\`\`\`

## 跟进

- D3 补价值：规格表或案例，只加一个新信息。
- D7 换角度：阶梯价、交期或定制。
- D14 收尾：明确关闭，留门。

## 本轮名单

| 公司 | 分级 | 状态 | 下一步 |
|---|---|---|---|
${doc.leads.slice(0, 30).map((lead) => `| ${lead.company} | ${lead.tier} | ${lead.status} | ${lead.nextStep || '首封'} |`).join('\n') || '| — | — | — | — |'}

${extra}
`
}

function launchMarkdown(doc, extra) {
  const brand = doc.brand ?? {}
  return `${header(doc, '上线计划')}
## 品牌一句话

${brand.positioning || '<定位待补>'}

## 商品页骨架

1. 主图 + 一句话价值
2. 三个利益点（不是功能罗列）
3. 社会证明与评价
4. 规格、使用说明、常见问题
5. 保障与退换

## 投放

- 三个角度：痛点、效果对比、场景故事；每个角度 3 条钩子。
- Meta：1 campaign / 3 ad set / 每个 3 条素材，每日预算从 $30-50 起，3 天为判断周期。
- 止损：花费超过 2 倍客单价仍无加购，关素材；ROAS 低于盈亏平衡 30% 且持续 3 天，关 ad set。

## 14 天

| 天 | 任务 |
|---|---|
| D1-2 | 选题与定位 |
| D3-4 | 询价与打样 |
| D5 | 命名与域名 |
| D6-7 | 店铺与商品页 |
| D8 | 素材 |
| D9 | 支付、物流、税务 |
| D10 | 测试订单 |
| D11-12 | 广告与落地页 |
| D13 | 上线 |
| D14 | 复盘 |

${extra}
`
}

function handoffMarkdown(doc, extra) {
  const groups = new Map()
  for (const item of doc.handoff) {
    if (!groups.has(item.category)) groups.set(item.category, [])
    groups.get(item.category).push(item)
  }
  const body = [...groups.entries()]
    .map(([category, items]) => `## ${HEAD[category] ?? category}\n\n${items.map((item) => `- [${item.status === 'done' ? 'x' : ' '}] **${item.title}** — ${item.detail}`).join('\n')}\n`)
    .join('\n')
  const plan = doc.plan ?? {}
  return `${header(doc, '交接清单')}
> 以下动作必须由你本人或你的公司完成；研究、文案、表格与计划已经做好。

${body || '_尚未生成交接项。_'}

## 30/60/90

| 阶段 | 目标 |
|---|---|
| 30 天 | ${plan.d30 || '—'} |
| 60 天 | ${plan.d60 || '—'} |
| 90 天 | ${plan.d90 || '—'} |

${extra}
`
}

export function dashboardHtml(doc) {
  const gate = evaluateGate(doc, doc.stage)
  const sequence = STAGES_BY_MODE[doc.mode] ?? B2B_STAGES
  const stageIndex = sequence.indexOf(doc.stage)
  const rail = sequence
    .filter((stage) => stage !== 'done')
    .map((stage, index) => {
      const state = index < stageIndex ? 'done' : index === stageIndex ? 'current' : 'todo'
      return `<li class="${state}"><span class="dot"></span><div><strong>${STAGE_LABELS[stage]}</strong><small>${state === 'done' ? '已通过' : state === 'current' ? '进行中' : '待开始'}</small></div></li>`
    })
    .join('')
  const checklist = gate.checklist
    .map((check) => `<tr><td class="${check.ok ? 'ok' : 'bad'}">${check.ok ? '✓' : '✕'}</td><td>${escapeHtml(check.label)}</td><td>${escapeHtml(check.detail)}</td></tr>`)
    .join('')
  const assets = doc.assets.map((asset) => `<tr><td>${escapeHtml(asset.kind)}</td><td>${escapeHtml(asset.file)}</td><td>${asset.bytes} B</td></tr>`).join('')
  const economics =
    doc.economics === null
      ? '<p class="muted">尚未建模</p>'
      : `<table><tbody>${Object.entries(doc.economics.computed)
          .map(([key, value]) => `<tr><th>${escapeHtml(ECON_LABELS[key] ?? key)}</th><td>${typeof value === 'number' ? (Math.abs(value) < 1 && Math.abs(value) > 0 ? pct(value) : value.toFixed(2)) : escapeHtml(value)}</td></tr>`)
          .join('')}</tbody></table>`
  const leads =
    doc.mode === 'dtc'
      ? ''
      : `<section><h2>线索漏斗</h2><div class="stats"><div><b>${doc.leads.length}</b><span>线索</span></div><div><b>${doc.leads.filter((lead) => lead.tier === 'A').length}</b><span>A 级</span></div><div><b>${doc.leads.filter((lead) => lead.verification !== 'directory').length}</b><span>已核实</span></div><div><b>${doc.leads.filter((lead) => ['replied', 'sample', 'quoted'].includes(lead.status)).length}</b><span>有回应</span></div></div></section>`
  const dtcBlock = doc.mode === 'dtc' ? dtcOverviewHtml(doc) : ''
  const mandateBlock = doc.mandate === null || doc.mandate === undefined ? '' : mandateOverviewHtml(doc)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(doc.title)} · Sourcing</title>
<style>
:root{color-scheme:light dark;--bg:#faf7f2;--fg:#1f1a16;--muted:#7a6f66;--line:#e6ddd2;--accent:#c2410c;--ok:#15803d;--bad:#b91c1c;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#171310;--fg:#f2e9df;--muted:#a5968a;--line:#332a24;--card:#201a16}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 "Segoe UI",system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 24px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px;letter-spacing:.02em}
.meta{color:var(--muted);font-size:13px;margin-bottom:24px}
.rail{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:0 0 24px;padding:0}
.rail li{display:flex;gap:8px;align-items:flex-start;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.rail .dot{width:8px;height:8px;border-radius:50%;background:var(--line);margin-top:6px;flex:none}
.rail li.done .dot{background:var(--ok)}.rail li.current .dot{background:var(--accent)}.rail li.current{border-color:var(--accent)}
.rail small{display:block;color:var(--muted);font-size:11px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:14px 0}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
td.ok{color:var(--ok);font-weight:700}td.bad{color:var(--bad);font-weight:700}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.stats div{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px}
.stats b{display:block;font-size:22px}.stats span{font-size:12px;color:var(--muted)}
.muted{color:var(--muted)}
.banner{padding:10px 14px;border-radius:10px;margin-bottom:16px;font-size:13px}
.banner.ok{background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok)}
.banner.bad{background:color-mix(in srgb,var(--bad) 10%,transparent);color:var(--bad)}
</style></head><body><main>
<h1>${escapeHtml(doc.title)}</h1>
<div class="meta">${escapeHtml(doc.mode)} · ${escapeHtml(doc.brief.currency)} · revision ${doc.revision} · 更新 ${doc.updatedAt.slice(0, 16).replace('T', ' ')}</div>
<ol class="rail">${rail}</ol>
<section><h2>当前阶段闸门</h2><div class="banner ${gate.passed ? 'ok' : 'bad'}">${gate.passed ? '闸门通过，可进入下一阶段' : `未通过：${escapeHtml(gate.blockers[0] ?? '')}${gate.blockers.length > 1 ? ` 等 ${gate.blockers.length} 项` : ''}`}</div>
<table><thead><tr><th></th><th>检查项</th><th>现状</th></tr></thead><tbody>${checklist}</tbody></table></section>
${mandateBlock}
${leads}
${dtcBlock}
<section><h2>单位经济</h2>${economics}</section>
<section><h2>产出物</h2><table><thead><tr><th>类型</th><th>文件</th><th>大小</th></tr></thead><tbody>${assets || '<tr><td colspan="3" class="muted">尚未生成</td></tr>'}</tbody></table></section>
<section><h2>目标</h2><p>${escapeHtml(doc.brief.goal)}</p><p class="muted">数据文件：data.json · 由 Sourcing Agent 生成</p></section>
</main></body></html>
`
}

// ---------------------------------------------------------------------------
// Artifact writing

export const B2B_ARTIFACT_KINDS = ['brief', 'market', 'buyers', 'brand', 'economics', 'unitEconomics', 'outreach', 'handoff', 'dashboard', 'data']

function mandateOverviewHtml(doc) {
  const mandate = doc.mandate
  const met = mandate.criteriaMet?.length ?? 0
  const total = mandate.successCriteria?.length ?? 0
  const status = mandate.status === 'active' ? '生效中' : mandate.status === 'paused' ? '已暂停' : '已完成'
  const authority = mandate.authority ?? {}
  return `<section><h2>长期委托</h2>
<div class="stats"><div><b>${status}</b><span>状态</span></div><div><b>${met}/${total}</b><span>成功标准</span></div><div><b>${(mandate.runs ?? []).length}</b><span>运行次数</span></div><div><b>${escapeHtml(mandate.nextReviewAt)}</b><span>下次检查</span></div></div>
<p>${escapeHtml(mandate.objective)}</p>
<table><tbody>
<tr><th>周期</th><td>${escapeHtml(mandate.startedAt.slice(0, 10))} → ${escapeHtml(mandate.expiresAt)} · 每 ${mandate.reviewCadenceDays} 天检查</td></tr>
<tr><th>授权</th><td>研究 ${authority.research ? '允许' : '不允许'} · 起草 ${authority.drafts ? '允许' : '不允许'} · 对外 ${authority.outreach === 'allowed' ? '允许' : authority.outreach === 'never' ? '禁止' : '需确认'} · 预算 ${authority.spendLimit === null ? '未授权' : `${escapeHtml(authority.currency)} ${authority.spendLimit}`}</td></tr>
<tr><th>定时任务</th><td>${escapeHtml(mandate.scheduleId)}</td></tr>
</tbody></table></section>`
}

function dtcOverviewHtml(doc) {
  const dtc = doc.dtc ?? {}
  const product = dtc.product ?? {}
  const store = dtc.store ?? {}
  const launch = dtc.launch ?? {}
  const ops = dtc.ops ?? {}
  const growth = dtc.growth ?? {}
  const review = dtc.review ?? {}
  const pagesDone = (store.pages ?? []).filter((page) => page.done).length
  const policiesDone = (store.policies ?? []).filter((policy) => policy.done).length
  const samplesReceived = (dtc.samples ?? []).filter((sample) => sample.status === 'received' || sample.status === 'approved').length
  const flowsDone = (growth.flows ?? []).filter((flow) => flow.done).length
  const metrics = review.metrics ?? {}
  return `<section><h2>品牌与产品</h2>
<div class="stats"><div><b>${(dtc.suppliers ?? []).length}</b><span>供应商</span></div><div><b>${samplesReceived}</b><span>样品到手</span></div><div><b>${(dtc.qc ?? []).length}</b><span>QC 项</span></div><div><b>${(launch.creatives ?? []).length}</b><span>素材</span></div></div>
<table><tbody>
<tr><th>产品</th><td>${escapeHtml(product.name || '待定')}${product.price === undefined || product.price === null ? '' : ` · ${escapeHtml(doc.brief.currency)} ${product.price}`}</td></tr>
<tr><th>店铺</th><td>${escapeHtml(store.domain || '待定')} · 页面 ${pagesDone} / 政策 ${policiesDone}</td></tr>
<tr><th>3PL</th><td>${escapeHtml(ops.threePl?.name || '未选定')}${ops.threePl?.slaOnTime === undefined ? '' : ` · 准时率 ${ops.threePl.slaOnTime}%`}</td></tr>
<tr><th>增长</th><td>流程 ${flowsDone}/4 · 达人 ${(growth.kols ?? []).length}</td></tr>
<tr><th>复盘</th><td>${metrics.roas === undefined ? '尚未录入' : `ROAS ${Number(metrics.roas).toFixed(2)} · CVR ${pct(Number(metrics.cvr) || 0)}`}</td></tr>
</tbody></table></section>`
}

export async function writeArtifacts(doc, { kinds, markdown = {} } = {}) {
  const dir = projectDirOf(doc)
  await mkdir(dir, { recursive: true })
  const wanted = Array.isArray(kinds) && kinds.length > 0 ? kinds : doc.mode === 'dtc' ? DTC_ARTIFACT_KINDS : B2B_ARTIFACT_KINDS
  const written = []
  for (const kind of wanted) {
    const meta = ASSET_KINDS[kind]
    if (meta === undefined) fail('INVALID_INPUT', `未知产出物类型：${kind}。`)
    const content = renderArtifact(doc, kind, { markdown: markdown[kind] ?? '' })
    const absolute = join(dir, meta.file)
    await mkdir(dirname(absolute), { recursive: true })
    const temporary = `${absolute}.${process.pid}.tmp`
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, absolute)
    const sha256 = createHash('sha256').update(content, 'utf8').digest('hex')
    const bytes = Buffer.byteLength(content, 'utf8')
    const existing = doc.assets.find((asset) => asset.kind === kind)
    const record = {
      id: existing?.id ?? id('asset'),
      kind,
      file: meta.file,
      mime: meta.mime,
      sha256,
      bytes,
      status: 'ready',
      updatedAt: doc.updatedAt,
    }
    if (existing === undefined) doc.assets.push(record)
    else Object.assign(existing, record)
    written.push({ kind, file: meta.file, bytes, sha256 })
  }
  doc.lastAction = 'artifacts.render'
  return { dir, written }
}

// ---------------------------------------------------------------------------
// Read models

export function overviewOf(doc) {
  const gate = evaluateGate(doc, doc.stage)
  return {
    projectId: doc.id,
    title: doc.title,
    mode: doc.mode,
    stage: doc.stage,
    stageLabel: STAGE_LABELS[doc.stage] ?? doc.stage,
    status: doc.status,
    revision: doc.revision,
    updatedAt: doc.updatedAt,
    counts: {
      facts: doc.facts.length,
      evidence: doc.evidence.filter((entry) => entry.grade === 'A' || entry.grade === 'B').length,
      markets: doc.markets.length,
      leads: doc.leads.length,
      assets: doc.assets.length,
      handoff: doc.handoff.length,
    },
    gate: { passed: gate.passed, blockers: gate.blockers },
    mandate: mandateSummary(doc),
  }
}

export function sectionOf(doc, section = 'overview') {
  if (section === 'overview') return overviewOf(doc)
  if (section === 'gate') return evaluateGate(doc, doc.stage)
  if (section === 'facts') return { facts: doc.facts }
  if (section === 'evidence') return { evidence: doc.evidence }
  if (section === 'markets') return { markets: doc.markets, recommendation: doc.recommendation }
  if (section === 'leads') return { leads: doc.leads }
  if (section === 'brand') return { brand: doc.brand, suppliers: doc.suppliers }
  if (section === 'dtc') return { dtc: doc.dtc }
  if (section === 'economics') return { economics: doc.economics }
  if (section === 'assets') return { assets: doc.assets, dir: safeProjectDir(doc) }
  if (section === 'handoff') return { handoff: doc.handoff, plan: doc.plan }
  if (section === 'gates') return { gates: doc.gates }
  if (section === 'mandate') return { mandate: doc.mandate, nextActions: mandateNextActions(doc) }
  if (section === 'policy') {
    const effective = {}
    for (const key of Object.keys(doc.policy?.thresholds ?? {})) effective[key] = policyValue(doc, key)
    return { policy: doc.policy, overrides: doc.policyOverrides ?? {}, overrideLog: doc.policyOverrideLog ?? [], skips: doc.policySkips ?? {}, effective }
  }
  fail('INVALID_INPUT', `未知 section：${section}。`)
}

function safeProjectDir(doc) {
  try {
    return projectDirOf(doc)
  } catch {
    return ''
  }
}

export function projectPathInfo(doc) {
  const dir = safeProjectDir(doc)
  return { projectDir: dir, workspaceDir: doc.workspaceDir, relative: dir === '' ? '' : relative(doc.workspaceDir, dir).split(sep).join('/') }
}

// ---------------------------------------------------------------------------
// DTC track: eight gated stages, each backed by a stored section and a
// rendered artifact. The artifact requirement is what keeps the process
// document-driven: a stage cannot pass on prose alone.

const DTC_SECTIONS = ['direction', 'product', 'suppliers', 'samples', 'qc', 'store', 'launch', 'ops', 'growth', 'review']
export const DTC_FLOW_KEYS = ['welcome', 'abandoned', 'post_purchase', 'winback']

const itemsOf = (payload) => {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

const stringList = (value, field, max = 40) => {
  if (!Array.isArray(value)) return []
  return value.map((entry) => requiredText(entry, field, 1, 200)).slice(0, max)
}

const doneList = (value, field) => {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    if (typeof entry === 'string') return { key: requiredText(entry, field, 1, 80), done: false }
    return { key: requiredText(entry?.key, field, 1, 80), done: boolean(entry?.done) }
  })
}

export function emptyDtcSection(section) {
  if (!DTC_SECTIONS.includes(section)) fail('INVALID_INPUT', `未知 dtc 分区：${section}。`)
  return null
}

export function setDtcSection(doc, section, payload = {}) {
  if (doc.mode !== 'dtc') fail('INVALID_INPUT', 'dtc 分区只用于品牌出海（dtc）项目。')
  if (!DTC_SECTIONS.includes(section)) fail('INVALID_INPUT', `未知 dtc 分区：${section}。可选：${DTC_SECTIONS.join('、')}。`)
  if (doc.dtc === null || typeof doc.dtc !== 'object') doc.dtc = emptyDtc()
  if (section === 'direction') doc.dtc.direction = normalizeDirection(doc, payload)
  else if (section === 'product') doc.dtc.product = normalizeProduct(payload)
  else if (section === 'suppliers') doc.dtc.suppliers = normalizeSuppliers(payload)
  else if (section === 'samples') doc.dtc.samples = normalizeSamples(payload)
  else if (section === 'qc') doc.dtc.qc = normalizeQc(payload)
  else if (section === 'store') doc.dtc.store = normalizeStore(payload)
  else if (section === 'launch') doc.dtc.launch = normalizeLaunch(payload)
  else if (section === 'ops') doc.dtc.ops = normalizeOps(payload)
  else if (section === 'growth') doc.dtc.growth = normalizeGrowth(payload)
  else doc.dtc.review = normalizeReview(payload)
  doc.lastAction = `dtc.${section}`
  return { section, value: doc.dtc[section] }
}

function normalizeDirection(doc, payload) {
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []).map((candidate) => {
    const name = requiredText(candidate.name, '方向名称', 2, 80)
    const evidenceIds = Array.isArray(candidate.evidenceIds) ? [...new Set(candidate.evidenceIds.map((entry) => text(entry)))].filter(Boolean) : []
    for (const evidenceId of evidenceIds) {
      if (!doc.evidence.some((entry) => entry.id === evidenceId)) fail('INVALID_INPUT', `方向 ${name} 关联了不存在的证据 ${evidenceId}。`)
    }
    return {
      name,
      audience: clampText(candidate.audience, 200),
      problem: clampText(candidate.problem, 300),
      priceBand: clampText(candidate.priceBand, 100),
      note: clampText(candidate.note, 500),
      evidenceIds,
    }
  })
  const chosen = payload.chosen
    ? { name: requiredText(payload.chosen.name, '选定方向', 2, 80), rationale: requiredText(payload.chosen.rationale, '选择理由', 24, 1000) }
    : null
  if (chosen !== null && candidates.length > 0 && !candidates.some((candidate) => candidate.name === chosen.name)) {
    fail('INVALID_INPUT', `选定方向 ${chosen.name} 不在候选里。`)
  }
  return { candidates, chosen, at: doc.updatedAt }
}

function normalizeProduct(payload) {
  return {
    name: clampText(payload.name, 120),
    spec: clampText(payload.spec, 4000),
    packaging: clampText(payload.packaging, 1000),
    price: payload.price === undefined || payload.price === '' ? null : number(payload.price, '产品售价', { min: 0.01 }),
    warranty: clampText(payload.warranty, 500),
    heroSku: clampText(payload.heroSku, 80),
    variants: stringList(payload.variants, '变体', 20),
  }
}

function normalizeSuppliers(payload) {
  return itemsOf(payload).map((supplier) => ({
    id: supplier.id && /^sup_[a-z0-9]+$/u.test(supplier.id) ? supplier.id : id('sup'),
    name: requiredText(supplier.name, '供应商名称', 2, 160),
    url: httpUrl(supplier.url, '供应商链接'),
    quote: requiredText(supplier.quote, '供应商报价', 1, 120),
    basis: requiredText(supplier.basis, '报价口径', 2, 40),
    moq: number(supplier.moq, 'MOQ', { min: 1 }),
    leadTimeDays: number(supplier.leadTimeDays, '交期（天）', { min: 1, max: 3650 }),
    sampleFee: clampText(supplier.sampleFee, 100),
    sampleLeadDays: supplier.sampleLeadDays === undefined || supplier.sampleLeadDays === '' ? null : number(supplier.sampleLeadDays, '打样天数', { min: 1, max: 365 }),
    evidenceId: clampText(supplier.evidenceId, 60),
  }))
}

function normalizeSamples(payload) {
  const statuses = ['requested', 'received', 'approved', 'rejected']
  return itemsOf(payload).map((sample) => {
    const status = text(sample.status) || 'requested'
    if (!statuses.includes(status)) fail('INVALID_INPUT', `样品状态必须是 ${statuses.join('、')}。`)
    return {
      id: sample.id && /^smp_[a-z0-9]+$/u.test(sample.id) ? sample.id : id('smp'),
      supplierId: clampText(sample.supplierId, 60),
      sku: clampText(sample.sku, 80),
      status,
      requestedAt: sample.requestedAt ? dateOnly(sample.requestedAt, 'requestedAt') : null,
      receivedAt: sample.receivedAt ? dateOnly(sample.receivedAt, 'receivedAt') : null,
      feedback: clampText(sample.feedback, 1000),
      issues: stringList(sample.issues, '样品问题', 20),
    }
  })
}

function normalizeQc(payload) {
  return itemsOf(payload).map((item) => ({
    item: requiredText(item.item, '检验项', 2, 200),
    method: clampText(item.method, 200),
    standard: clampText(item.standard, 200),
  }))
}

function normalizeStore(payload) {
  return {
    domain: clampText(payload.domain, 120),
    platform: clampText(payload.platform, 60),
    pages: doneList(payload.pages, '页面'),
    policies: doneList(payload.policies, '政策'),
    payments: stringList(payload.payments, '支付方式', 10),
    shippingRates: (Array.isArray(payload.shippingRates) ? payload.shippingRates : []).map((rate) => ({
      zone: requiredText(rate.zone, '配送区域', 1, 80),
      method: clampText(rate.method, 80),
      price: number(rate.price, '运费', { min: 0 }),
      days: rate.days === undefined || rate.days === '' ? null : number(rate.days, '时效', { min: 1, max: 120 }),
    })),
    pixelEvents: (Array.isArray(payload.pixelEvents) ? payload.pixelEvents : []).map((event) => ({
      event: requiredText(event.event, '事件名', 1, 80),
      verified: boolean(event.verified),
    })),
    emailCapture: boolean(payload.emailCapture),
  }
}

function normalizeLaunch(payload) {
  return {
    creatives: (Array.isArray(payload.creatives) ? payload.creatives : []).map((creative) => ({
      angle: requiredText(creative.angle, '素材角度', 1, 40),
      hook: requiredText(creative.hook, '素材钩子', 5, 200),
      format: clampText(creative.format, 40),
    })),
    campaigns: (Array.isArray(payload.campaigns) ? payload.campaigns : []).map((campaign) => ({
      platform: requiredText(campaign.platform, '投放平台', 2, 40),
      name: clampText(campaign.name, 80),
      budgetDaily: number(campaign.budgetDaily, '日预算', { min: 1 }),
      adSets: campaign.adSets === undefined || campaign.adSets === '' ? null : number(campaign.adSets, '广告组数', { min: 1, max: 100 }),
      killRules: requiredText(campaign.killRules, '止损规则', 20, 1000),
    })),
    trackingVerified: boolean(payload.trackingVerified),
    startAt: payload.startAt ? dateOnly(payload.startAt, 'startAt') : null,
  }
}

function normalizeOps(payload) {
  const threePl = payload.threePl ?? {}
  const testOrder = payload.testOrder ?? {}
  const result = text(testOrder.result) || 'pending'
  if (!['pending', 'passed', 'failed'].includes(result)) fail('INVALID_INPUT', 'testOrder.result 必须是 pending、passed 或 failed。')
  return {
    threePl: {
      name: clampText(threePl.name, 120),
      slaAccuracy: threePl.slaAccuracy === undefined || threePl.slaAccuracy === '' ? null : number(threePl.slaAccuracy, 'SLA 准确率', { min: 0, max: 100 }),
      slaOnTime: threePl.slaOnTime === undefined || threePl.slaOnTime === '' ? null : number(threePl.slaOnTime, 'SLA 准时率', { min: 0, max: 100 }),
      cutoff: clampText(threePl.cutoff, 40),
      returnsAddress: clampText(threePl.returnsAddress, 500),
    },
    skuChecked: boolean(payload.skuChecked),
    testOrder: { at: testOrder.at ? dateOnly(testOrder.at, 'testOrder.at') : null, result },
    csTemplates: stringList(payload.csTemplates, '客服模板', 20),
    shippingPromiseHours: payload.shippingPromiseHours === undefined || payload.shippingPromiseHours === '' ? null : number(payload.shippingPromiseHours, '发货承诺（小时）', { min: 1, max: 240 }),
  }
}

function normalizeGrowth(payload) {
  return {
    flows: doneList(payload.flows, '自动化流程'),
    reviews: clampText(payload.reviews, 1000),
    loyalty: clampText(payload.loyalty, 1000),
    kols: (Array.isArray(payload.kols) ? payload.kols : []).map((kol) => ({
      name: requiredText(kol.name, '达人名称', 1, 100),
      platform: clampText(kol.platform, 40),
      followers: kol.followers === undefined || kol.followers === '' ? null : number(kol.followers, '粉丝数', { min: 0 }),
      status: clampText(kol.status, 40),
    })),
  }
}

function normalizeReview(payload) {
  const metrics = payload.metrics ?? {}
  return {
    metrics: {
      cvr: number(metrics.cvr, '转化率', { min: 0, max: 1 }),
      aov: number(metrics.aov, '客单价', { min: 0.01 }),
      cac: number(metrics.cac, '获客成本', { min: 0 }),
      roas: number(metrics.roas, 'ROAS', { min: 0 }),
      refundRate: number(metrics.refundRate, '退款率', { min: 0, max: 1 }),
      inventoryTurnover: number(metrics.inventoryTurnover, '库存周转', { min: 0 }),
    },
    reorderPoint: number(payload.reorderPoint, '补货点', { min: 1 }),
    safetyStock: number(payload.safetyStock, '安全库存', { min: 0 }),
    nextPlan: requiredText(payload.nextPlan, '下一轮计划', 20, 2000),
  }
}

function dtcArtifactCheck(doc, stage, add) {
  const required = doc.policy?.artifacts?.[stage] ?? DTC_STAGE_ARTIFACTS[stage] ?? []
  if (required.length === 0) return
  const dir = safeProjectDir(doc)
  const present = new Set(doc.assets.map((asset) => asset.kind))
  const missingKinds = required.filter((kind) => !present.has(kind))
  const missingFiles =
    dir === ''
      ? required
      : required.filter((kind) => {
          const asset = doc.assets.find((entry) => entry.kind === kind)
          return asset === undefined || !existsSync(join(dir, asset.file))
        })
  add('artifact', '本阶段产出物已生成', dir !== '' && missingKinds.length === 0 && missingFiles.length === 0, dir === '' ? '未设置工作区' : missingFiles.length > 0 ? `缺少：${missingFiles.join('、')}` : required.join('、'))
}

export function evaluateDtcGate(doc, stage = doc.stage) {
  const checks = []
  const add = (checkId, labelText, ok, detail = '') => checks.push({ id: checkId, label: labelText, ok, detail })
  const min = (key) => policyValue(doc, key)
  const dtc = doc.dtc ?? emptyDtc()
  const facts = new Map(doc.facts.map((fact) => [fact.key, fact]))
  const strong = doc.evidence.filter((entry) => entry.grade === 'A' || entry.grade === 'B')
  const direction = dtc.direction ?? { candidates: [], chosen: null }
  const product = dtc.product ?? {}

  if (stage === 'market') {
    const minMarkets = min('markets')
    const minEvidence = min('evidenceAB')
    const minRationale = min('rationaleChars')
    add('goal', '目标可量化', doc.brief.goal.length >= 10, doc.brief.goal)
    add('budget', '启动预算已确认', facts.get('budget')?.basis === 'confirmed', facts.get('budget')?.value ?? '未填写')
    add('marketFact', '目标市场已确认', facts.get('targetMarket')?.basis === 'confirmed', facts.get('targetMarket')?.value ?? '未填写')
    add('candidates', `候选市场数量（≥${minMarkets}）`, doc.markets.length >= minMarkets, `${doc.markets.length}/${minMarkets}`)
    const unlinked = doc.markets.filter((market) => !market.evidenceIds?.some((evidenceId) => strong.some((entry) => entry.id === evidenceId)))
    add('marketEvidence', '每个市场有 A/B 级证据', doc.markets.length > 0 && unlinked.length === 0, unlinked.length === 0 ? '' : `${unlinked.map((market) => market.name).join('、')} 缺证据`)
    add('evidenceVolume', `A/B 级证据总量（≥${minEvidence}）`, strong.length >= minEvidence, `${strong.length}/${minEvidence}`)
    add('recommendation', `推荐结论与理由（≥${minRationale} 字）`, doc.recommendation !== null && doc.recommendation.rationale.length >= minRationale, doc.recommendation === null ? '未给出推荐' : '已给出推荐')
  }

  if (stage === 'product') {
    const minDirections = min('directions')
    const minRationale = min('rationaleChars')
    const minSpec = min('specChars')
    const minSuppliers = min('suppliers')
    const minQc = min('qcItems')
    const candidates = direction.candidates ?? []
    add('directions', `候选方向（≥${minDirections}）`, candidates.length >= minDirections, `${candidates.length}/${minDirections}`)
    const incomplete = candidates.filter((candidate) => candidate.audience === '' || candidate.problem === '')
    add('directionFields', '方向描述完整', candidates.length > 0 && incomplete.length === 0, incomplete.length === 0 ? '' : `${incomplete.length} 个方向缺人群或问题`)
    add('chosen', `选定方向与理由（≥${minRationale} 字）`, direction.chosen !== null && direction.chosen.rationale.length >= minRationale, direction.chosen?.name ?? '未选定')
    add('product', `产品定义（规格 ≥${minSpec} 字）`, text(product.name) !== '' && text(product.spec).length >= minSpec && Number.isFinite(product.price) && product.price > 0, product.name ?? '未定义')
    add('packaging', '包装与规格', text(product.packaging).length >= 10, text(product.packaging) === '' ? '未填写包装' : '已填写')
    add('suppliers', `供应商报价（≥${minSuppliers}）`, (dtc.suppliers ?? []).length >= minSuppliers, `${(dtc.suppliers ?? []).length}/${minSuppliers}`)
    const received = (dtc.samples ?? []).filter((sample) => sample.status === 'received' || sample.status === 'approved')
    add('samples', '样品已到手', received.length >= 1, `${received.length} 个已收到`)
    add('qc', `QC 清单（≥${minQc} 项）`, (dtc.qc ?? []).length >= minQc, `${(dtc.qc ?? []).length}/${minQc}`)
  }

  if (stage === 'economics') {
    const floor = min('marginFloor')
    const economics = doc.economics
    add('exists', '单位经济已建模', economics !== null && economics.kind === 'dtc', economics === null ? '未建模' : economics.kind)
    if (economics !== null) {
      const accepted = economics.riskAccepted && economics.riskNote.length >= 20
      add('margin', `广告前毛利 ≥${pct(floor)}`, economics.computed.marginBeforeAds >= floor || accepted, `${pct(economics.computed.marginBeforeAds)}${accepted ? ' · 已记录风险接受' : ''}`)
      add('roas', '盈亏平衡 ROAS 可计算', Number.isFinite(economics.computed.breakevenRoas) && economics.computed.breakevenRoas > 1, economics.computed.breakevenRoas === null ? '贡献为负' : String(economics.computed.breakevenRoas))
    }
  }

  if (stage === 'store') {
    const minPages = min('storePages')
    const minPolicies = min('storePolicies')
    const store = dtc.store ?? {}
    const pagesDone = (store.pages ?? []).filter((page) => page.done).length
    const policiesDone = (store.policies ?? []).filter((policy) => policy.done).length
    add('domain', '域名与平台', text(store.domain) !== '' && text(store.platform) !== '', `${store.domain ?? ''} / ${store.platform ?? ''}`)
    add('pages', `核心页面（≥${minPages}）`, pagesDone >= minPages, `${pagesDone}/${minPages}`)
    add('policies', `政策页（≥${minPolicies}）`, policiesDone >= minPolicies, `${policiesDone}/${minPolicies}`)
    add('payments', '支付方式 ≥1', (store.payments ?? []).length >= 1, (store.payments ?? []).join('、') || '未配置')
    add('shipping', '物流费率', (store.shippingRates ?? []).length >= 1, `${(store.shippingRates ?? []).length} 条`)
    add('pixel', '像素事件已验证', (store.pixelEvents ?? []).some((event) => event.verified), `${(store.pixelEvents ?? []).filter((event) => event.verified).length} 个已验证`)
    add('email', '邮件订阅入口', store.emailCapture === true, store.emailCapture ? '已开启' : '未开启')
  }

  if (stage === 'launch') {
    const minCreatives = min('creatives')
    const launch = dtc.launch ?? {}
    add('creatives', `素材（≥${minCreatives} 条）`, (launch.creatives ?? []).length >= minCreatives, `${(launch.creatives ?? []).length}/${minCreatives}`)
    const campaigns = launch.campaigns ?? []
    add('campaigns', '投放结构', campaigns.length >= 1 && campaigns.every((campaign) => campaign.budgetDaily > 0 && campaign.killRules.length >= 20), `${campaigns.length} 个 campaign`)
    add('tracking', '转化跟踪已验证', launch.trackingVerified === true, launch.trackingVerified ? '已验证' : '未验证')
  }

  if (stage === 'ops') {
    const minAccuracy = min('slaAccuracy')
    const minOnTime = min('slaOnTime')
    const maxHours = min('shippingPromiseHours')
    const ops = dtc.ops ?? {}
    const threePl = ops.threePl ?? {}
    add('threePl', '3PL 已选定', text(threePl.name) !== '' && text(threePl.cutoff) !== '', threePl.name ?? '未选定')
    add('sla', `SLA 达标（≥${minAccuracy}% / ${minOnTime}%）`, Number(threePl.slaAccuracy) >= minAccuracy && Number(threePl.slaOnTime) >= minOnTime, `${threePl.slaAccuracy ?? '—'}% / ${threePl.slaOnTime ?? '—'}%`)
    add('returns', '退货地址', text(threePl.returnsAddress).length >= 10, text(threePl.returnsAddress) === '' ? '未填写' : '已填写')
    add('sku', 'SKU 与条码核对', ops.skuChecked === true, ops.skuChecked ? '已核对' : '未核对')
    add('testOrder', '测试订单通过', ops.testOrder?.result === 'passed', ops.testOrder?.result ?? '未测试')
    add('cs', '客服模板 ≥3', (ops.csTemplates ?? []).length >= 3, `${(ops.csTemplates ?? []).length}/3`)
    add('shipping', `发货承诺（≤${maxHours}h）`, Number(ops.shippingPromiseHours) > 0 && Number(ops.shippingPromiseHours) <= maxHours, `${ops.shippingPromiseHours ?? '—'} 小时`)
  }

  if (stage === 'growth') {
    const minKols = min('kols')
    const growth = dtc.growth ?? {}
    const doneFlows = (growth.flows ?? []).filter((flow) => flow.done).map((flow) => flow.key)
    const missingFlows = DTC_FLOW_KEYS.filter((key) => !doneFlows.includes(key))
    add('flows', '四类自动化流程', missingFlows.length === 0, missingFlows.length === 0 ? '齐全' : `缺少：${missingFlows.join('、')}`)
    add('reviews', '评价机制', text(growth.reviews).length >= 10, text(growth.reviews) === '' ? '未填写' : '已填写')
    add('loyalty', '复购机制', text(growth.loyalty).length >= 10, text(growth.loyalty) === '' ? '未填写' : '已填写')
    add('kols', `达人名单（≥${minKols}）`, (growth.kols ?? []).length >= minKols, `${(growth.kols ?? []).length}/${minKols}`)
  }

  if (stage === 'review') {
    const minItems = min('handoffItems')
    const minCategories = min('handoffCategories')
    const review = dtc.review ?? {}
    const metrics = review.metrics ?? {}
    add('metrics', '核心指标齐全', ['cvr', 'aov', 'cac', 'roas', 'refundRate', 'inventoryTurnover'].every((key) => Number.isFinite(metrics[key])), 'CVR/AOV/CAC/ROAS/退款/周转')
    add('reorder', '补货点与安全库存', Number.isFinite(review.reorderPoint) && review.reorderPoint > 0 && Number.isFinite(review.safetyStock) && review.safetyStock >= 0, `补货点 ${review.reorderPoint ?? '—'} / 安全库存 ${review.safetyStock ?? '—'}`)
    add('nextPlan', '下一轮计划', text(review.nextPlan).length >= 20, text(review.nextPlan) === '' ? '未填写' : '已填写')
    add('handoff', `交接项（≥${minItems}）`, doc.handoff.length >= minItems, `${doc.handoff.length}/${minItems}`)
    const categories = new Set(doc.handoff.map((item) => item.category))
    add('categories', `交接覆盖（≥${minCategories} 类）`, categories.size >= minCategories, `${categories.size}/${minCategories}`)
  }

  if (stage === 'done') {
    add('completed', '项目已完成', doc.status === 'completed', `${doc.gates.filter((gate) => gate.passed).length} 道闸门已通过`)
  }

  dtcArtifactCheck(doc, stage, add)

  const passed = checks.length > 0 && checks.every((check) => check.ok)
  return {
    stage,
    stageLabel: STAGE_LABELS[stage] ?? stage,
    passed,
    checklist: checks,
    blockers: checks.filter((check) => !check.ok).map((check) => `${check.label}：${check.detail}`),
  }
}

function dtcProductMarkdown(doc, extra) {
  const dtc = doc.dtc ?? emptyDtc()
  const direction = dtc.direction ?? { candidates: [], chosen: null }
  const product = dtc.product ?? {}
  const candidates = (direction.candidates ?? [])
    .map((candidate) => `| ${candidate.name} | ${candidate.audience || '—'} | ${candidate.problem || '—'} | ${candidate.priceBand || '—'} | ${candidate.evidenceIds.length} |`)
    .join('\n')
  const qc = (dtc.qc ?? []).map((item, index) => `| ${index + 1} | ${item.item} | ${item.method || '—'} | ${item.standard || '—'} |`).join('\n')
  const samples = (dtc.samples ?? []).map((sample) => `| ${sample.sku || '—'} | ${sample.status} | ${sample.receivedAt || '—'} | ${sample.feedback || '—'} |`).join('\n')
  const suppliers = (dtc.suppliers ?? []).map((supplier) => `| ${supplier.name} | ${supplier.quote} | ${supplier.basis} | ${supplier.moq} | ${supplier.leadTimeDays} | ${supplier.sampleLeadDays ?? '—'} |`).join('\n')
  return `${header(doc, '产品与供应链')}
## 方向

| 候选 | 人群 | 问题 | 价格带 | 证据 |
|---|---|---|---|---|
${candidates || '| — | — | — | — | — |'}

**选定：** ${direction.chosen?.name ?? '未选定'}

${direction.chosen?.rationale ?? ''}

## 产品

| 项目 | 内容 |
|---|---|
| 产品名 | ${product.name || '待定'} |
| 售价 | ${product.price === null || product.price === undefined ? '待定' : money(product.price, doc.brief.currency)} |
| SKU | ${product.heroSku || '—'} |
| 规格 | ${product.spec || '待定'} |
| 包装 | ${product.packaging || '待定'} |
| 保修 | ${product.warranty || '—'} |

## 供应商

| 供应商 | 报价 | 口径 | MOQ | 交期（天） | 打样（天） |
|---|---|---|---|---|---|
${suppliers || '| — | — | — | — | — | — |'}

## 样品

| SKU | 状态 | 收到日期 | 反馈 |
|---|---|---|---|
${samples || '| — | — | — | — |'}

## QC 清单

| # | 检验项 | 方法 | 标准 |
|---|---|---|---|
${qc || '| — | — | — | — |'}

${extra}
`
}

function dtcSuppliersCsv(doc) {
  const headers = ['供应商', '链接', '报价', '口径', 'MOQ', '交期天数', '打样费', '打样天数']
  const rows = (doc.dtc?.suppliers ?? []).map((supplier) => [supplier.name, supplier.url, supplier.quote, supplier.basis, supplier.moq, supplier.leadTimeDays, supplier.sampleFee, supplier.sampleLeadDays])
  return csv(headers, rows)
}

const doneMark = (value) => (value ? '✓' : '✗')

function dtcStoreMarkdown(doc, extra) {
  const store = doc.dtc?.store ?? {}
  const pages = (store.pages ?? []).map((page) => `| ${page.key} | ${doneMark(page.done)} |`).join('\n')
  const policies = (store.policies ?? []).map((policy) => `| ${policy.key} | ${doneMark(policy.done)} |`).join('\n')
  const shipping = (store.shippingRates ?? []).map((rate) => `| ${rate.zone} | ${rate.method || '—'} | ${rate.price} | ${rate.days ?? '—'} |`).join('\n')
  const pixels = (store.pixelEvents ?? []).map((event) => `| ${event.event} | ${doneMark(event.verified)} |`).join('\n')
  return `${header(doc, '品牌与店铺')}
## 店铺

| 项目 | 内容 |
|---|---|
| 域名 | ${store.domain || '待定'} |
| 平台 | ${store.platform || '待定'} |
| 支付 | ${(store.payments ?? []).join('、') || '待配置'} |
| 邮件订阅 | ${doneMark(store.emailCapture)} |

## 页面

| 页面 | 完成 |
|---|---|
${pages || '| — | — |'}

## 政策

| 政策 | 完成 |
|---|---|
${policies || '| — | — |'}

## 物流费率

| 区域 | 方式 | 价格 | 时效（天） |
|---|---|---|---|
${shipping || '| — | — | — | — |'}

## 像素事件

| 事件 | 验证 |
|---|---|
${pixels || '| — | — |'}

${extra}
`
}

function dtcLaunchMarkdown(doc, extra) {
  const launch = doc.dtc?.launch ?? {}
  const creatives = (launch.creatives ?? []).map((creative) => `| ${creative.angle} | ${creative.hook} | ${creative.format || '—'} |`).join('\n')
  const campaigns = (launch.campaigns ?? []).map((campaign) => `| ${campaign.platform} | ${campaign.name || '—'} | ${campaign.budgetDaily} | ${campaign.adSets ?? '—'} |`).join('\n')
  const killRules = (launch.campaigns ?? []).map((campaign) => `- **${campaign.platform}**：${campaign.killRules}`).join('\n')
  return `${header(doc, '上线与投放')}
## 素材

| 角度 | 钩子 | 形式 |
|---|---|---|
${creatives || '| — | — | — |'}

## 投放结构

| 平台 | Campaign | 日预算 | 广告组 |
|---|---|---|---|
${campaigns || '| — | — | — | — |'}

## 止损规则

${killRules || '_尚未填写。_'}

转化跟踪：${doneMark(launch.trackingVerified)}

${extra}
`
}

function dtcOpsMarkdown(doc, extra) {
  const ops = doc.dtc?.ops ?? {}
  const threePl = ops.threePl ?? {}
  const templates = (ops.csTemplates ?? []).map((template) => `- ${template}`).join('\n')
  return `${header(doc, '履约与客服')}
## 3PL

| 项目 | 内容 |
|---|---|
| 服务商 | ${threePl.name || '待定'} |
| 拣货准确率 | ${threePl.slaAccuracy ?? '—'}% |
| 准时发货率 | ${threePl.slaOnTime ?? '—'}% |
| 截单时间 | ${threePl.cutoff || '—'} |
| 退货地址 | ${threePl.returnsAddress || '—'} |

## 上线检查

| 项目 | 状态 |
|---|---|
| SKU 与条码核对 | ${doneMark(ops.skuChecked)} |
| 测试订单 | ${ops.testOrder?.result ?? '未测试'} |
| 发货承诺 | ${ops.shippingPromiseHours ?? '—'} 小时 |

## 客服模板

${templates || '_尚未准备。_'}

${extra}
`
}

function dtcGrowthMarkdown(doc, extra) {
  const growth = doc.dtc?.growth ?? {}
  const flows = (growth.flows ?? []).map((flow) => `| ${flow.key} | ${doneMark(flow.done)} |`).join('\n')
  const kols = (growth.kols ?? []).map((kol) => `| ${kol.name} | ${kol.platform || '—'} | ${kol.followers ?? '—'} | ${kol.status || '—'} |`).join('\n')
  return `${header(doc, '增长与复购')}
## 自动化流程

| 流程 | 完成 |
|---|---|
${flows || '| — | — |'}

## 评价

${growth.reviews || '_尚未填写。_'}

## 复购

${growth.loyalty || '_尚未填写。_'}

## 达人

| 名称 | 平台 | 粉丝 | 状态 |
|---|---|---|---|
${kols || '| — | — | — | — |'}

${extra}
`
}

function dtcReviewMarkdown(doc, extra) {
  const review = doc.dtc?.review ?? {}
  const metrics = review.metrics ?? {}
  const rows = [
    ['CVR', metrics.cvr === undefined ? '—' : pct(metrics.cvr)],
    ['客单价', metrics.aov === undefined ? '—' : metrics.aov.toFixed(2)],
    ['CAC', metrics.cac === undefined ? '—' : metrics.cac.toFixed(2)],
    ['ROAS', metrics.roas === undefined ? '—' : metrics.roas.toFixed(2)],
    ['退款率', metrics.refundRate === undefined ? '—' : pct(metrics.refundRate)],
    ['库存周转', metrics.inventoryTurnover === undefined ? '—' : metrics.inventoryTurnover.toFixed(2)],
  ]
    .map(([label, value]) => `| ${label} | ${value} |`)
    .join('\n')
  return `${header(doc, '复盘与补货')}
## 核心指标

| 指标 | 数值 |
|---|---|
${rows}

## 补货

| 项目 | 数值 |
|---|---|
| 补货点 | ${review.reorderPoint ?? '—'} |
| 安全库存 | ${review.safetyStock ?? '—'} |

## 下一轮

${review.nextPlan || '_尚未填写。_'}

${extra}
`
}

function mandateMarkdown(doc, extra) {
  const mandate = doc.mandate
  if (mandate === null || mandate === undefined) return `${header(doc, '长期委托')}\n_尚未建立委托。使用 sourcing_mandate activate。_\n\n${extra}`
  const criteria = (mandate.successCriteria ?? [])
    .map((criterion, index) => `- [${(mandate.criteriaMet ?? []).includes(index + 1) ? 'x' : ' '}] ${criterion}`)
    .join('\n')
  const authority = mandate.authority ?? {}
  const runs = (mandate.runs ?? [])
    .slice(-20)
    .map((run) => `| ${run.at.slice(0, 10)} | ${run.stage} | ${mdEscape(run.summary)} | ${run.actions.length} | ${run.blockers[0] ? mdEscape(run.blockers[0]) : '—'} |`)
    .join('\n')
  return `${header(doc, '长期委托')}
## 委托

| 项目 | 内容 |
|---|---|
| 状态 | ${mandate.status} |
| 目标 | ${mandate.objective} |
| 周期 | ${mandate.startedAt.slice(0, 10)} → ${mandate.expiresAt} |
| 检查节奏 | 每 ${mandate.reviewCadenceDays} 天 |
| 下次检查 | ${mandate.nextReviewAt} |
| 定时任务 | ${mandate.scheduleId} |

## 成功标准

${criteria}

## 授权

| 权限 | 范围 |
|---|---|
| 研究 | ${authority.research ? '允许' : '不允许'} |
| 起草 | ${authority.drafts ? '允许' : '不允许'} |
| 对外联系 | ${authority.outreach === 'allowed' ? '允许' : authority.outreach === 'never' ? '禁止' : '需确认'} |
| 预算 | ${authority.spendLimit === null ? '未授权支出' : `${authority.currency} ${authority.spendLimit}`} |

## 近期运行

| 日期 | 阶段 | 总结 | 动作数 | 首要阻塞 |
|---|---|---|---|---|
${runs || '| — | — | — | — | — |'}

${extra}
`
}
