import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { GuardBaselineDocument } from './baseline-ratchet'

/**
 * Test-side helper: `UPDATE_INTERACTION_BASELINES=1 npm test --workspace=core-web -- guards`
 * rewrites a guard baseline from the current violations. Reviewers see the diff; CI rejects growth
 * against the PR base (`tools/check-interaction-baselines.mjs`).
 */
export const UPDATE_BASELINES = process.env.UPDATE_INTERACTION_BASELINES === '1'

export function writeGuardBaseline(
  directory: 'guards' | 'actions',
  fileName: string,
  guard: string,
  violations: readonly string[],
): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const target =
    directory === 'guards' ? join(here, fileName) : join(here, '../../actions', fileName)
  const document: GuardBaselineDocument = {
    schemaVersion: 1,
    guard,
    violations: [...violations].sort(),
  }
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`)
}
