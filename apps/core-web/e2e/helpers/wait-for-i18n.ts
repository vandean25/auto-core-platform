import type { Page } from '@playwright/test'

/** Wait until the German locale bundle for a namespace has been fetched (best-effort if already cached). */
export async function waitForDeNamespace(page: Page, namespace: string, timeout = 15_000) {
  try {
    await page.waitForResponse(
      (response) =>
        response.url().includes(`/locales/de/${namespace}.json`) && response.ok(),
      { timeout },
    )
  } catch {
    // Namespace may already be in the i18n cache from a prior navigation in this context.
  }
}
