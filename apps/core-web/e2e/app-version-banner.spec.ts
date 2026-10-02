import { test, expect } from '@playwright/test'

const E2E_BUNDLED_VERSION = 'v1.0.0-e2e'

test.describe('New version available banner', () => {
  test('shows banner when version.json reports a newer release', async ({ page }) => {
    await page.route('**/version.json**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 'v9.9.9-new-release' }),
      })
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('status')).toContainText('New version available')
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
  })

  test('does not show banner when version.json matches the bundled release', async ({ page }) => {
    await page.route('**/version.json**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: E2E_BUNDLED_VERSION }),
      })
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('status')).toHaveCount(0)
  })
})
