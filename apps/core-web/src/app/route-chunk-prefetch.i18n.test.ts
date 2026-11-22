import i18next from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

describe('route-chunk-prefetch real initI18n timing', () => {
  afterEach(() => {
    vi.doUnmock('i18next')
    vi.doUnmock('./lazy-app-pages')
    vi.resetModules()
  })

  it('starts the route chunk import immediately and loads the lazy namespace only after real initI18n resolves', async () => {
    vi.resetModules()
    const freshI18n = i18next.createInstance()
    const loadPurchaseOrderList = vi.fn(() => Promise.resolve({ default: () => null }))

    vi.doMock('i18next', () => ({ default: freshI18n }))
    vi.doMock('./lazy-app-pages', async (original) => ({
      ...(await original<typeof import('./lazy-app-pages')>()),
      loadPurchaseOrderList,
    }))

    const { preloadRouteForPathname } = await import('./route-chunk-prefetch')
    const { initI18n } = await import('@/lib/i18n/init-i18n')

    expect(freshI18n.isInitialized).toBeFalsy()
    expect(freshI18n.language).toBeUndefined()

    // Runs at module-scope timing before I18nProvider calls initI18n.
    preloadRouteForPathname(APP_ROUTE_PATHS.purchaseOrders)

    expect(loadPurchaseOrderList).toHaveBeenCalledTimes(1)
    expect(freshI18n.hasResourceBundle?.('de', 'finance')).toBeFalsy()

    // Real initI18n resolves, then the deferred ensureNamespaceLoaded('finance') completes cleanly.
    await initI18n({ language: 'de' })

    await vi.waitFor(() => {
      expect(freshI18n.hasResourceBundle('de', 'finance')).toBe(true)
    })
  })
})
