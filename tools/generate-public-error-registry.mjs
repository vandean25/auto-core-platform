#!/usr/bin/env node
import { runRegistryGeneration } from './public-error-registry-lib.mjs'

const result = runRegistryGeneration()
console.log(
  `Generated public error registry (${result.codeCount} codes, ${result.publicCount} public wire codes).`,
)
console.log(`  ${result.registryPath}`)
console.log(`  ${result.codesTsPath}`)
console.log(`  locales/de/errors.json`)
console.log(`  locales/en/errors.json`)
