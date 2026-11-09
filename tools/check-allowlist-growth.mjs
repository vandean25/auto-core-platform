#!/usr/bin/env node
/**
 * Rejects growth of reviewed allowlist inventories against the PR base (AUT-924).
 *
 * Exit codes: 0 no growth, 1 an allowlist grew, 2 usage/setup error.
 */
import { parseCliArgs } from './parse-cli-options.mjs'
import { checkAllowlistGrowth } from './allowlist-growth-lib.mjs'
import { defaultRepoRoot, readAtRevision, readHead, verifyRevision } from './guardrail-git-io.mjs'
import { fail, printMultisetGrowth } from './guardrail-cli.mjs'

const USAGE = `Usage: node tools/check-allowlist-growth.mjs --base <git-ref>

  --base <ref>   Revision to compare against, for example a merge-base SHA (required)
`

const ARG_SPEC = { boolean: {}, value: { '--base': 'base' }, defaults: { base: undefined } }

function main() {
  const { base } = parseCliArgs(process.argv.slice(2), ARG_SPEC, USAGE)
  if (!base) fail(`--base is required\n\n${USAGE}`, 2)
  const repoRoot = defaultRepoRoot()
  try {
    verifyRevision(repoRoot, base)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2)
  }
  const results = checkAllowlistGrowth({
    readBase: (file) => readAtRevision(repoRoot, base, file),
    readHead: (file) => readHead(repoRoot, file),
  })
  const removed = results.filter((result) => result.status === 'removed')
  if (removed.length > 0) {
    for (const result of removed) console.error(`${result.file}: removed against ${base}`)
    fail('Allowlist files must not be deleted or renamed.', 1)
  }
  const grown = results.filter((result) => result.status === 'grew')
  if (grown.length > 0) {
    printMultisetGrowth({
      label: 'allowlists',
      base,
      grown,
      exitMessage: 'Fix the violation instead of allowlisting it: an allowlist may only shrink.',
    })
  }
  console.log(`allowlist growth check passed (${results.length} inventories, none grew against ${base}).`)
}

main()
