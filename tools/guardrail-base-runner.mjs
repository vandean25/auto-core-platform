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
  --bundle <name>    Checker bundle: spec-quality | interaction-baselines (required)

Checker arguments after -- are forwarded to the base-revision script.
`

const BUNDLES = {
  'spec-quality': {
    entry: 'tools/check-spec-quality.mjs',
    files: [
      'tools/check-spec-quality.mjs',
      'tools/spec-quality-lib.mjs',
      'tools/spec-quality-baseline-ratchet.mjs',
      'tools/parse-cli-options.mjs',
      'tools/guardrail-repo-root.mjs',
      'tools/guardrail-git-io.mjs',
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
    ],
  },
}

/** Copies a bundle file when present at base; skips files this base predates. */
function optionalBundleFiles(repoRoot, base, filePaths) {
  const present = []
  for (const file of filePaths) {
    if (readAtRevision(repoRoot, base, file) !== undefined) present.push(file)
  }
  return present
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

function materializeBundle(repoRoot, base, bundle) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-base-'))
  const files = optionalBundleFiles(repoRoot, base, bundle.files)
  for (const file of files) {
    const text = readAtRevision(repoRoot, base, file)
    if (text === undefined) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
      throw new Error(`Missing ${file} at ${base}`)
    }
    const target = path.join(tempRoot, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
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
