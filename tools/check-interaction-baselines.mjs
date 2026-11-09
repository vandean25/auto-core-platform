#!/usr/bin/env node
/**
 * Rejects growth of the interaction-guard baselines against the PR base (AUT-893, ADR-0036).
 *
 * Exit codes: 0 no growth, 1 a baseline grew, 2 usage/setup error (for example the base ref is missing).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseCliArgs } from './parse-cli-options.mjs'
import { checkBaselineGrowth, findBaselineStructureViolations } from './interaction-baselines-lib.mjs'
import { guardrailRepoRoot } from './guardrail-repo-root.mjs'

const USAGE = `Usage: node tools/check-interaction-baselines.mjs --base <git-ref>

  --base <ref>   Revision to compare against, for example origin/main (required)
`

const ARG_SPEC = { boolean: {}, value: { '--base': 'base' }, defaults: { base: undefined } }

function fail(message, code) {
  console.error(message)
  process.exit(code)
}

function requireBase() {
  const { base } = parseCliArgs(process.argv.slice(2), ARG_SPEC, USAGE)
  if (!base) fail(`--base is required\n\n${USAGE}`, 2)
  return base
}

function verifyRevision(repoRoot, base) {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { cwd: repoRoot, stdio: 'ignore' })
  } catch {
    fail(`Cannot resolve ${base}. Fetch it first, for example: git fetch origin main`, 2)
  }
}

function readAtRevision(repoRoot, ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
}

function readHead(repoRoot, file) {
  const target = path.join(repoRoot, file)
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined
}

function printGrowth(grown, base) {
  console.error(`interaction baselines grew against ${base}:`)
  for (const result of grown) {
    console.error(`  ${result.file}`)
    for (const identity of result.growth) console.error(`    + ${identity}`)
  }
  fail('Fix the violation instead of baselining it: a baseline may only shrink.', 1)
}

function printStructure(violations, base) {
  console.error(`interaction baseline structure changed against ${base}:`)
  for (const result of violations) console.error(`  ${result.file}: ${result.status}`)
  fail('Baseline files must not be deleted, renamed, or sidestepped.', 1)
}

function main() {
  const base = requireBase()
  const repoRoot = guardrailRepoRoot()
  verifyRevision(repoRoot, base)
  const results = checkBaselineGrowth({
    readBase: (file) => readAtRevision(repoRoot, base, file),
    readHead: (file) => readHead(repoRoot, file),
  })
  const structureViolations = findBaselineStructureViolations(results)
  if (structureViolations.length > 0) printStructure(structureViolations, base)
  const grown = results.filter((result) => result.status === 'grew')
  if (grown.length > 0) printGrowth(grown, base)
  console.log(`interaction baselines check passed (${results.length} baselines, none grew against ${base}).`)
}

main()
