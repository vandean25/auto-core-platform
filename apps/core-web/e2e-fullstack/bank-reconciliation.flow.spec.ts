import { expect, test } from '@playwright/test'
import deFinance from '../../../locales/de/finance.json' with { type: 'json' }
import { seedBankReconciliationScenario } from './bank-reconciliation.flow.support.ts'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'

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

    // Anti-criterion: loading, scrolling and arrow keys create no confirm request
    const secondOption = page.getByRole('option', { name: /Zweiter Auftraggeber/i })
    await page.keyboard.press('ArrowDown')
    await expect(secondOption).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowUp')
    expect(confirmRequests).toHaveLength(0)

    const firstOption = page.getByRole('option', { name: /Max Muster/i })
    await expect(firstOption).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: deFinance.bankReconciliation.actions.confirm })).toBeVisible()
    const diag = await page.evaluate(() => ({
      activeTag: document.activeElement?.tagName ?? null,
      activeRole: document.activeElement?.getAttribute('role') ?? null,
      dialogs: document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length,
    }))
    const confirmResponsePromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/confirm'),
      { timeout: 15_000 },
    )
    await page.keyboard.press('Enter')
    const confirmResponse = await confirmResponsePromise.catch((err) => {
      throw new Error(`POST /confirm did not fire (diag=${JSON.stringify(diag)}): ${String(err)}`)
    })
    expect(
      confirmResponse.ok(),
      `POST /confirm failed: ${confirmResponse.status()} ${await confirmResponse.text()}`,
    ).toBeTruthy()

    await expect(page.getByRole('button', { name: deFinance.bankReconciliation.actions.undo })).toBeVisible()
    await expect(page.getByRole('option', { name: /Zweiter Auftraggeber/i })).toHaveAttribute('aria-selected', 'true')
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

    // Scenario 3: click Undo in toast -> transaction is back and invoice is ISSUED
    await page.getByRole('button', { name: deFinance.bankReconciliation.actions.undo }).click()
    await expect(page.getByRole('option', { name: /Max Muster/i })).toBeVisible()

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
    await testInfo.attach('bank-reconciliation-undone-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
