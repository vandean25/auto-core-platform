#!/usr/bin/env node
/**
 * Spec-quality guard CLI (AUT-856).
 *
 * Exit codes: 0 no new offenders, 1 new offenders, 2 usage/setup error.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseCliArgs } from './parse-cli-options.mjs'
import {
  compareWithBaseline,
  describeOffender,
  findOffenders,
  loadBaseline,
  toBaselineJson,
} from './spec-quality-lib.mjs'
import {
  auditSpecQualityBaselineRatchet,
  formatSpecQualityRatchetFailure,
} from './spec-quality-baseline-ratchet.mjs'
import { verifyRevision } from './guardrail-git-io.mjs'
import { guardrailRepoRoot } from './guardrail-repo-root.mjs'

const USAGE = `Usage: node tools/check-spec-quality.mjs [options]

  --baseline <file>   Committed allowlist (default: tools/spec-quality-baseline.json)
  --root <dir>        Directory to scan (default: repo root)
  --base <ref>        Compare the baseline file against this revision; rejects growth (AUT-924)
  --write-baseline    Write every current offender to the allowlist and exit 0
`

const ARG_SPEC = {
  boolean: { '--write-baseline': 'writeBaseline' },
  value: { '--baseline': 'baselinePath', '--root': 'rootDir', '--base': 'base' },
  defaults: {
    writeBaseline: false,
    baselinePath: 'tools/spec-quality-baseline.json',
    rootDir: '.',
    base: undefined,
  },
}

function readOptions(argv) {
  const parsed = parseCliArgs(argv, ARG_SPEC, USAGE)
  const repoRoot = guardrailRepoRoot()
  return {
    ...parsed,
    repoRoot,
    baselinePath: path.resolve(repoRoot, parsed.baselinePath),
    rootDir: path.resolve(repoRoot, parsed.rootDir),
  }
}

function writeBaseline(options, offenders) {
  fs.writeFileSync(options.baselinePath, toBaselineJson(offenders))
  console.log(`spec-quality baseline written: ${offenders.length} entries`)
}

/** Fails the run on offenders the baseline does not cover. */
function compareWithCommittedBaseline(options, offenders) {
  if (!fs.existsSync(options.baselinePath)) {
    console.error('Missing baseline. Run: npm run spec-quality:check -- --write-baseline')
    process.exit(2)
  }
  const { fresh, covered } = compareWithBaseline(offenders, loadBaseline(options.baselinePath))
  if (fresh.length === 0) {
    console.log(
      `spec-quality check passed (${offenders.length} offenders found, ${covered} covered by the baseline, 0 new).`,
    )
    return
  }
  console.error(`spec-quality check failed (${fresh.length} new low-value test offender(s)):`)
  for (const offender of fresh) console.error(`  - ${describeOffender(offender)}`)
  console.error('Fix the test instead of adding it to the baseline.')
  process.exit(1)
}

function exitOnRatchetResult(result) {
  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }
  if (result.ok) {
    console.log(`spec-quality baseline ratchet passed against ${result.base}.`)
    return
  }
  console.error(formatSpecQualityRatchetFailure(result))
  process.exit(1)
}

function runBaselineRatchet(options) {
  try {
    verifyRevision(options.repoRoot, options.base)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
  exitOnRatchetResult(auditSpecQualityBaselineRatchet(options))
}

function enforceCiBaselineWrites(writeBaselineFlag) {
  if (process.env.CI === 'true' && writeBaselineFlag) {
    console.error('Refusing --write-baseline in CI.')
    process.exit(2)
  }
}

function main() {
  const options = readOptions(process.argv.slice(2))
  enforceCiBaselineWrites(options.writeBaseline)
  if (options.base) runBaselineRatchet(options)
  const offenders = findOffenders(options.rootDir)
  if (options.writeBaseline) {
    writeBaseline(options, offenders)
    return
  }
  compareWithCommittedBaseline(options, offenders)
}

main()
