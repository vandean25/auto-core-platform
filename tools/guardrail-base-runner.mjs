#!/usr/bin/env node
/**
 * Runs a guardrail checker script from the merge-base revision so a PR cannot weaken the judge (AUT-924).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCliArgs } from './parse-cli-options.mjs'
import { readAtRevision, verifyRevision } from './guardrail-git-io.mjs'
import { guardrailRepoRoot } from './guardrail-repo-root.mjs'

const USAGE = `Usage: node tools/guardrail-base-runner.mjs --base <ref> --bundle <name> [-- <checker-args...>]

  --base <ref>       Revision to read checker sources from, for example a merge-base SHA (required)
  --bundle <name>    Checker bundle: spec-quality | interaction-baselines | allowlist-growth (required)

Checker arguments after -- are forwarded to the base-revision script.
`

/** Files required to bootstrap this runner from the merge-base revision (listed in CI). */
export const RUNNER_SELF_FILES = [
  'tools/guardrail-base-runner.mjs',
  'tools/parse-cli-options.mjs',
  'tools/guardrail-git-io.mjs',
  'tools/guardrail-repo-root.mjs',
]

export const BUNDLES = {
  'spec-quality': {
    entry: 'tools/check-spec-quality.mjs',
    files: [
      'tools/check-spec-quality.mjs',
      'tools/spec-quality-lib.mjs',
      'tools/spec-quality-baseline-ratchet.mjs',
      'tools/parse-cli-options.mjs',
      'tools/guardrail-repo-root.mjs',
      'tools/guardrail-git-io.mjs',
      'tools/guardrail-cli.mjs',
    ],
  },
  'interaction-baselines': {
    entry: 'tools/check-interaction-baselines.mjs',
    files: [
      'tools/check-interaction-baselines.mjs',
      'tools/interaction-baselines-lib.mjs',
      'tools/parse-cli-options.mjs',
      'tools/guardrail-repo-root.mjs',
      'tools/guardrail-git-io.mjs',
      'tools/guardrail-cli.mjs',
    ],
  },
  'allowlist-growth': {
    entry: 'tools/check-allowlist-growth.mjs',
    files: [
      'tools/check-allowlist-growth.mjs',
      'tools/allowlist-growth-lib.mjs',
      'tools/recipient-allowlist-exports.mjs',
      'tools/system-prisma-service-getters.mjs',
      'tools/interaction-baselines-lib.mjs',
      'tools/parse-cli-options.mjs',
      'tools/guardrail-repo-root.mjs',
      'tools/guardrail-git-io.mjs',
      'tools/guardrail-cli.mjs',
    ],
  },
}

const ARG_SPEC = {
  boolean: {},
  value: { '--base': 'base', '--bundle': 'bundle' },
  defaults: { base: undefined, bundle: undefined },
}

function splitAtSeparator(argv) {
  const separator = argv.indexOf('--')
  if (separator === -1) return { flags: argv, checkerArgs: [] }
  return { flags: argv.slice(0, separator), checkerArgs: argv.slice(separator + 1) }
}

function requireBundleFilesAtBase(repoRoot, base, bundle) {
  const entryText = readAtRevision(repoRoot, base, bundle.entry)
  if (entryText === undefined) {
    throw new Error(`Bundle entry ${bundle.entry} missing at ${base}`)
  }
  const missing = bundle.files.filter((file) => readAtRevision(repoRoot, base, file) === undefined)
  if (missing.length > 0) {
    throw new Error(`Bundle incomplete at ${base}: missing ${missing.join(', ')}`)
  }
  return bundle.files
}

function linkRepoNodeModules(tempRoot, repoRoot) {
  const repoNodeModules = path.join(repoRoot, 'node_modules')
  if (!fs.existsSync(repoNodeModules)) return
  const linkTarget = path.join(tempRoot, 'node_modules')
  fs.symlinkSync(repoNodeModules, linkTarget, 'dir')
}

function materializeBundle(repoRoot, base, bundle) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-base-'))
  const files = requireBundleFilesAtBase(repoRoot, base, bundle)
  for (const file of files) {
    const text = readAtRevision(repoRoot, base, file)
    const target = path.join(tempRoot, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  linkRepoNodeModules(tempRoot, repoRoot)
  return { tempRoot, entry: path.join(tempRoot, bundle.entry) }
}

export function runCheckerAtBaseRevision({ repoRoot, base, bundleName, checkerArgs }) {
  const bundle = BUNDLES[bundleName]
  if (!bundle) throw new Error(`Unknown bundle: ${bundleName}`)
  verifyRevision(repoRoot, base)
  const { tempRoot, entry } = materializeBundle(repoRoot, base, bundle)
  try {
    return execFileSync(process.execPath, [entry, ...checkerArgs], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, GUARDRAIL_REPO_ROOT: repoRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function main() {
  const { flags, checkerArgs } = splitAtSeparator(process.argv.slice(2))
  const { base, bundle } = parseCliArgs(flags, ARG_SPEC, USAGE)
  if (!base || !bundle) {
    console.error(`--base and --bundle are required\n\n${USAGE}`)
    process.exit(2)
  }
  const repoRoot = guardrailRepoRoot()
  try {
    const output = runCheckerAtBaseRevision({
      repoRoot,
      base,
      bundleName: bundle,
      checkerArgs,
    })
    if (output) process.stdout.write(output)
  } catch (error) {
    if (error.stdout) process.stdout.write(String(error.stdout))
    if (error.stderr) process.stderr.write(String(error.stderr))
    process.exit(typeof error.status === 'number' ? error.status : 1)
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) main()
