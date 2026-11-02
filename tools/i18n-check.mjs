#!/usr/bin/env node
/**
 * DE/EN locale parity and usage guard (AUT-578).
 *
 * Exit codes: 0 passed, 1 validation errors, 2 usage/setup error.
 */
import { parseCliArgs } from './parse-cli-options.mjs'
import { runI18nCheck } from './i18n-check-lib.mjs'

const USAGE = `Usage: node tools/i18n-check.mjs [options]

  --fail-unused     Treat unused translation keys as errors (default: report only)
  --locales <dir>   Locales root (default: locales)
  --manifest <file> Dynamic-key manifest (default: tools/i18n-check-manifest.json)
  --scan <dir>      Frontend source root to scan (default: apps/core-web/src)
`

const ARG_SPEC = {
  boolean: { '--fail-unused': 'failOnUnused' },
  value: { '--locales': 'localesRoot', '--manifest': 'manifestPath', '--scan': 'scanRoot' },
  defaults: {
    failOnUnused: false,
    localesRoot: 'locales',
    manifestPath: 'tools/i18n-check-manifest.json',
    scanRoot: 'apps/core-web/src',
  },
}

function main() {
  const options = parseCliArgs(process.argv.slice(2), ARG_SPEC, USAGE)

  const result = runI18nCheck(options)
  for (const warning of result.warnings) {
    console.warn(warning)
  }
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(error)
    }
    process.exit(1)
  }
  console.log(
    `i18n check passed (${result.stats.namespaces} namespaces, ${result.stats.keys} keys, ${result.stats.usedKeysDetected} keys referenced in source, ${result.stats.unusedKeys} unused reported)`,
  )
}

main()
