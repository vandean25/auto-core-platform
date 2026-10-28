import { describe, expect, it } from 'vitest'
import { SOURCE_LANGUAGE_CODES, TARGET_LANGUAGE_CODES, formatSourceLanguage, formatTargetLanguage } from './voice-languages'

describe('voice language names', () => {
  it('names the languages in German, not in English', () => {
    expect(formatTargetLanguage('de')).toBe('Deutsch')
    expect(formatTargetLanguage('uk')).toBe('Ukrainisch')
    expect(formatSourceLanguage('pl-PL')).toBe('Polnisch (Polen)')
    expect(formatSourceLanguage('bs-BA')).toBe('Bosnisch (Bosnien und Herzegowina)')
  })

  it('has a name for every code and shows an unknown code as it is', () => {
    for (const code of SOURCE_LANGUAGE_CODES) expect(formatSourceLanguage(code)).not.toBe(code)
    for (const code of TARGET_LANGUAGE_CODES) expect(formatTargetLanguage(code)).not.toBe(code)
    expect(formatSourceLanguage('xx-XX')).toBe('xx-XX')
    expect(formatTargetLanguage('xx')).toBe('xx')
  })

  it('has the same codes for both lists, source codes carrying the country', () => {
    expect(SOURCE_LANGUAGE_CODES.map((code) => code.split('-')[0])).toEqual([...TARGET_LANGUAGE_CODES])
  })
})
