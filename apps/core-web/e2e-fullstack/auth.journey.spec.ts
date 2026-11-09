import { expect, test } from '@playwright/test'
import { apiGetStatus } from './api-request.ts'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'

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
