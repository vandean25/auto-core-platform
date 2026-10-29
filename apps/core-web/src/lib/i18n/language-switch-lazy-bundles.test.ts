import { afterEach, describe, expect, it } from 'vitest'
import { LAZY_NAMESPACES } from '@/lib/i18n/constants'
import { changeUiLanguage, ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import { stripLazyNamespacesForTest } from '@/test/lazy-namespace-test-helpers'

/**
 * AUT-718: switching the language must complete for lazily loaded namespaces too. The visible UI
 * reads those bundles, so a namespace that is missing in the new language falls back to German (the
 * fallback language) while the tab title, which only needs the preloaded `nav` bundle, is already English.
 */
function englishWorkshopTitle(): string {
  return i18n.getFixedT('en', 'workshop')('mechanic.accessDenied.title')
}

afterEach(async () => {
  await changeUiLanguage('de')
  await ensureNamespaceLoaded('workshop')
})

describe('UI language switch and lazily loaded namespaces (AUT-718)', () => {
  it('loads the English bundle for a namespace that was still loading when the language switched', async () => {
    stripLazyNamespacesForTest()
    await i18n.changeLanguage('de')

    // The workshop chunk starts loading in German and resolves while the switch to English runs.
    const pendingGermanBundle = ensureNamespaceLoaded('workshop')
    await changeUiLanguage('en')
    await pendingGermanBundle

    expect(i18n.language).toBe('en')
    expect(englishWorkshopTitle()).toBe('Office access restricted')
  })

  it('loads the English bundle for every lazy namespace during the switch', async () => {
    stripLazyNamespacesForTest()
    await i18n.changeLanguage('de')

    await changeUiLanguage('en')

    const missing = LAZY_NAMESPACES.filter((namespace) => !i18n.hasResourceBundle('en', namespace))
    expect(missing).toEqual([])
    expect(englishWorkshopTitle()).toBe('Office access restricted')
  })

  it('loads the bundle in the active language for namespaces that load after the switch', async () => {
    stripLazyNamespacesForTest()
    await i18n.changeLanguage('de')

    await changeUiLanguage('en')
    await ensureNamespaceLoaded('workshop')

    expect(englishWorkshopTitle()).toBe('Office access restricted')
  })
})
