/**
 * Baseline growth check for the ADR-0036 interaction guards (AUT-893).
 *
 * The vitest guards fail on a new violation and on a stale baseline entry, but a PR that adds a
 * violation AND its baseline entry would pass them. This check compares each checked-in baseline with
 * the PR base and rejects any identity the head has more of. A baseline file that does not exist on the
 * base is a guard being activated by this change and is not compared.
 */
const CORE_WEB_SRC = 'apps/core-web/src/features'

const violationsOf = (document) => document.violations ?? []

/** Every baseline the interaction guards ratchet, with the way it lists its violation identities. */
export const INTERACTION_BASELINES = [
  { file: `${CORE_WEB_SRC}/actions/registry-parity.baseline.json`, identities: (document) => document },
  { file: `${CORE_WEB_SRC}/actions/registry-parity.shortcuts.baseline.json`, identities: violationsOf },
  { file: `${CORE_WEB_SRC}/interaction/guards/mutation-classification.baseline.json`, identities: violationsOf },
  { file: `${CORE_WEB_SRC}/interaction/guards/intent-prefetch.baseline.json`, identities: violationsOf },
  { file: `${CORE_WEB_SRC}/interaction/guards/transition-duration.baseline.json`, identities: violationsOf },
  {
    file: `${CORE_WEB_SRC}/interaction/mutation-key.baseline.json`,
    identities: (document) => document.missingMutationKey ?? [],
  },
  {
    file: `${CORE_WEB_SRC}/interaction/unmigrated-optimistic-consumers.baseline.json`,
    identities: (document) =>
      (document.entries ?? []).map((entry) => `${entry.operationId}::${entry.owningHook}`),
  },
]

function countEntries(items) {
  const counts = new Map()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

/** Identities the head baseline lists more often than the base baseline (multiset difference). */
export function findBaselineGrowth(baseIdentities, headIdentities) {
  const baseCounts = countEntries(baseIdentities)
  const growth = []
  for (const [identity, count] of countEntries(headIdentities)) {
    for (let extra = count - (baseCounts.get(identity) ?? 0); extra > 0; extra -= 1) {
      growth.push(identity)
    }
  }
  return growth.sort()
}

/**
 * Compares every baseline with its base version. `readBase` and `readHead` return the file text, or
 * undefined when the file does not exist at that revision.
 */
export function checkBaselineGrowth({ readBase, readHead, baselines = INTERACTION_BASELINES }) {
  const results = []
  for (const { file, identities } of baselines) {
    const headText = readHead(file)
    const baseText = readBase(file)
    if (headText === undefined) {
      results.push({ file, status: 'removed', growth: [] })
    } else if (baseText === undefined) {
      results.push({ file, status: 'activated', growth: [] })
    } else {
      const growth = findBaselineGrowth(
        identities(JSON.parse(baseText)),
        identities(JSON.parse(headText)),
      )
      results.push({ file, status: growth.length > 0 ? 'grew' : 'ok', growth })
    }
  }
  return results
}
