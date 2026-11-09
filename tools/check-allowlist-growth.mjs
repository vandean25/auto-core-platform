#!/usr/bin/env node
/**
 * Rejects growth of reviewed allowlist inventories against the PR base (AUT-924).
 *
 * Exit codes: 0 no growth, 1 an allowlist grew, 2 usage/setup error.
 */
import { parseCliArgs } from './parse-cli-options.mjs'
import { checkAllowlistGrowth } from './allowlist-growth-lib.mjs'
import { assertResolvableRevision, defaultRepoRoot, readAtRevision, readHead } from './guardrail-git-io.mjs'
import { fail, printMultisetGrowth } from './guardrail-cli.mjs'

const USAGE = `Usage: node tools/check-allowlist-growth.mjs --base <git-ref>

  --base <ref>   Revision to compare against, for example a merge-base SHA (required)
`

const ARG_SPEC = { boolean: {}, value: { '--base': 'base' }, defaults: { base: undefined } }

function requireBase(argv) {
  const { base } = parseCliArgs(argv, ARG_SPEC, USAGE)
  if (!base) fail(`--base is required\n\n${USAGE}`, 2)
  return base
}

function growthResults(repoRoot, base) {
  return checkAllowlistGrowth({
    readBase: (file) => readAtRevision(repoRoot, base, file),
    readHead: (file) => readHead(repoRoot, file),
  })
}

function rejectStructuralFailures(results, base) {
  const structural = results.filter(
    (result) => result.status === 'removed' || result.status === 'unparseable',
  )
  if (structural.length === 0) return
  for (const result of structural) console.error(`${result.file}: ${result.status} against ${base}`)
  fail('Allowlist files must not be deleted, renamed, or reshaped to evade ratchet parsing.', 1)
}

function rejectAllowlistGrowth(results, base) {
  const grown = results.filter((result) => result.status === 'grew')
  if (grown.length === 0) return
  printMultisetGrowth({
    label: 'allowlists',
    base,
    grown,
    exitMessage: 'Fix the violation instead of allowlisting it: an allowlist may only shrink.',
  })
}

function runAllowlistGrowthCheck(repoRoot, base) {
  assertResolvableRevision(repoRoot, base, fail)
  const results = growthResults(repoRoot, base)
  rejectStructuralFailures(results, base)
  rejectAllowlistGrowth(results, base)
  console.log(`allowlist growth check passed (${results.length} inventories, none grew against ${base}).`)
}

function main() {
  const base = requireBase(process.argv.slice(2))
  runAllowlistGrowthCheck(defaultRepoRoot(), base)
}

main()
