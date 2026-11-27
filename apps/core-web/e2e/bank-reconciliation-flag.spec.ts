import { expect, test, type Page } from '@playwright/test'
import deFinance from '../../../locales/de/finance.json' with { type: 'json' }
import deNav from '../../../locales/de/nav.json' with { type: 'json' }
import { AutoCorePage } from './pom/AutoCorePage'

async function mockBankReconciliationApis(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/bank-reconciliation/transactions'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'tx-flag-1',
            legal_entity_id: 'le-1',
            import_id: 'imp-1',
            receiving_iban: 'AT611904300234573201',
            booking_date: '2026-11-10',
            value_date: '2026-11-10',
            amount: '1250.50',
            currency: 'EUR',
            is_credit: true,
            non_eur: false,
            remitter_name: 'Max Mustermann',
            remitter_iban_last4: '4321',
            reference_text: 'Rechnung RE-2026-0042',
            bank_ref: 'REF-FLAG-1',
            status: 'UNMATCHED',
            version: 1,
            createdAt: '2026-11-10T10:00:00.000Z',
          },
        ],
        meta: { nextCursor: null, hasNextPage: false },
      }),
    })
  })

  await page.route(
    AutoCorePage.apiRouteMatcher('/api/bank-reconciliation/transactions/tx-flag-1/suggestions'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              invoiceId: 'inv-1',
              invoiceNumber: 'RE-2026-0042',
              outstandingAmount: '1250.50',
              suggestedAmount: '1250.50',
              remainingInvoiceAmount: '0.00',
              unallocatedTransferAmount: '0.00',
              score: 100,
              reasons: [{ code: 'AMOUNT_EXACT', value: '1250.50' }],
            },
          ],
        }),
      })
    },
  )
}

test.describe('Bank reconciliation feature flag (AUT-1004 Scenario 5)', () => {
  test('flag OFF hides sidebar entry, Cmd+K navigation, and renders NotFoundPage on direct URL', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('e2e-bank-reconciliation-enabled', 'false')
    })

    await page.goto('/dashboard')
    await expect(page.locator('a[href="/settings"]')).toBeVisible()
    await expect(page.locator('a[href="/finance/bank-reconciliation"]')).toHaveCount(0)

    await page.keyboard.press('Control+k')
    const searchInput = page.getByPlaceholder(deNav.globalSearch.placeholder)
    await expect(searchInput).toBeVisible()
    await searchInput.fill(deNav.modules.bankReconciliation)
    await expect(page.getByRole('option', { name: new RegExp(deNav.modules.bankReconciliation) })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.goto('/finance/bank-reconciliation')
    await expect(page.getByRole('heading', { name: deNav.routeTitles.notFound })).toBeVisible()
    await testInfo.attach('bank-reconciliation-flag-off-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByRole('heading', { name: deNav.routeTitles.notFound })).toBeVisible()
    await testInfo.attach('bank-reconciliation-flag-off-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('flag ON shows sidebar entry, Cmd+K navigation/actions, and renders BankReconciliationPage', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('e2e-bank-reconciliation-enabled', 'true')
    })
    await mockBankReconciliationApis(page)

    await page.goto('/dashboard')
    await expect(page.locator('a[href="/finance/bank-reconciliation"]')).toBeVisible()

    await page.keyboard.press('Control+k')
    const searchInput = page.getByPlaceholder(deNav.globalSearch.placeholder)
    await expect(searchInput).toBeVisible()
    await searchInput.fill(deNav.modules.bankReconciliation)
    await expect(page.getByRole('option', { name: new RegExp(deNav.modules.bankReconciliation) })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.goto('/finance/bank-reconciliation')
    await expect(page.getByRole('heading', { level: 1, name: deFinance.bankReconciliation.title })).toBeVisible()
    await expect(page.getByText('RE-2026-0042')).toBeVisible()
    await testInfo.attach('bank-reconciliation-flag-on-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByRole('heading', { level: 1, name: deFinance.bankReconciliation.title })).toBeVisible()
    await testInfo.attach('bank-reconciliation-flag-on-de-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
