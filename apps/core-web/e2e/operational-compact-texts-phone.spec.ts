import { expect, test, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { mockCursorList } from './utils/cursor-list-mock'
import { DE_COMMON } from './helpers/de-common'
import { DE_AGENT } from './helpers/de-agent'
import { DE_FINANCE } from './helpers/de-finance'
import { DE_VEHICLES } from './helpers/de-vehicles'
import { UI_LANGUAGE_STORAGE_KEY } from '../src/lib/i18n/constants'
import deVehicleStock from '../../../locales/de/vehicleStock.json' with { type: 'json' }
import enVehicleStock from '../../../locales/en/vehicleStock.json' with { type: 'json' }
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }
import enWorkshop from '../../../locales/en/workshop.json' with { type: 'json' }
import deSales from '../../../locales/de/sales.json' with { type: 'json' }
import enSales from '../../../locales/en/sales.json' with { type: 'json' }
import deFinance from '../../../locales/de/finance.json' with { type: 'json' }
import enFinance from '../../../locales/en/finance.json' with { type: 'json' }
import deVehicles from '../../../locales/de/vehicles.json' with { type: 'json' }
import enVehicles from '../../../locales/en/vehicles.json' with { type: 'json' }
import deCustomers from '../../../locales/de/customers.json' with { type: 'json' }
import enCustomers from '../../../locales/en/customers.json' with { type: 'json' }
import deSettings from '../../../locales/de/settings.json' with { type: 'json' }
import enSettings from '../../../locales/en/settings.json' with { type: 'json' }
import deInventory from '../../../locales/de/inventory.json' with { type: 'json' }
import enInventory from '../../../locales/en/inventory.json' with { type: 'json' }

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

  test('invoice detail shows short fiscal off note and omits duplicate card', async ({ page }, testInfo) => {
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
      path: testInfo.outputPath('aut-844-invoice-detail-375.png'),
      fullPage: true,
    })
  })

  test('accounting export readiness shows compact inactive profile with header settings action', async ({ page }, testInfo) => {
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

    // Short status line; the header settings button is the single settings action and stays 44px
    await expect(page.getByText(DE_FINANCE.accountingExportReadiness.exportProfileMissing)).toBeVisible()
    const settingsButton = page.getByRole('button', { name: DE_FINANCE.actions.openSettings })
    await expect(settingsButton).toBeVisible()
    expect((await settingsButton.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    // Old long text not present
    await expect(page.getByText(/Für diesen Rechtsträger ist kein Buchhaltungsexport-Profil hinterlegt/)).toHaveCount(0)

    await page.screenshot({
      path: testInfo.outputPath('aut-844-export-readiness-375.png'),
      fullPage: true,
    })
  })

  test('agent supervision omits permanent safety banner on normal state', async ({ page }, testInfo) => {
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
      path: testInfo.outputPath('aut-844-agent-supervision-375.png'),
      fullPage: true,
    })
  })

  test('dashboard shows compact onboarding and empty widget messages', async ({ page }, testInfo) => {
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
      path: testInfo.outputPath('aut-844-dashboard-375.png'),
      fullPage: true,
    })
  })

  test('vehicle detail shows compact info buttons meeting 44px touch target', async ({ page }, testInfo) => {
    const vehicleId = 'veh-compact-1'
    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicles/${vehicleId}`), (route) =>
      route.fulfill(
        json({
          id: vehicleId,
          vin: 'WAUZZZ8V1GA000001',
          make: 'Audi',
          model: 'A3',
          year: 2018,
          license_plate: 'W-12345X',
          status: 'ACTIVE',
          pickerl_due: {
            due_date: '2026-10-31',
            due_month: '2026-10',
            status: 'WARNING',
            warnings: [
              { code: 'NO_INSPECTION_RECORDS', message: 'Keine Prüfbefunde vorhanden' },
            ],
          },
          sales: [
            {
              id: 'sale-1',
              vehicle_id: vehicleId,
              status: 'COMPLETED',
              buyer_is_consumer: true,
              contract_date: '2026-01-10',
              handover_date: '2026-01-15',
              gewaehrleistung_ends_on: '2028-01-15',
              presumption_ends_on: '2027-01-15',
              gewaehrleistung_status: 'ACTIVE',
            },
          ],
          sales_orders: [],
          workshop_orders: [],
          invoices: [],
          customer: { id: 'cust-1', first_name: 'Max', last_name: 'Mustermann' },
        }),
      ),
    )
    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicles/${vehicleId}/parties`), (route) =>
      route.fulfill(json({ data: [], suggested_bill_to: null })),
    )
    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicles/${vehicleId}/inspection-records`), (route) =>
      route.fulfill(json([])),
    )
    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicles/${vehicleId}/pickerl-open-order`), (route) =>
      route.fulfill(json(null)),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/inspection-source-connections'), (route) =>
      route.fulfill(json({ data: [{ id: 'conn-1' }] })),
    )

    await page.goto(`/vehicles/${vehicleId}`)
    await page.waitForLoadState('networkidle')

    // Info buttons exist and meet >= 44px phone touch target
    const pickerlInfo = page.getByRole('button', { name: DE_VEHICLES.pickerlSection.warningsInfoAria })
    await expect(pickerlInfo).toBeVisible()
    const pickerlBox = (await pickerlInfo.boundingBox())!
    expect(pickerlBox.width).toBeGreaterThanOrEqual(44)
    expect(pickerlBox.height).toBeGreaterThanOrEqual(44)

    const gewaehrleistungInfo = page.getByRole('button', { name: DE_VEHICLES.gewaehrleistungSection.repairsNoteAria })
    await expect(gewaehrleistungInfo).toBeVisible()
    const gewaehrleistungBox = (await gewaehrleistungInfo.boundingBox())!
    expect(gewaehrleistungBox.width).toBeGreaterThanOrEqual(44)
    expect(gewaehrleistungBox.height).toBeGreaterThanOrEqual(44)

    await page.screenshot({
      path: testInfo.outputPath('aut-844-vehicle-detail-375.png'),
      fullPage: true,
    })
  })
})

async function ensureUiLanguage(page: Page, language: 'de' | 'en') {
  const current = await page.evaluate((key) => window.localStorage.getItem(key), UI_LANGUAGE_STORAGE_KEY)
  if (current === language) return
  await page.evaluate(
    ({ key, language }) => window.localStorage.setItem(key, language),
    { key: UI_LANGUAGE_STORAGE_KEY, language },
  )
  await page.reload({ waitUntil: 'networkidle' })
}

test.describe('AUT-952: Kompakte Texte — no repeated OK badges or explanatory subtitles', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/auth/session'), (route) =>
      route.fulfill(
        json({
          userId: 'user-1',
          email: 'admin@example.com',
          activeTenant: { id: 'tenant-1', name: 'Test Workshop', slug: 'test-workshop' },
          activeRole: 'ADMIN',
          activeSiteId: 'site-1',
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
      route.fulfill(json([{ id: 'site-1', name: 'Wien', code: 'WIE' }])),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), (route) =>
      route.fulfill(json({ mechanics: [], bays: [] })),
    )
  })

  // Scenario 1
  test('WHEN an ADMIN opens /vehicle-stock at 375px in DE with in-stock rows THEN no row shows Auf Lager and year stays visible', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockCursorList(page, {
      path: '/api/vehicle-stock',
      rows: [
        { id: 'vs-1', make: 'Audi', model: 'A4', year: 2021, vin: 'WAUZZZ8K9BA000001', plate: 'W-101AA', color: 'Blau', stock_status: 'IN_STOCK' },
      ],
    })

    await page.goto('/vehicle-stock')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Audi A4')).toBeVisible()
    await expect(page.getByText('2021')).toBeVisible()
    await expect(page.getByText(deVehicleStock.reports.stockStatus.IN_STOCK)).toHaveCount(0)
  })

  // Scenario 2
  test('WHEN /vehicle-stock is opened in EN THEN no per-row OK-state status text is shown', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockCursorList(page, {
      path: '/api/vehicle-stock',
      rows: [
        { id: 'vs-1', make: 'Audi', model: 'A4', year: 2021, vin: 'WAUZZZ8K9BA000001', plate: 'W-101AA', color: 'Blue', stock_status: 'IN_STOCK' },
      ],
    })

    await page.goto('/vehicle-stock')
    await page.waitForLoadState('networkidle')
    await ensureUiLanguage(page, 'en')

    await expect(page.getByText('Audi A4')).toBeVisible()
    await expect(page.getByText('2021')).toBeVisible()
    await expect(page.getByText(enVehicleStock.reports.stockStatus.IN_STOCK)).toHaveCount(0)
  })

  // Scenario 4
  test('WHEN /workshop/board is opened at 390px THEN cards do not carry a repeated Keine Teile chip', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/board/active'), (route) =>
      route.fulfill(
        json({
          data: [
            {
              id: 'wo-1',
              orderNumber: 'WO-2026-0101',
              status: 'INTAKE',
              customer: null,
              vehicle: { id: 'v-1', make: 'VW', model: 'Golf', year: 2020, plate: 'W-202BB' },
              mechanicId: null,
              bayId: null,
              stagingLocationId: null,
              partsStatus: 'NO_PARTS',
              tasks: [],
              createdAt: '2026-04-27T00:00:00.000Z',
              updatedAt: '2026-04-27T00:00:00.000Z',
            },
          ],
        }),
      ),
    )

    await page.goto('/workshop/board')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('WO-2026-0101')).toBeVisible()
    await expect(page.getByText('Keine Teile')).toHaveCount(0)
  })

  // Scenario 5
  test('WHEN KVA, capacity, vehicles, transfers, invoices, export-ready and vehicle-data are opened at 375px in DE and EN THEN no explanatory subtitle is shown', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/estimates'), (route) =>
      route.fulfill(json({ data: [], meta: { page_size: 25, next_cursor: null } })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/capacity'), (route) =>
      route.fulfill(json({ weekStart: '2026-11-16', timezone: 'Europe/Vienna', days: [], bays: [] })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles'), (route) =>
      route.fulfill(json({ data: [], meta: { total: 0, page: 1, limit: 10, pageCount: 1 } })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/stock-transfers'), (route) =>
      route.fulfill(json([])),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/sales/invoices'), (route) =>
      route.fulfill(json({ data: [], meta: { total: 0, page: 1, limit: 10, pageCount: 1 } })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/legal-entities'), (route) =>
      route.fulfill(json([])),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicle-data/settings'), (route) =>
      route.fulfill(json({
        defaultIdentityAdapterId: null,
        defaultPartsAftermarketAdapterId: null,
        defaultLaborAftermarketAdapterId: null,
        defaultLaborCategoryId: null,
        awMinutes: 6,
        hasIdentityCredential: false,
        hasPartsAftermarketCredential: false,
        hasLaborAftermarketCredential: false,
        oemConcerns: [],
      })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/labor/categories'), (route) =>
      route.fulfill(json([])),
    )

    const checks: Array<{ path: string; de: string; en: string }> = [
      { path: '/workshop/estimates', de: deWorkshop.estimateList.description, en: enWorkshop.estimateList.description },
      { path: '/workshop/capacity', de: deWorkshop.capacity.page.description, en: enWorkshop.capacity.page.description },
      { path: '/vehicles', de: deVehicles.list.description, en: enVehicles.list.description },
      { path: '/stock-transfers', de: deInventory.stockTransfers.list.description, en: enInventory.stockTransfers.list.description },
      { path: '/sales/invoices', de: deSales.invoices.list.description, en: enSales.invoices.list.description },
      { path: '/finance/accounting-export-readiness', de: deFinance.accountingExportReadiness.subtitle, en: enFinance.accountingExportReadiness.subtitle },
      { path: '/settings?tab=vehicle-data', de: deSettings.vehicleData.catalog.awMinutesHint, en: enSettings.vehicleData.catalog.awMinutesHint },
    ]

    for (const language of ['de', 'en'] as const) {
      for (const item of checks) {
        await page.goto(item.path)
        await page.waitForLoadState('networkidle')
        await ensureUiLanguage(page, language)
        await expect(page.getByText(language === 'de' ? item.de : item.en)).toHaveCount(0)
      }
    }
  })

  // Scenario 6
  test('WHEN check-in, customer detail, vehicle detail, estimates and inventory list are opened at 375px in DE and EN THEN helper texts and inventory OK badge are absent', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders/wo-1'), (route) =>
      route.fulfill(json({ id: 'wo-1', order_number: 'WO-2026-0001', status: 'INTAKE', customer: { id: 'c-1', first_name: 'Max', last_name: 'Muster' }, vehicle: { id: 'v-1', make: 'Audi', model: 'A4', year: 2020, plate: 'W-1' }, tasks: [] })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/customers/cust-1'), (route) =>
      route.fulfill(json({ id: 'cust-1', type: 'PRIVATE', first_name: 'Max', last_name: 'Muster', vehicles: [], sales_orders: [], workshop_orders: [], invoices: [] })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/veh-1'), (route) =>
      route.fulfill(json({ id: 'veh-1', vin: 'WAUZZZ8V1GA000001', make: 'Audi', model: 'A3', year: 2018, license_plate: 'W-12345X', status: 'ACTIVE', pickerl_due: { due_date: '2027-03-31', due_month: '2027-03', status: 'OK', warnings: [] }, sales: [], sales_orders: [], workshop_orders: [], invoices: [] })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/veh-1/parties'), (route) =>
      route.fulfill(json({ data: [], suggested_bill_to: null })),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/veh-1/inspection-records'), (route) =>
      route.fulfill(json([])),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/veh-1/pickerl-open-order'), (route) =>
      route.fulfill(json(null)),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/inspection-source-connections'), (route) =>
      route.fulfill(json({ data: [] })),
    )
    await mockCursorList(page, {
      path: '/api/inventory',
      rows: [{ id: 'part-1', sku: 'BRK-001', name: 'Brake Pad', brand: 'Bosch', price: 49.9, status: 'IN_STOCK', quantity_available: 4, warehouse_location: 'A-1', revision: 0 }],
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/locations'), (route) =>
      route.fulfill(json([])),
    )

    for (const language of ['de', 'en'] as const) {
      const w = language === 'de' ? deWorkshop : enWorkshop
      const c = language === 'de' ? deCustomers : enCustomers
      const v = language === 'de' ? deVehicles : enVehicles

      await page.goto('/workshop/orders/wo-1/check-in')
      await page.waitForLoadState('networkidle')
      await ensureUiLanguage(page, language)
      await expect(page.getByText(w.checkIn.offline.storageEvictionHint)).toHaveCount(0)

      await page.goto('/customers/cust-1')
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(c.detail.invoiceHint)).toHaveCount(0)

      await page.goto('/vehicles/veh-1')
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(v.pickerlSection.subtitle)).toHaveCount(0)

      await page.goto('/inventory')
      await page.waitForLoadState('networkidle')
      await expect(page.getByText('BRK-001')).toBeVisible()
      await expect(page.getByText(language === 'de' ? 'Auf Lager' : 'In Stock')).toHaveCount(0)
    }
  })
})

