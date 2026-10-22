/**
 * Sourcing skills provider.
 *
 * Registers the Sourcing Agent playbooks as scoped runtime skills. The preset
 * mounts this plugin, so the catalog exists only for sessions that selected
 * the sourcing preset; the bodies are read from `skills/<name>/SKILL.md`
 * beside this module, which makes the package independent of the workspace
 * and of how the bundle was installed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'sourcing-skills'
export const inject = ['skills']

/** Playbooks shipped with the package, in catalog order. */
const SKILLS = ['sourcing', 'dtc-brand', 'export-supplier', 'market-evidence', 'opportunity-pack', 'long-term-mandate']

/**
 * Parse a `SKILL.md` file: YAML-ish frontmatter with single-line fields, then
 * the instruction body. Unknown keys are ignored; missing required keys reject
 * the file so a broken playbook never reaches the model half-parsed.
 * @param {string} text raw file content
 * @returns {{ fields: Record<string, string>, content: string } | undefined}
 */
export function parseSkill(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (match === null) return undefined
  const fields = {}
  for (const line of match[1].split('\n')) {
    const pair = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (pair === null) continue
    let value = pair[2].trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1)
    }
    fields[pair[1]] = value
  }
  if (fields.name === undefined || fields.description === undefined) return undefined
  return { fields, content: normalized.slice(match[0].length).trim() }
}

/**
 * Read the package's playbooks. A single unreadable playbook is reported and
 * skipped rather than failing the preset mount, because the remaining
 * playbooks still serve the agent.
 * @param {string} root absolute `skills` directory
 * @param {{ warn: (message: string) => void }} log host logger facade
 */
export function loadSkills(root, log) {
  const loaded = []
  for (const id of SKILLS) {
    const dir = join(root, id)
    const file = join(dir, 'SKILL.md')
    if (!existsSync(file)) {
      log.warn(`sourcing-agent: missing playbook ${file}`)
      continue
    }
    const parsed = parseSkill(readFileSync(file, 'utf8'))
    if (parsed === undefined) {
      log.warn(`sourcing-agent: invalid frontmatter in ${file}`)
      continue
    }
    if (parsed.fields.name !== id) {
      log.warn(`sourcing-agent: playbook ${id} declares name ${parsed.fields.name}`)
    }
    loaded.push({
      name: parsed.fields.name,
      description: parsed.fields.description,
      ...(parsed.fields.whenToUse === undefined ? {} : { whenToUse: parsed.fields.whenToUse }),
      content: parsed.content,
      resourceBase: { kind: 'directory', path: dir },
    })
  }
  return loaded
}

/**
 * Cordis plugin entry: register every playbook on the skill registry and
 * unregister them with the preset's fiber.
 * @param {import('@deepseek-ai/cordis').Context} ctx preset-scoped context
 */
export function apply(ctx) {
  const root = join(dirname(fileURLToPath(import.meta.url)), 'skills')
  const log = { warn: (message) => ctx.logger?.warn?.(message) }
  const skills = loadSkills(root, log)
  ctx.logger?.info?.(`sourcing-agent: registered ${skills.length} playbooks`)
  const disposers = skills.map((skill) => {
    try {
      return ctx.skills.register(skill)
    } catch (error) {
      log.warn(`sourcing-agent: cannot register ${skill.name}: ${String(error)}`)
      return undefined
    }
  })
  return () => {
    for (const dispose of disposers.reverse()) dispose?.()
  }
}
