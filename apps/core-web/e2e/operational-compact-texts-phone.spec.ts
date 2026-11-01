import { expect, test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_COMMON } from './helpers/de-common'
import { DE_AGENT } from './helpers/de-agent'
import { DE_FINANCE } from './helpers/de-finance'

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

test.describe('AUT-844: Operational compact texts on phone (375px)', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test.beforeEach(async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/auth/session'), (route) =>
      route.fulfill(
        json({
          userId: 'user-1',
          email: 'admin@example.com',
          activeTenant: { id: 'tenant-1', name: 'Test Workshop', slug: 'test-workshop' },
          activeRole: 'ADMIN',
          activeSiteId: null,
          memberships: [],
          locale: 'de',
          effectiveLocale: 'de',
          defaultLocale: 'de',
          formatLocale: 'de-AT',
          effectiveCapabilities: null,
        }),
      ),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), (route) =>
      route.fulfill(json([])),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), (route) =>
      route.fulfill(json([])),
    )
  })

  test('invoice detail shows short fiscal off note and omits duplicate card', async ({ page }) => {
    const invoiceId = 'inv-compact-1'
    await page.route(AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${invoiceId}`), (route) =>
      route.fulfill(
        json({
          id: invoiceId,
          status: 'ISSUED',
          invoice_number: 'RE-2026-0001',
          date: '2026-09-21T00:00:00.000Z',
          due_date: '2026-10-05T00:00:00.000Z',
          total_net: '100.00',
          total_tax: '20.00',
          total_gross: '120.00',
          tax_mode: 'STANDARD',
          workshop_order_id: 'wo-compact-1',
          customer: {
            id: 'cust-1',
            type: 'PRIVATE',
            first_name: 'Max',
            last_name: 'Mustermann',
            company_name: null,
            email: 'max@example.com',
            phone: null,
          },
          items: [],
        }),
      ),
    )
    await page.route(AutoCorePage.apiRouteMatcher(`/api/invoices/${invoiceId}/settlement`), (route) =>
      route.fulfill(
        json({
          invoiceId,
          invoiceStatus: 'ISSUED',
          rksvMode: 'OFF',
          payment: null,
        }),
      ),
    )
    await page.route(AutoCorePage.apiRouteMatcher(`/api/invoices/${invoiceId}/credit-notes`), (route) =>
      route.fulfill(
        json({
          originalInvoiceId: invoiceId,
          coverageStatus: 'NONE',
          creditedGross: '0.00',
          remainingGross: '120.00',
          creditNotes: [],
        }),
      ),
    )

    await page.goto(`/sales/invoices/${invoiceId}`)
    await page.waitForLoadState('networkidle')

    // Short line present in actions area
    await expect(page.getByText(DE_FINANCE.settlement.fiscalOff)).toBeVisible()
    // No duplicate Abrechnung card without action
    await expect(page.getByText('Der fiskalische Abrechnungsweg ist für diesen Rechtsträger ausgeschaltet')).toHaveCount(0)

    await page.screenshot({
      path: '../../docs/internal/assets/aut-844-invoice-detail-375.png',
      fullPage: true,
    })
  })

  test('accounting export readiness shows compact inactive profile with settings link', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/legal-entities'), (route) =>
      route.fulfill(
        json([
          { id: 'le-1', name: 'Autohaus GmbH', is_active: true },
        ]),
      ),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/finance/accounting-export-readiness'), (route) =>
      route.fulfill(
        json({
          legalEntity: { id: 'le-1', name: 'Autohaus GmbH' },
          dateFrom: '2026-09-01',
          dateTo: '2026-09-30',
          periodClosed: false,
          exportProfile: { configured: false, canGenerate: false },
          summary: {
            documentCount: 0,
            exportableCount: 0,
            blockedCount: 0,
            reasons: [],
          },
          data: [],
          tenantWideBlockers: [],
          meta: { page: 1, limit: 10, total: 0, pageCount: 1 },
        }),
      ),
    )

    await page.goto('/finance/accounting-export-readiness')
    await page.waitForLoadState('networkidle')

    // Short status line and settings link
    await expect(page.getByText(DE_FINANCE.accountingExportReadiness.exportProfileMissing)).toBeVisible()
    await expect(page.getByRole('link', { name: DE_FINANCE.accountingExportReadiness.settingsLink })).toBeVisible()
    // Old long text not present
    await expect(page.getByText(/Für diesen Rechtsträger ist kein Buchhaltungsexport-Profil hinterlegt/)).toHaveCount(0)

    await page.screenshot({
      path: '../../docs/internal/assets/aut-844-export-readiness-375.png',
      fullPage: true,
    })
  })

  test('agent supervision omits permanent safety banner on normal state', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/agent-supervision/proposals'), (route) =>
      route.fulfill(json({ data: [], meta: { total: 0, page: 1, limit: 10, pageCount: 1 } })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/agent-supervision/activity'), (route) =>
      route.fulfill(json({ data: [], meta: { total: 0, page: 1, limit: 10, pageCount: 1 } })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/agent-supervision/decision-shadow-logs'), (route) =>
      route.fulfill(json({ data: [], nextCursor: null })),
    )

    await page.goto('/agent/supervision')
    await page.waitForLoadState('networkidle')

    // Safety banner is not rendered
    await expect(page.getByTestId('agent-safety-banner')).toHaveCount(0)

    // Switch to Entscheidungs-Schatten tab
    await page.getByTestId('tab-decision-shadow').click()

    // Explanatory paragraph is removed, info icon exists
    await expect(page.getByRole('button', { name: DE_AGENT.decisionShadow.infoAria })).toBeVisible()
    await expect(page.getByText('Nur-Lese-Ansicht der im Schattenmodus protokollierten KI-Vorschläge')).toHaveCount(0)

    await page.screenshot({
      path: '../../docs/internal/assets/aut-844-agent-supervision-375.png',
      fullPage: true,
    })
  })

  test('dashboard shows compact onboarding and empty widget messages', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/customers'), (route) =>
      route.fulfill(json({ data: [], meta: { total: 0 } })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles'), (route) =>
      route.fulfill(json({ data: [], meta: { total: 0 } })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), (route) =>
      route.fulfill(json({ data: [], meta: { total: 0 } })),
    )

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Compact onboarding description (one short line)
    await expect(page.getByText(DE_COMMON.onboarding.description)).toBeVisible()
    // Compact empty widgets message (one short line)
    await expect(page.getByText(DE_COMMON.dashboard.emptyWidgets)).toBeVisible()

    await page.screenshot({
      path: '../../docs/internal/assets/aut-844-dashboard-375.png',
      fullPage: true,
    })
  })
})
