import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  collectLeafKeys,
  interpolationVariables,
  pluralFamilies,
  runI18nCheck,
  splitPluralLeafKey,
} from './i18n-check-lib.mjs'

describe('i18n-check-lib', () => {
  it('collects nested leaf keys', () => {
    assert.deepEqual(collectLeafKeys({ a: { b: 'x', c: 1 } }), ['a.b', 'a.c'])
  })

  it('detects interpolation variables', () => {
    assert.deepEqual(interpolationVariables('Hello {{name}} and {{count}}'), ['count', 'name'])
  })

  it('groups i18next plural suffixes', () => {
    assert.deepEqual(splitPluralLeafKey('relative.minutesAgo_one'), {
      base: 'relative.minutesAgo',
      plural: 'one',
    })
    assert.deepEqual(pluralFamilies(['relative.minutesAgo_one', 'relative.minutesAgo_other']), new Map([
      ['relative.minutesAgo', new Set(['one', 'other'])],
    ]))
  })

  it('fails on missing EN keys in fixtures', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-'))
    const locales = path.join(root, 'locales')
    fs.mkdirSync(path.join(locales, 'de'), { recursive: true })
    fs.mkdirSync(path.join(locales, 'en'), { recursive: true })
    fs.writeFileSync(
      path.join(locales, 'de', 'common.json'),
      JSON.stringify({ onlyDe: 'Hallo' }),
    )
    fs.writeFileSync(path.join(locales, 'en', 'common.json'), JSON.stringify({ other: 'Hi' }))
    fs.mkdirSync(path.join(root, 'apps/core-web/src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'tools/i18n-check-manifest.json'),
      JSON.stringify({ treatNamespaceAsUsed: [], usedKeyPrefixes: [], usedKeys: [] }),
    )

    const result = runI18nCheck({
      localesRoot: path.join(root, 'locales'),
      manifestPath: path.join(root, 'tools/i18n-check-manifest.json'),
      scanRoot: path.join(root, 'apps/core-web/src'),
    })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((message) => message.includes('Missing en translation for common:onlyDe')))
    assert.ok(result.errors.some((message) => message.includes('Missing de translation for common:other')))
  })
})
