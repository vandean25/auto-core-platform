import { expect, test } from '@playwright/test'
import { scanA11y } from './a11y-checkpoint.ts'
import { apiGetStatus } from './api-request.ts'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'

test.describe('Full-stack auth journey', () => {
  test('unauthenticatedOrWrongRoleRejected', async ({ page }) => {
    const fixture = loadE2eFullstackFixture()
    await gotoWithReadySession(page, '/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForFunction(() => {
      const h1 = document.querySelector('h1')
      if (!h1) return false
      let el: HTMLElement | null = h1
      while (el) {
        if (Number.parseFloat(getComputedStyle(el).opacity) < 1) return false
        el = el.parentElement
      }
      return true
    })
    await scanA11y(page, 'auth-home')

    const unauthenticated = await apiGetStatus(page, '/api/customers?pageSize=1')
    expect(unauthenticated.status()).toBe(401)

    const wrongRole = await apiGetStatus(page, '/api/agent-policy/rules', fixture.mechanicAuthToken)
    expect(wrongRole.status()).toBe(403)
  })
})
