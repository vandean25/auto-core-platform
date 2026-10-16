#!/usr/bin/env node
/**
 * DE/EN locale parity and usage guard (AUT-578).
 *
 * Exit codes: 0 passed, 1 validation errors, 2 usage/setup error.
 */
import { runI18nCheck } from './i18n-check-lib.mjs'

const USAGE = `Usage: node tools/i18n-check.mjs [options]

  --fail-unused     Treat unused translation keys as errors (default: report only)
  --locales <dir>   Locales root (default: locales)
  --manifest <file> Dynamic-key manifest (default: tools/i18n-check-manifest.json)
  --scan <dir>      Frontend source root to scan (default: apps/core-web/src)
`

function parseArgs(argv) {
  const options = {
    failOnUnused: false,
    localesRoot: 'locales',
    manifestPath: 'tools/i18n-check-manifest.json',
    scanRoot: 'apps/core-web/src',
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${arg} needs a value`)
      }
      index += 1
      return next
    }
    switch (arg) {
      case '--fail-unused':
        options.failOnUnused = true
        break
      case '--locales':
        options.localesRoot = value()
        break
      case '--manifest':
        options.manifestPath = value()
        break
      case '--scan':
        options.scanRoot = value()
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new Error(`unknown argument: ${arg}\n\n${USAGE}`)
    }
  }
  return options
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }

  if (options.help) {
    console.log(USAGE)
    process.exit(0)
  }

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
