import { expect, test } from '@playwright/test'

const dashboardModulePattern = /DashboardPage\.tsx/

async function expectRecoveredUi(page: import('@playwright/test').Page) {
  const updateRequired = page.getByText('Update Required')
  const dashboardHeading = page.getByRole('heading', { name: 'Dashboard' })

  await expect(updateRequired.or(dashboardHeading)).toBeVisible({ timeout: 30_000 })

  const rootText = await page.locator('#root').innerText()
  expect(rootText.trim().length).toBeGreaterThan(0)
}

test.describe('Stale chunk recovery', () => {
  test('recovers from a 404 lazy chunk via reload or fallback UI', async ({ page }) => {
    let chunkAttempts = 0

    await page.route(dashboardModulePattern, async (route) => {
      chunkAttempts += 1
      if (chunkAttempts <= 2) {
        await route.fulfill({ status: 404, body: 'missing chunk' })
        return
      }
      await route.continue()
    })

    await page.goto('/dashboard')
    await expectRecoveredUi(page)
  })

  test('recovers when a lazy chunk returns HTML instead of JavaScript', async ({ page }) => {
    let chunkAttempts = 0

    await page.route(dashboardModulePattern, async (route) => {
      chunkAttempts += 1
      if (chunkAttempts <= 2) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body>index</body></html>',
        })
        return
      }
      await route.continue()
    })

    await page.goto('/dashboard')
    await expectRecoveredUi(page)
  })

  test('shows GlobalErrorBoundary fallback when reload cannot help', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('acp:chunk-reload-at', String(Date.now()))
    })

    await page.route(dashboardModulePattern, async (route) => {
      await route.fulfill({ status: 404, body: 'missing chunk' })
    })

    await page.goto('/dashboard')

    await expect(page.getByText('Update Required')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Reload Application' })).toBeVisible()

    const rootText = await page.locator('#root').innerText()
    expect(rootText).toContain('Update Required')
  })
})
