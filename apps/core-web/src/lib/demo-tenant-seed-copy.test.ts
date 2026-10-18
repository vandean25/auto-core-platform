// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import enSeedMaster from '../../../../locales/en/seedMaster.json'

const GERMAN_DEMO_LEFTOVER_PATTERNS = [
  /\bUnterwegs\b/,
  /\bRegal\b/,
  /\bFahrzeugplatz\b/,
  /\bAnnahme-Check\b/,
  /\bBeleuchtung\b/,
]

describe('landing demo seed master copy (AUT-588)', () => {
  it('exposes English-only labels for the en demo tenant fixture', () => {
    const serialized = JSON.stringify(enSeedMaster)
    for (const pattern of GERMAN_DEMO_LEFTOVER_PATTERNS) {
      expect(serialized).not.toMatch(pattern)
    }
    expect(enSeedMaster.landingDemo.tenantName).toContain('Workshop')
    expect(enSeedMaster.pickerl.items.LIGHTS).toBe('Lighting')
  })

  it('matches the checked-in locales/en/seedMaster.json file', () => {
    const fromDisk = JSON.parse(
      readFileSync(resolve(process.cwd(), '../../locales/en/seedMaster.json'), 'utf8'),
    )
    expect(fromDisk).toEqual(enSeedMaster)
  })
})
