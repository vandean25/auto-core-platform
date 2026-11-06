/**
 * Shared baseline ratchet for the ADR-0036 interaction guards (AUT-893).
 *
 * A guard scans source into violation identities and compares them with a checked-in baseline.
 * `added` are violations the baseline does not cover (a new violation, or baseline growth that was
 * never written); `stale` are baseline entries whose violation is gone. Duplicates count, so two
 * identical violations need two baseline lines. Baseline growth against the PR base is rejected
 * separately by `tools/check-interaction-baselines.mjs`.
 */
export type GuardBaselineDocument = {
  schemaVersion: 1
  guard: string
  violations: string[]
}

export type BaselineDiff = { added: string[]; stale: string[] }

function countEntries(items: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

function subtractCounts(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): string[] {
  const result: string[] = []
  for (const [key, count] of left) {
    const extra = count - (right.get(key) ?? 0)
    for (let i = 0; i < extra; i += 1) result.push(key)
  }
  return result.sort()
}

export function diffBaseline(
  current: readonly string[],
  baseline: readonly string[],
): BaselineDiff {
  const currentCounts = countEntries(current)
  const baselineCounts = countEntries(baseline)
  return {
    added: subtractCounts(currentCounts, baselineCounts),
    stale: subtractCounts(baselineCounts, currentCounts),
  }
}
