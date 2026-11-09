import { baselineId } from './spec-quality-lib.mjs'

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
