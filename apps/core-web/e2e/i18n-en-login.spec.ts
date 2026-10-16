import { expect, test } from '@playwright/test'

import { UI_LANGUAGE_STORAGE_KEY } from '../src/lib/i18n/constants'

/**
 * Smoke test: EN resources load and `html[lang]` updates (locale bundle sanity).
 * DE remains the default for the rest of the suite; this spec opts into EN explicitly.
 */
test.describe('i18n EN locale smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/src/lib/firebase.ts*', async (route) => {
      const response = await route.fetch()
      let text = await response.text()
      text = text.replace(
        'export const firebaseConfigMissing = !hasFirebaseConfig',
        'export const firebaseConfigMissing = false',
      )
      await route.fulfill({ response, body: text })
    })

    await page.route('**/src/lib/runtime-flags.ts*', async (route) => {
      const response = await route.fetch()
      let text = await response.text()
      text = text.replace('import.meta.env.VITE_E2E_SKIP_AUTH === "true"', 'false')
      text = text.replace("import.meta.env.VITE_E2E_SKIP_AUTH === 'true'", 'false')
      await route.fulfill({ response, body: text })
    })

    await page.route('**/identitytoolkit.googleapis.com/**', async (route) => route.abort())

    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, 'en')
    }, UI_LANGUAGE_STORAGE_KEY)
  })

  test('login shell renders English resources', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })
})
