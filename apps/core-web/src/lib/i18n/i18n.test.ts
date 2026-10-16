import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { changeUiLanguage, i18n } from '@/lib/i18n'

describe('i18n foundation', () => {
  it('loads German common resources by default in tests', () => {
    expect(i18n.t('common:placeholders.missing')).toBe('—')
  })

  it('updates document lang and Zod messages when switching to English', async () => {
    await changeUiLanguage('en')
    expect(document.documentElement.lang).toBe('en')

    const schema = z.string().email()
    const result = schema.safeParse('not-an-email')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message.toLowerCase()).toContain('email')
    }

    await changeUiLanguage('de')
    expect(document.documentElement.lang).toBe('de')
  })

  it('exposes glossary entries in both languages', async () => {
    await changeUiLanguage('de')
    expect(i18n.t('glossary:workshopOrder')).toBe('Werkstattauftrag')
    await changeUiLanguage('en')
    expect(i18n.t('glossary:workshopOrder')).toBe('Workshop order')
    await changeUiLanguage('de')
  })
})
