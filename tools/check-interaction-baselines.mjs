#!/usr/bin/env node
/**
 * Rejects growth of the interaction-guard baselines against the PR base (AUT-893, ADR-0036).
 *
 * Exit codes: 0 no growth, 1 a baseline grew, 2 usage/setup error (for example the base ref is missing).
 */
import { parseCliArgs } from './parse-cli-options.mjs'
import { checkBaselineGrowth, findBaselineStructureViolations } from './interaction-baselines-lib.mjs'
import { guardrailRepoRoot } from './guardrail-repo-root.mjs'
import { fail, printMultisetGrowth } from './guardrail-cli.mjs'
import { readAtRevision, readHead, verifyRevision } from './guardrail-git-io.mjs'

const USAGE = `Usage: node tools/check-interaction-baselines.mjs --base <git-ref>

  --base <ref>   Revision to compare against, for example origin/main (required)
`

const ARG_SPEC = { boolean: {}, value: { '--base': 'base' }, defaults: { base: undefined } }

function requireBase() {
  const { base } = parseCliArgs(process.argv.slice(2), ARG_SPEC, USAGE)
  if (!base) fail(`--base is required\n\n${USAGE}`, 2)
  return base
}

function printStructure(violations, base) {
  console.error(`interaction baseline structure changed against ${base}:`)
  for (const result of violations) console.error(`  ${result.file}: ${result.status}`)
  fail('Baseline files must not be deleted, renamed, or sidestepped.', 1)
}

function main() {
  const base = requireBase()
  const repoRoot = guardrailRepoRoot()
  try {
    verifyRevision(repoRoot, base)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2)
  }
  const results = checkBaselineGrowth({
    readBase: (file) => readAtRevision(repoRoot, base, file),
    readHead: (file) => readHead(repoRoot, file),
  })
  const structureViolations = findBaselineStructureViolations(results)
  if (structureViolations.length > 0) printStructure(structureViolations, base)
  const grown = results.filter((result) => result.status === 'grew')
  if (grown.length > 0) {
    printMultisetGrowth({
      label: 'interaction baselines',
      base,
      grown,
      exitMessage: 'Fix the violation instead of baselining it: a baseline may only shrink.',
    })
  }
  console.log(`interaction baselines check passed (${results.length} baselines, none grew against ${base}).`)
}

main()
