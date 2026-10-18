import { expect, test } from '@playwright/test'
import { DE_COMMON } from './helpers/de-common'
import { DE_SHELL } from './helpers/de-shell'
import { AutoCorePage } from './pom/AutoCorePage'

// The suite runs against the production bundle (vite preview), so the lazy route chunk is a hashed asset.
const dashboardModulePattern = /DashboardPage-[\w-]+\.js$/

async function expectRecoveredUi(page: import('@playwright/test').Page) {
  const updateRequired = page.getByText(DE_SHELL.errorBoundary.chunkTitle)
  const dashboardHeading = page.getByRole('heading', { level: 1, name: DE_COMMON.dashboard.title })

  await expect(updateRequired.or(dashboardHeading)).toBeVisible({ timeout: 30_000 })

  const rootText = await page.locator('#root').innerText()
  expect(rootText.trim().length).toBeGreaterThan(0)
}

test.describe('Stale chunk recovery', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route(AutoCorePage.apiRouteMatcher(/\/api\/vehicles\/pickerl-due/), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0, page: 1, pageSize: 1, pageCount: 0 } }),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher(/\/api\/vehicle-stock\/reports\/stock-age/), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], summary: { over_90_cost_basis: '0.00' } }),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/auth/session'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'test-user', email: 'test@example.com' },
          tenant: { id: 'test-tenant', name: 'Test Tenant' },
        }),
      })
    })
  })

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

    await expect(page.getByText(DE_SHELL.errorBoundary.chunkTitle)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: DE_SHELL.errorBoundary.reload })).toBeVisible()

    const rootText = await page.locator('#root').innerText()
    expect(rootText).toContain(DE_SHELL.errorBoundary.chunkTitle)
  })
})
