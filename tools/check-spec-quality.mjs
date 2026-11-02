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

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const USAGE = `Usage: node tools/check-spec-quality.mjs [options]

  --baseline <file>   Committed allowlist (default: tools/spec-quality-baseline.json)
  --root <dir>        Directory to scan (default: repo root)
  --write-baseline    Write every current offender to the allowlist and exit 0
`

const ARG_SPEC = {
  boolean: { '--write-baseline': 'writeBaseline' },
  value: { '--baseline': 'baselinePath', '--root': 'rootDir' },
  defaults: {
    writeBaseline: false,
    baselinePath: 'tools/spec-quality-baseline.json',
    rootDir: '.',
  },
}

function readOptions() {
  const parsed = parseCliArgs(process.argv.slice(2), ARG_SPEC, USAGE)
  return {
    ...parsed,
    baselinePath: path.resolve(REPO_ROOT, parsed.baselinePath),
    rootDir: path.resolve(REPO_ROOT, parsed.rootDir),
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

function main() {
  const options = readOptions()
  const offenders = findOffenders(options.rootDir)
  if (options.writeBaseline) {
    writeBaseline(options, offenders)
    return
  }
  compareWithCommittedBaseline(options, offenders)
}

main()
