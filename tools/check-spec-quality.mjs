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
  findAddedBaselineEntries,
  findLoosenedBaselineEntries,
} from './spec-quality-baseline-ratchet.mjs'
import { readAtRevision, verifyRevision } from './guardrail-git-io.mjs'
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

function readOptions() {
  const parsed = parseCliArgs(process.argv.slice(2), ARG_SPEC, USAGE)
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

function compareBaselineAgainstBase(options) {
  const baselineFile = path.relative(options.repoRoot, options.baselinePath).replace(/\\/g, '/')
  try {
    verifyRevision(options.repoRoot, options.base)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
  const baseText = readAtRevision(options.repoRoot, options.base, baselineFile)
  const headText = fs.existsSync(options.baselinePath)
    ? fs.readFileSync(options.baselinePath, 'utf8')
    : undefined
  if (baseText === undefined || headText === undefined) {
    console.error('spec-quality baseline missing at head or base; refusing to compare.')
    process.exit(1)
  }
  const baseAllowlist = JSON.parse(baseText).allowlist ?? []
  const headAllowlist = JSON.parse(headText).allowlist ?? []
  const added = findAddedBaselineEntries(baseAllowlist, headAllowlist)
  const loosened = findLoosenedBaselineEntries(baseAllowlist, headAllowlist)
  if (added.length === 0 && loosened.length === 0) {
    console.log(`spec-quality baseline ratchet passed against ${options.base}.`)
    return
  }
  if (added.length > 0) {
    console.error(`spec-quality baseline grew against ${options.base}:`)
    for (const entry of added) console.error(`  + ${describeOffender(entry)}`)
  }
  if (loosened.length > 0) {
    console.error(`spec-quality baseline loosened against ${options.base}:`)
    for (const { base, head } of loosened) {
      console.error(`  ~ ${base.file} [${base.rule}]: ${JSON.stringify(base.key)} → ${JSON.stringify(head.key)}`)
    }
  }
  console.error('The committed allowlist may only shrink or stay exact — never grow or broaden.')
  process.exit(1)
}

function main() {
  const options = readOptions()
  if (process.env.CI === 'true' && options.writeBaseline) {
    console.error('Refusing --write-baseline in CI.')
    process.exit(2)
  }
  if (options.base) compareBaselineAgainstBase(options)
  const offenders = findOffenders(options.rootDir)
  if (options.writeBaseline) {
    writeBaseline(options, offenders)
    return
  }
  compareWithCommittedBaseline(options, offenders)
}

main()
