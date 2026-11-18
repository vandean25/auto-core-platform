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

  it('fails when a string under a reasons or blockers object exceeds 60 visible chars in DE or EN', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-reasons-'))
    const locales = path.join(root, 'locales')
    fs.mkdirSync(path.join(locales, 'de'), { recursive: true })
    fs.mkdirSync(path.join(locales, 'en'), { recursive: true })
    const longDe = 'a'.repeat(61)
    const longEn = 'b'.repeat(62)
    fs.writeFileSync(
      path.join(locales, 'de', 'workshop.json'),
      JSON.stringify({ tyreMeasurement: { reasons: { TOO_LONG: longDe } }, blockedSection: { blockers: { OK: 'Kurz' } } }),
    )
    fs.writeFileSync(
      path.join(locales, 'en', 'workshop.json'),
      JSON.stringify({ tyreMeasurement: { reasons: { TOO_LONG: 'Short' } }, blockedSection: { blockers: { OK: longEn } } }),
    )
    fs.mkdirSync(path.join(root, 'apps/core-web/src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'tools/i18n-check-manifest.json'),
      JSON.stringify({ treatNamespaceAsUsed: ['workshop'], usedKeyPrefixes: [], usedKeys: [] }),
    )

    const result = runI18nCheck({
      localesRoot: path.join(root, 'locales'),
      manifestPath: path.join(root, 'tools/i18n-check-manifest.json'),
      scanRoot: path.join(root, 'apps/core-web/src'),
    })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((m) => m.includes('locales/de/workshop.json') && m.includes('tyreMeasurement.reasons.TOO_LONG') && m.includes('61')))
    assert.ok(result.errors.some((m) => m.includes('locales/en/workshop.json') && m.includes('blockedSection.blockers.OK') && m.includes('62')))
  })

  it('passes when long strings sit outside reasons/blockers objects or are plain labels named reasons/blockers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-nonreasons-'))
    const locales = path.join(root, 'locales')
    fs.mkdirSync(path.join(locales, 'de'), { recursive: true })
    fs.mkdirSync(path.join(locales, 'en'), { recursive: true })
    const hint = 'h'.repeat(200)
    const label = 'l'.repeat(80)
    fs.writeFileSync(
      path.join(locales, 'de', 'common.json'),
      JSON.stringify({ hint, preview: { blockers: label }, reasons: label }),
    )
    fs.writeFileSync(
      path.join(locales, 'en', 'common.json'),
      JSON.stringify({ hint, preview: { blockers: label }, reasons: label }),
    )
    fs.mkdirSync(path.join(root, 'apps/core-web/src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'tools/i18n-check-manifest.json'),
      JSON.stringify({ treatNamespaceAsUsed: ['common'], usedKeyPrefixes: [], usedKeys: [] }),
    )

    const result = runI18nCheck({
      localesRoot: path.join(root, 'locales'),
      manifestPath: path.join(root, 'tools/i18n-check-manifest.json'),
      scanRoot: path.join(root, 'apps/core-web/src'),
    })
    assert.equal(result.ok, true, result.errors.join('\n'))
  })

  it('excludes {{placeholders}} when counting visible characters in status reasons', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-placeholders-'))
    const locales = path.join(root, 'locales')
    fs.mkdirSync(path.join(locales, 'de'), { recursive: true })
    fs.mkdirSync(path.join(locales, 'en'), { recursive: true })
    const exactly60 = `${'a'.repeat(55)}{{value}}${'b'.repeat(5)}`
    const over60 = `${'a'.repeat(56)}{{value}}${'b'.repeat(5)}`
    fs.writeFileSync(
      path.join(locales, 'de', 'workshop.json'),
      JSON.stringify({ reasons: { EXACT: exactly60, OVER: over60 } }),
    )
    fs.writeFileSync(
      path.join(locales, 'en', 'workshop.json'),
      JSON.stringify({ reasons: { EXACT: exactly60, OVER: 'Short {{value}}' } }),
    )
    fs.mkdirSync(path.join(root, 'apps/core-web/src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'tools/i18n-check-manifest.json'),
      JSON.stringify({ treatNamespaceAsUsed: ['workshop'], usedKeyPrefixes: [], usedKeys: [] }),
    )

    const result = runI18nCheck({
      localesRoot: path.join(root, 'locales'),
      manifestPath: path.join(root, 'tools/i18n-check-manifest.json'),
      scanRoot: path.join(root, 'apps/core-web/src'),
    })
    assert.equal(result.ok, false)
    assert.equal(result.errors.filter((m) => m.includes('EXACT')).length, 0)
    assert.ok(result.errors.some((m) => m.includes('reasons.OVER') && m.includes('61')))
  })
})

