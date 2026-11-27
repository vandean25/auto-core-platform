import { expect, test } from '@playwright/test'
import deFinance from '../../../locales/de/finance.json' with { type: 'json' }
import { seedBankReconciliationScenario } from './bank-reconciliation.flow.support.ts'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'

const TENANT_B = {
  id: 'e2e-bank-tenant-b',
  name: 'Mandant B Autohaus',
  slug: 'mandant-b-autohaus',
}

test.describe('Bank reconciliation keyboard review flow (AUT-1004 Scenarios 2, 3 & Anti-criterion)', () => {
  test('Enter confirms top suggestion and advances focus; Undo restores transaction and ISSUED invoice; arrow keys do not confirm', async ({
    page,
    request,
  }, testInfo) => {
    const fixture = loadE2eFullstackFixture()
    const scenario = await seedBankReconciliationScenario(request, fixture)

    const confirmRequests: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/confirm')) {
        confirmRequests.push(req.url())
      }
    })

    await gotoWithReadySession(page, '/finance/bank-reconciliation')
    await expect(page.getByRole('heading', { level: 1, name: deFinance.bankReconciliation.title })).toBeVisible()
    await expect(page.getByText(scenario.invoiceNumber).first()).toBeVisible()

    // Anti-criterion & Scenario 4: arrow keys move selection without confirming anything
    const secondOption = page.getByRole('option', { name: /Zweiter Auftraggeber/i })
    await page.keyboard.press('ArrowDown')
    await expect(secondOption).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: deFinance.bankReconciliation.actions.undo })).toHaveCount(0)
    await testInfo.attach('bank-reconciliation-arrow-down-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.keyboard.press('ArrowUp')
    expect(confirmRequests).toHaveLength(0)

    const firstOption = page.getByRole('option', { name: /Max Muster/i })
    await expect(firstOption).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: deFinance.bankReconciliation.actions.confirm })).toBeEnabled()
    const confirmResponsePromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/confirm'),
      { timeout: 15_000 },
    )
    await page.keyboard.press('Enter')
    const confirmResponse = await confirmResponsePromise
    expect(
      confirmResponse.ok(),
      `POST /confirm failed: ${confirmResponse.status()} ${await confirmResponse.text()}`,
    ).toBeTruthy()

    await expect(page.getByRole('button', { name: deFinance.bankReconciliation.actions.undo })).toBeVisible()
    await expect(firstOption).toHaveCount(0)
    await expect(secondOption).toHaveAttribute('aria-selected', 'true')
    expect(confirmRequests).toHaveLength(1)

    const paidRes = await request.get(`${scenario.apiBase}/sales/invoices/${scenario.invoiceId}`, {
      headers: scenario.headers,
    })
    expect(paidRes.ok()).toBeTruthy()
    const paidInvoice = (await paidRes.json()) as { status: string }
    expect(paidInvoice.status).toBe('PAID')

    await testInfo.attach('bank-reconciliation-confirmed-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    // Scenario 3: click Undo in toast -> transaction and suggestion are back, confirm toast is dismissed, invoice is ISSUED
    await page.getByRole('button', { name: deFinance.bankReconciliation.actions.undo }).click()
    await expect(page.getByText(deFinance.bankReconciliation.toast.undone)).toBeVisible()
    await expect(
      page.getByText(
        deFinance.bankReconciliation.toast.confirmed.replace('{{invoiceNumber}}', scenario.invoiceNumber),
      ),
    ).toHaveCount(0)
    await expect(firstOption).toBeVisible()
    await expect(firstOption).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(scenario.invoiceNumber).first()).toBeVisible()
    await expect(page.getByRole('button', { name: deFinance.bankReconciliation.actions.confirm })).toBeEnabled()

    const issuedRes = await request.get(`${scenario.apiBase}/sales/invoices/${scenario.invoiceId}`, {
      headers: scenario.headers,
    })
    expect(issuedRes.ok()).toBeTruthy()
    const restoredInvoice = (await issuedRes.json()) as { status: string }
    expect(restoredInvoice.status).toBe('ISSUED')

    await testInfo.attach('bank-reconciliation-undone-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByRole('heading', { level: 1, name: deFinance.bankReconciliation.title })).toBeVisible()
    const confirmBtn = page.getByRole('button', { name: deFinance.bankReconciliation.actions.confirm })
    const ignoreBtn = page.getByRole('button', { name: deFinance.bankReconciliation.actions.ignore })
    await confirmBtn.scrollIntoViewIfNeeded()
    await expect(confirmBtn).toBeVisible()
    await expect(ignoreBtn).toBeVisible()
    await testInfo.attach('bank-reconciliation-undone-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('Anti-criterion: tenant switch clears the transaction list and undo entry', async ({
    page,
    request,
  }, testInfo) => {
    const fixture = loadE2eFullstackFixture()
    const scenario = await seedBankReconciliationScenario(request, fixture)

    let switched = false
    let lastSession: Record<string, unknown> | null = null

    await page.route('**/api/auth/me', async (route) => {
      const response = await route.fetch()
      const session = (await response.json()) as Record<string, unknown>
      lastSession = session
      const existingMemberships = Array.isArray(session.memberships)
        ? (session.memberships as Array<{ tenantId: string }>).filter((m) => m.tenantId !== TENANT_B.id)
        : []

      await route.fulfill({
        response,
        json: {
          ...session,
          memberships: [
            ...existingMemberships,
            {
              tenantId: TENANT_B.id,
              tenantName: TENANT_B.name,
              tenantSlug: TENANT_B.slug,
              role: 'OWNER',
              isActive: switched,
            },
          ],
          ...(switched
            ? {
                activeTenant: TENANT_B,
                activeRole: 'OWNER',
                bankReconciliationEnabled: true,
              }
            : {}),
        },
      })
    })

    await page.route('**/api/auth/switch-tenant', async (route) => {
      switched = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          ...lastSession,
          activeTenant: TENANT_B,
          activeRole: 'OWNER',
          bankReconciliationEnabled: true,
        },
      })
    })

    await page.route('**/api/bank-reconciliation/transactions**', async (route) => {
      if (!switched) {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { data: [], meta: { nextCursor: null, hasNextPage: false } },
      })
    })

    const session = await gotoWithReadySession(page, '/finance/bank-reconciliation')
    await expect(page.getByText(scenario.invoiceNumber).first()).toBeVisible()

    // Confirm first transaction to create an active undo entry
    await expect(page.getByRole('button', { name: deFinance.bankReconciliation.actions.confirm })).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: deFinance.bankReconciliation.actions.undo })).toBeVisible()

    // Switch tenant via sidebar
    await page.getByRole('button', { name: new RegExp(session.activeTenant.name) }).click()
    await page.getByRole('menuitem', { name: `Zu ${TENANT_B.name} wechseln` }).click()

    await expect(page.getByRole('button', { name: new RegExp(TENANT_B.name) })).toBeVisible()
    await expect(page.getByText(deFinance.bankReconciliation.emptyTitle)).toBeVisible()
    await expect(page.getByRole('option', { name: /Max Muster/i })).toHaveCount(0)
    await expect(page.getByRole('option', { name: /Zweiter Auftraggeber/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: deFinance.bankReconciliation.actions.undo })).toHaveCount(0)

    await testInfo.attach('bank-reconciliation-tenant-switch-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByText(deFinance.bankReconciliation.emptyTitle)).toBeVisible()
    await testInfo.attach('bank-reconciliation-tenant-switch-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
