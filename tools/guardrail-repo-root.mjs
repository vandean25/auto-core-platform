import path from 'node:path'

/** Repository root for guardrail checks (head files, git commands). */
export function guardrailRepoRoot(fromDir = import.meta.dirname) {
  const override = process.env.GUARDRAIL_REPO_ROOT?.trim()
  if (override) return path.resolve(override)
  return path.resolve(fromDir, '..')
}
