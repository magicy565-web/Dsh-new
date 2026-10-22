/**
 * Offline checks for the Sourcing Agent bundle. Run with the Electron-as-node
 * runtime that also serves the Harness:
 *
 *   $env:ELECTRON_RUN_AS_NODE="1"
 *   & "<DeepSeek Harness.exe>" --expose-internals dev/validate.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const dsh = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar', 'dsh')
const requireFromDsh = createRequire(join(dsh, 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'package.json'))
const yaml = requireFromDsh('js-yaml')

const problems = []
const notes = []
const check = (condition, message) => {
  if (!condition) problems.push(message)
}

// 1. Patch structure -------------------------------------------------------
const jsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => ({ __jsExpr: data }) })
const patch = yaml.load(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'), { schema: yaml.DEFAULT_SCHEMA.extend([jsType]) })
check(Array.isArray(patch) && patch.length === 1, 'patch must be a one-entry list')
const presetRow = patch?.[0]?.insert?.[0] ?? {}
check(presetRow.id === 'preset-sourcing', 'preset row id must be preset-sourcing')
check(presetRow.name === '@deepseek-ai/dsh-agent-preset', 'preset row must mount dsh-agent-preset')

const config = presetRow.config ?? {}
check(config.id === 'sourcing', 'preset config.id must be sourcing')
check(typeof config.name === 'string' && config.name.length > 0, 'preset needs a display name')
check(typeof config.description === 'string' && config.description.length > 0, 'preset needs a description')
check(Number.isFinite(config.order), 'preset needs a numeric order')
const rows = config.plugins ?? []
check(rows.length > 10, 'preset composition looks too small')

const packageNames = new Set()
const rowIds = new Set()
const walk = (list, trail) => {
  for (const row of list) {
    check(typeof row.name === 'string' && row.name !== '', `${trail}: row ${row.id ?? '?'} has no name`)
    if (row.id !== undefined) check(!rowIds.has(row.id), `duplicate row id: ${row.id}`)
    if (row.id !== undefined) rowIds.add(row.id)
    if (row.group === true) {
      check(row.name === 'cordis:group', `${trail}: group ${row.id} must use cordis:group`)
      check(Array.isArray(row.config), `${trail}: group ${row.id} needs a config list`)
      walk(row.config ?? [], `${trail}/${row.id}`)
      continue
    }
    if (row.name.startsWith('@deepseek-ai/')) packageNames.add(row.name)
  }
}
walk(rows, 'preset')
check(packageNames.size >= 15, `expected more dsh packages, saw ${packageNames.size}`)
check(rowIds.has('sourcing-tools'), 'preset must mount the workflow tools row')
check(rowIds.has('sourcing-skills'), 'preset must mount the skills row')

// 2. Referenced packages ---------------------------------------------------
for (const name of [...packageNames].sort()) {
  const manifest = join(dsh, 'node_modules', ...name.split('/'), 'package.json')
  check(existsSync(manifest), `missing plugin package: ${name}`)
}
notes.push(`plugins: ${packageNames.size} packages, ${rowIds.size} rows`)

// 3. Playbooks -------------------------------------------------------------
const { parseSkill } = await import(pathToFileURL(join(root, 'index.js')).href)
const skillsRoot = join(root, 'skills')
const skillIds = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
for (const id of skillIds) {
  const parsed = parseSkill(readFileSync(join(skillsRoot, id, 'SKILL.md'), 'utf8'))
  check(parsed !== undefined, `playbook ${id} has invalid frontmatter`)
  if (parsed === undefined) continue
  check(parsed.fields.name === id, `playbook ${id} declares name ${parsed.fields.name}`)
  check(parsed.fields.description.length >= 20, `playbook ${id} description too short`)
  check(parsed.fields.whenToUse !== undefined, `playbook ${id} misses whenToUse`)
  check(parsed.content.length < 8192, `playbook ${id} body ${parsed.content.length} chars exceeds 8192`)
  notes.push(`${id}: ${parsed.content.length} chars`)
}
check(skillIds.includes('sourcing'), 'the sourcing workflow playbook must ship')
check(skillIds.includes('long-term-mandate'), 'the long-term mandate playbook must ship')

// 4. Skills provider -------------------------------------------------------
const registrations = []
const warnings = []
const skillsCtx = {
  logger: { warn: (message) => warnings.push(message) },
  skills: { register: (skill) => { registrations.push(skill); return () => {} } },
}
const skillsPlugin = await import(pathToFileURL(join(root, 'index.js')).href)
assert.equal(skillsPlugin.inject?.[0], 'skills')
const disposeSkills = skillsPlugin.apply(skillsCtx)
check(registrations.length === skillIds.length, `provider registered ${registrations.length}/${skillIds.length} playbooks`)
check(warnings.length === 0, `provider warnings: ${warnings.join('; ')}`)
for (const skill of registrations) check(existsSync(join(skill.resourceBase.path, 'SKILL.md')), `${skill.name}: resource base has no SKILL.md`)
assert.equal(typeof disposeSkills, 'function')
disposeSkills()

// 5. Workflow engine -------------------------------------------------------
const workflow = await import(pathToFileURL(join(root, 'workflow.js')).href)
for (const name of ['ProjectStore', 'createProject', 'evaluateGate', 'attemptAdvance', 'computeEconomics', 'writeArtifacts', 'sectionOf', 'setDtcSection', 'evaluateDtcGate', 'loadPolicy', 'setPolicyOverride', 'skipStage', 'activateMandate', 'checkinMandate', 'mandateNextActions']) {
  check(typeof workflow[name] === 'function', `workflow.js must export ${name}`)
}
check(Array.isArray(workflow.DTC_STAGES) && workflow.DTC_STAGES.length === 9, 'DTC track must define nine stages including done')
check(workflow.STAGES_BY_MODE.dtc[1] === 'product', 'DTC stage order drifted')

// Policy packs are data, not code: verify the shipped pack parses and carries
// the thresholds the gates read.
const policyPath = join(root, 'policies', 'dtc-default.json')
check(existsSync(policyPath), 'policies/dtc-default.json missing')
const policyDoc = existsSync(policyPath) ? JSON.parse(readFileSync(policyPath, 'utf8')) : {}
check(policyDoc.id === 'dtc-default' && policyDoc.version >= 2, 'policy id/version drifted')
check(policyDoc.stages?.length === 8, 'policy must list eight DTC stages')
check(policyDoc.thresholds?.suppliers === 3, 'policy suppliers threshold drifted')
check(policyDoc.artifacts?.product?.includes('suppliers'), 'policy product artifacts drifted')
const margin = workflow.computeEconomics('b2b', { unitCost: 10, packaging: 1, inlandFreight: 0.5, portHandling: 0.5, fobPrice: 16 })
check(margin.computed.grossMargin === 0.25, 'b2b gross margin formula drifted')
const dtc = workflow.computeEconomics('dtc', { price: 100, cogs: 30, freightPerUnit: 5, dutyRate: 0.1, platformFeeRate: 0.03, paymentFeeRate: 0.029, fulfillmentPerUnit: 6, returnsRate: 0.03, adCost: 20 })
check(dtc.computed.landedCost === 38.5, 'dtc landed cost formula drifted')
check(dtc.computed.contributionBeforeAds === 46.6, 'dtc contribution formula drifted')
check(dtc.computed.breakevenRoas === 2.1459, 'dtc breakeven ROAS formula drifted')

const project = workflow.createProject({ mode: 'b2b', title: '校验项目', goal: '90 天内拿到三个样品单', targetMarkets: ['DE'] })
check(project.stage === 'intake' && project.revision === 1, 'new project must start at intake')
check(workflow.evaluateGate(project, 'intake').passed === false, 'empty project must not pass intake')

// 6. Tools -----------------------------------------------------------------
const store = new workflow.ProjectStore({ dir: mkdtempSync(join(tmpdir(), 'sourcing-validate-')) })
const { toolDefinitions } = await import(pathToFileURL(join(root, 'tools.js')).href)
const tools = toolDefinitions(store)
check(tools.length === 13, `expected 13 sourcing tools, saw ${tools.length}`)
const names = new Set()
for (const tool of tools) {
  check(typeof tool.name === 'string' && tool.name.startsWith('sourcing_'), `${tool.name}: bad tool name`)
  check(!names.has(tool.name), `duplicate tool name ${tool.name}`)
  names.add(tool.name)
  check(typeof tool.description === 'string' && tool.description.length >= 80, `${tool.name}: description too short`)
  check(tool.parameters?.type === 'object', `${tool.name}: parameters must be an object schema`)
  check(typeof tool.execute === 'function', `${tool.name}: execute missing`)
  for (const required of tool.parameters?.required ?? []) {
    check(tool.parameters.properties?.[required] !== undefined, `${tool.name}: required ${required} has no property`)
  }
}
check(names.has('sourcing_stage'), 'missing sourcing_stage')
check(names.has('sourcing_render'), 'missing sourcing_render')
check(names.has('sourcing_dtc'), 'missing sourcing_dtc')
check(names.has('sourcing_policy'), 'missing sourcing_policy')
check(names.has('sourcing_mandate'), 'missing sourcing_mandate')
check(names.has('sourcing_evidence'), 'missing sourcing_evidence')

const registered = []
const toolsCtx = {
  logger: { info: () => {} },
  effect: (fn) => { fn(); return () => {} },
  tools: { register: (definition) => { registered.push(definition); return () => {} } },
}
const toolsPlugin = await import(pathToFileURL(join(root, 'tools.js')).href)
assert.equal(toolsPlugin.inject?.[0], 'tools')
toolsPlugin.apply(toolsCtx, { dataDir: join(tmpdir(), 'sourcing-validate-toolstore') })
check(registered.length === tools.length, `apply registered ${registered.length}/${tools.length} tools`)
check(registered.every((definition) => definition.output !== undefined), 'every tool needs an output renderer')
notes.push(`tools: ${tools.length}`)

// 7. Bundle manifest -------------------------------------------------------
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
check(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'manifest must declare the bundle patch')
check(manifest.exports?.['./tools'] === './tools.js', 'manifest must export ./tools')
for (const key of ['index.js', 'tools.js', 'workflow.js']) check(existsSync(join(root, key)), `${key} missing`)
for (const locale of ['en', 'zh']) {
  const parsed = JSON.parse(readFileSync(join(root, 'locale', `${locale}.json`), 'utf8'))
  check(typeof parsed.meta?.title === 'string' && parsed.meta.title.length > 0, `locale ${locale}: meta.title missing`)
  check(typeof parsed.meta?.description === 'string', `locale ${locale}: meta.description missing`)
}
try {
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
} catch (error) {
  problems.push(`package.json is not valid JSON: ${String(error)}`)
}
rmSync(store.dir, { recursive: true, force: true })

if (problems.length > 0) {
  console.error('FAIL')
  for (const problem of problems) console.error(` - ${problem}`)
  process.exit(1)
}
console.log('OK')
for (const note of notes) console.log(` - ${note}`)
