import { expect, test } from '@playwright/test'
import { apiGetStatus } from './api-request.ts'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'

test.describe('Full-stack tenant isolation journey', () => {
  test('tenantACannotReadTenantB', async ({ page }) => {
    const fixture = loadE2eFullstackFixture()
    await gotoWithReadySession(page, '/')

    const foreignCustomer = await apiGetStatus(
      page,
      `/api/customers/${fixture.otherTenantCustomerId}`,
      fixture.authToken,
    )
    expect(foreignCustomer.status()).toBe(404)

    const foreignList = await apiGetStatus(
      page,
      `/api/customers?pageSize=200`,
      fixture.otherTenantAuthToken,
    )
    expect(foreignList.ok()).toBeTruthy()
    const body = (await foreignList.json()) as { data: Array<{ id: string }> }
    expect(body.data.map((row) => row.id)).not.toContain(fixture.customerId)
  })
})
