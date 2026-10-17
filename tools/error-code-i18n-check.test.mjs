import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { buildRegistryModel } from './public-error-registry-lib.mjs'

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
})
