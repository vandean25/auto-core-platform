import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import {
  buildRegistryModel,
  extractCodeMessagePairs,
} from './public-error-registry-lib.mjs'

describe('error-code i18n check', () => {
  it('passes on generated registry and locale files', () => {
    execSync('node tools/generate-public-error-registry.mjs', {
      cwd: path.resolve(import.meta.dirname, '..'),
      stdio: 'pipe',
    })
    execSync('node tools/error-code-i18n-check.mjs', {
      cwd: path.resolve(import.meta.dirname, '..'),
      stdio: 'pipe',
    })
  })

  it('buildRegistryModel covers client-safe codes', () => {
    const model = buildRegistryModel()
    assert.ok(model.codes.ACTIVE_SITE_REQUIRED)
    assert.equal(model.codes.ACTIVE_SITE_REQUIRED.public, true)
    assert.ok(model.messages.de.get('CHECK_IN_EXISTS'))
    assert.ok(model.messages.en.get('CHECK_IN_EXISTS'))
  })

  it('pairs code and message inside the same HttpException object', () => {
    const file = path.join(
      import.meta.dirname,
      '../apps/core-api/src/document-branding/openrouter-document-branding-extraction-provider.ts',
    )
    const pairs = extractCodeMessagePairs(fs.readFileSync(file, 'utf8'))
    assert.equal(pairs.get('BRAND_EXTRACTION_FAILED'), 'Letterhead extraction failed.')
    assert.equal(
      pairs.get('BRAND_EXTRACTION_ATTEMPT_TIMEOUT'),
      'Letterhead extraction timed out.',
    )
    assert.equal(
      pairs.get('BRAND_EXTRACTION_PROVIDER_RATE_LIMIT'),
      'The letterhead extraction provider is rate limited.',
    )
  })
})
