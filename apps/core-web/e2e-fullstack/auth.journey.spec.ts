import { expect, test, type Page } from '@playwright/test'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'

async function apiGetStatus(page: Page, path: string, token?: string) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  return page.request.get(path, { headers })
}

test.describe('Full-stack auth journey', () => {
  test('unauthenticatedOrWrongRoleRejected', async ({ page }) => {
    const fixture = loadE2eFullstackFixture()
    await gotoWithReadySession(page, '/')

    const unauthenticated = await apiGetStatus(page, '/api/customers?pageSize=1')
    expect(unauthenticated.status()).toBe(401)

    const wrongRole = await apiGetStatus(page, '/api/agent-policy/rules', fixture.mechanicAuthToken)
    expect(wrongRole.status()).toBe(403)
  })
})
