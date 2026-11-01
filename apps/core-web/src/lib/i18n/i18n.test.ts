import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { changeUiLanguage, i18n } from '@/lib/i18n'

describe('i18n foundation', () => {
  it('loads German common resources by default in tests', () => {
    expect(i18n.t('common:shell.loading')).toBe('Laden…')
  })

  it('uses distinct Zod email messages per active locale', async () => {
    const schema = z.string().email()

    await changeUiLanguage('de')
    const german = schema.safeParse('not-an-email')
    expect(german.success).toBe(false)
    const germanMessage = german.error?.issues[0]?.message ?? ''

    await changeUiLanguage('en')
    const english = schema.safeParse('not-an-email')
    expect(english.success).toBe(false)
    const englishMessage = english.error?.issues[0]?.message ?? ''

    expect(germanMessage).not.toBe(englishMessage)
    expect(englishMessage.toLowerCase()).toContain('email')
  })

  it('exposes glossary entries in both languages', async () => {
    await changeUiLanguage('de')
    expect(i18n.t('glossary:workshopOrder.term')).toBe('Werkstattauftrag')
    await changeUiLanguage('en')
    expect(i18n.t('glossary:workshopOrder.term')).toBe('Workshop order')
    await changeUiLanguage('de')
  })
  it('resolves API-layer keys from preloaded domain namespaces without lazy loading', () => {
    expect(i18n.t('agent:approvals.approveError')).toBe('Fehler beim Genehmigen des Vorschlags')
    expect(i18n.t('workshop:mechanic.loadQueueFailed')).toBe('Warteschlange konnte nicht geladen werden')
    expect(i18n.t('vehicleStock:sale.shorteningFailed')).toBe('Verkürzung der Gewährleistung konnte nicht gespeichert werden')
    expect(i18n.t('settings:dataImport.errors.applyFailed')).toBe('Import konnte nicht angewendet werden')
  })
})
