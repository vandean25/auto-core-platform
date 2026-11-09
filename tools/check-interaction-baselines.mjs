#!/usr/bin/env node
/**
 * Rejects growth of the interaction-guard baselines against the PR base (AUT-893, ADR-0036).
 *
 * Exit codes: 0 no growth, 1 a baseline grew, 2 usage/setup error (for example the base ref is missing).
 */
import { parseCliArgs } from './parse-cli-options.mjs'
import { checkBaselineGrowth, findBaselineStructureViolations } from './interaction-baselines-lib.mjs'
import { guardrailRepoRoot } from './guardrail-repo-root.mjs'
import { fail, parseRequiredBase, printMultisetGrowth } from './guardrail-cli.mjs'
import { assertResolvableRevision, readAtRevision, readHead } from './guardrail-git-io.mjs'

const USAGE = `Usage: node tools/check-interaction-baselines.mjs --base <git-ref>

  --base <ref>   Revision to compare against, for example origin/main (required)
`

const ARG_SPEC = { boolean: {}, value: { '--base': 'base' }, defaults: { base: undefined } }

function printStructure(violations, base) {
  console.error(`interaction baseline structure changed against ${base}:`)
  for (const result of violations) console.error(`  ${result.file}: ${result.status}`)
  fail('Baseline files must not be deleted, renamed, or sidestepped.', 1)
}

function interactionGrowthResults(repoRoot, base) {
  return checkBaselineGrowth({
    readBase: (file) => readAtRevision(repoRoot, base, file),
    readHead: (file) => readHead(repoRoot, file),
  })
}

function rejectStructureViolations(results, base) {
  const structureViolations = findBaselineStructureViolations(results)
  if (structureViolations.length > 0) printStructure(structureViolations, base)
}

function rejectInteractionGrowth(results, base) {
  const grown = results.filter((result) => result.status === 'grew')
  if (grown.length === 0) return
  printMultisetGrowth({
    label: 'interaction baselines',
    base,
    grown,
    exitMessage: 'Fix the violation instead of baselining it: a baseline may only shrink.',
  })
}

function runInteractionBaselineCheck(repoRoot, base) {
  assertResolvableRevision(repoRoot, base, fail)
  const results = interactionGrowthResults(repoRoot, base)
  rejectStructureViolations(results, base)
  rejectInteractionGrowth(results, base)
  console.log(`interaction baselines check passed (${results.length} baselines, none grew against ${base}).`)
}

function main() {
  runInteractionBaselineCheck(
    guardrailRepoRoot(),
    parseRequiredBase(process.argv.slice(2), ARG_SPEC, USAGE),
  )
}

main()
