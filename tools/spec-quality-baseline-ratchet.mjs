import fs from 'node:fs'
import path from 'node:path'
import { baselineId, describeOffender } from './spec-quality-lib.mjs'
import { readAtRevision } from './guardrail-git-io.mjs'

/** Identities the head baseline lists that the base baseline does not (multiset). */
export function findAddedBaselineEntries(baseAllowlist, headAllowlist) {
  const baseCounts = countById(baseAllowlist)
  const added = []
  for (const entry of headAllowlist) {
    const id = baselineId(entry)
    const remaining = (baseCounts.get(id) ?? 0) - 1
    if (remaining < 0) added.push(entry)
    else baseCounts.set(id, remaining)
  }
  return added
}

/**
 * Head replaced a specific offender key with '*' for the same file and rule — a broader allowlist line.
 */
export function findLoosenedBaselineEntries(baseAllowlist, headAllowlist) {
  const headByFileRule = indexHeadByFileRule(headAllowlist)
  const loosened = []
  for (const baseEntry of baseAllowlist) {
    if (baseEntry.key === '*') continue
    const headEntry = headByFileRule.get(`${baseEntry.file}\u0000${baseEntry.rule}`)
    if (headEntry?.key === '*' && baselineId(headEntry) !== baselineId(baseEntry)) {
      loosened.push({ base: baseEntry, head: headEntry })
    }
  }
  return loosened
}

function indexHeadByFileRule(headAllowlist) {
  const index = new Map()
  for (const entry of headAllowlist) index.set(`${entry.file}\u0000${entry.rule}`, entry)
  return index
}

function countById(entries) {
  const counts = new Map()
  for (const entry of entries) {
    const id = baselineId(entry)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

function loadAllowlist(repoRoot, baselinePath, ref) {
  const baselineFile = path.relative(repoRoot, baselinePath).replace(/\\/g, '/')
  const text =
    ref === undefined
      ? fs.existsSync(baselinePath)
        ? fs.readFileSync(baselinePath, 'utf8')
        : undefined
      : readAtRevision(repoRoot, ref, baselineFile)
  return text === undefined ? undefined : (JSON.parse(text).allowlist ?? [])
}

/** Returns exit code material: null when the ratchet passed, otherwise { added, loosened, base }. */
export function auditSpecQualityBaselineRatchet({ repoRoot, baselinePath, base }) {
  const headAllowlist = loadAllowlist(repoRoot, baselinePath)
  const baseAllowlist = loadAllowlist(repoRoot, baselinePath, base)
  if (headAllowlist === undefined || baseAllowlist === undefined) {
    return { error: 'spec-quality baseline missing at head or base; refusing to compare.' }
  }
  const added = findAddedBaselineEntries(baseAllowlist, headAllowlist)
  const loosened = findLoosenedBaselineEntries(baseAllowlist, headAllowlist)
  if (added.length === 0 && loosened.length === 0) return { ok: true, base }
  return { added, loosened, base }
}

export function formatSpecQualityRatchetFailure({ added, loosened, base }) {
  const lines = []
  if (added.length > 0) {
    lines.push(`spec-quality baseline grew against ${base}:`)
    for (const entry of added) lines.push(`  + ${describeOffender(entry)}`)
  }
  if (loosened.length > 0) {
    lines.push(`spec-quality baseline loosened against ${base}:`)
    for (const { base: prev, head } of loosened) {
      lines.push(`  ~ ${prev.file} [${prev.rule}]: ${JSON.stringify(prev.key)} → ${JSON.stringify(head.key)}`)
    }
  }
  lines.push('The committed allowlist may only shrink or stay exact — never grow or broaden.')
  return lines.join('\n')
}
