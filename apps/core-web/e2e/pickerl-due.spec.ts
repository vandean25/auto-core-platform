import { test, expect } from '@playwright/test'
import { DE_STATUS } from './helpers/de-enums'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_WORKSHOP } from './helpers/de-workshop'
import { DE_COMMON } from './helpers/de-common'
import { DE_VEHICLES } from './helpers/de-vehicles'
import { createMockListResponse } from './utils/mock-factories'

test.describe('Pickerl due list and dashboard widgets', () => {
  test('list shows empty state when API returns no rows', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      if (route.request().url().includes('/export')) {
        return route.continue()
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      })
    })

    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(DE_COMMON.dataTable.noResults).first()).toBeVisible()
  })

  test('list shows mocked row and UNKNOWN badge', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      const url = route.request().url()
      if (url.includes('/export')) {
        return route.continue()
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createMockListResponse([
            {
              id: 'v1',
              make: 'VW',
              model: 'Golf',
              plate: 'W-MOCK-1',
              customer: { first_name: 'A', last_name: 'B', type: 'PRIVATE' },
              pickerl_due: {
                status: 'UNKNOWN',
                due_month: null,
                last_inspected_on: null,
                rule_id: 'm1-legacy-pre-2027',
                warnings: [],
              },
            },
          ], 1),
        ),
      })
    })

    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('W-MOCK-1')).toBeVisible()
    await expect(page.getByText(DE_STATUS.UNKNOWN)).toBeVisible()
  })

  test('opens the existing intake and posts a §57a task for a due vehicle', async ({ page }) => {
    let postedPayload: Record<string, unknown> | undefined
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([
          {
            id: 'vehicle-57a',
            make: 'VW',
            model: 'Golf',
            plate: 'W-57A-1',
            customer: { id: 'customer-57a', first_name: 'Alex', last_name: 'Test', type: 'PRIVATE' },
            pickerl_due: { status: 'OVERDUE', due_month: '2026-01', warnings: [] },
          },
        ], 1)),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/vehicle-57a'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'vehicle-57a', make: 'VW', model: 'Golf', year: 2020,
          plate: 'W-57A-1', vin: 'VIN-57A-1234567890',
          customer: { id: 'customer-57a', first_name: 'Alex', last_name: 'Test', type: 'PRIVATE' },
        }),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      postedPayload = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'order-57a' }) })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders/order-57a'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'order-57a', tasks: [], vehicle: { id: 'vehicle-57a' } }) })
    })

    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: '§57a-Auftrag anlegen' }).first().click()
    await expect(page.getByRole('heading', { name: DE_WORKSHOP.orderIntake.title })).toBeVisible()
    await page.getByRole('button', { name: '§57a-Auftrag anlegen' }).last().click()

    await expect.poll(() => postedPayload).toMatchObject({
      vehicleId: 'vehicle-57a',
      customerId: 'customer-57a',
      createPickerlTask: true,
    })
  })

  test('export button downloads mocked CSV', async ({ page }) => {
    let exportRequested = false
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due/export'), async (route) => {
      exportRequested = true
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: 'plate,vehicle\nW-CSV,VW Golf',
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      })
    })

    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: DE_VEHICLES.pickerlDue.exportCsv }).first().click()
    await expect.poll(() => exportRequested, { timeout: 15_000 }).toBe(true)
  })

  test('dashboard cards show meta.total and 30-day card navigates with filter_window=30', async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      const url = new URL(route.request().url())
      const window = url.searchParams.get('window')
      const total = window === '30' ? 4 : window === '60' ? 7 : 11
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          meta: { total, page: 1, pageSize: 1, pageCount: total },
        }),
      })
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('4')).toBeVisible()
    await expect(page.getByText('7')).toBeVisible()
    await expect(page.getByText('11')).toBeVisible()

    await page
      .locator('.cursor-pointer')
      .filter({ has: page.getByText('4', { exact: true }) })
      .first()
      .click()
    await expect(page).toHaveURL(/\/vehicles\/pickerl-due\?filter_window=30/)
  })

  test('shows contact column, phone consent gate, dialog reason/warning, revoke, filter, and 375px mobile layout', async ({ page }, testInfo) => {
    let phoneConsent = true
    let lastContact: Record<string, unknown> = {
      last_contacted_at: '2026-11-20T10:00:00.000Z',
      last_contact_channel: 'PHONE',
      last_contact_by: 'Max Berater',
    }

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      const url = new URL(route.request().url())
      const contactedParam = url.searchParams.get('contacted')
      const rows = [
        {
          id: 'v-consented',
          make: 'Audi',
          model: 'A4',
          plate: 'W-CALL-1',
          customer: { first_name: 'Anna', last_name: 'Telefon', phone: '+43660111222', type: 'PRIVATE' },
          pickerl_due: { status: 'OVERDUE', due_month: '2026-01', warnings: [] },
          ...lastContact,
          phone_consent_allowed: phoneConsent,
        },
        {
          id: 'v-email-only',
          make: 'VW',
          model: 'Golf',
          plate: 'W-EMAIL-1',
          customer: { first_name: 'Bernd', last_name: 'NurEmail', phone: '+43660333444', type: 'PRIVATE' },
          pickerl_due: { status: 'DUE_SOON', due_month: '2026-12', warnings: [] },
          last_contacted_at: null,
          last_contact_channel: null,
          last_contact_by: null,
          phone_consent_allowed: false,
        },
      ].filter((r) => {
        if (contactedParam === 'no') return !r.last_contacted_at
        if (contactedParam === 'yes') return Boolean(r.last_contacted_at)
        return true
      })

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse(rows, rows.length)),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/v-email-only/pickerl-contacts'), async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'log-1', phone_consent_allowed: false }),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/v-consented/pickerl-contacts'), async (route) => {
      const body = route.request().postDataJSON() as { revoke_phone_consent?: boolean }
      if (body.revoke_phone_consent) {
        phoneConsent = false
      }
      lastContact = {
        last_contacted_at: new Date().toISOString(),
        last_contact_channel: 'PHONE',
        last_contact_by: 'Max Berater',
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'log-2', phone_consent_allowed: phoneConsent }),
      })
    })

    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/Telefon · Max Berater/).first()).toBeVisible()
    await expect(page.getByRole('link', { name: '+43660111222' })).toBeVisible()
    await expect(page.getByText('Keine Telefon-Einwilligung – nicht zu Werbezwecken anrufen').first()).toBeVisible()
    await testInfo.attach('pickerl-due-contact-and-consent-de', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    // Scenario 1: record a phone contact (without revoking) and verify today's date, "Telefon", and actor name
    const consentedRow = page.locator('tr', { hasText: 'W-CALL-1' })
    await consentedRow.getByRole('button', { name: 'Kontakt erfassen' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(
      consentedRow.getByText(/^\d{2}\.\d{2}\.\d{4} · Telefon · Max Berater$/),
    ).toBeVisible()
    await expect(consentedRow.getByText(/20\.11\.2026/)).toHaveCount(0)
    await testInfo.attach('pickerl-due-contact-recorded-de', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    // Scenario 6a: open dialog on row without consent, choose MARKETING_CALL_WITHOUT_CONSENT
    const emailRow = page.locator('tr', { hasText: 'W-EMAIL-1' })
    await emailRow.getByRole('button', { name: 'Kontakt erfassen' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Grund (ohne Telefon-Einwilligung)').click()
    await page.getByRole('option', { name: 'Werbeanruf ohne Einwilligung' }).click()
    await expect(page.getByRole('alert')).toContainText('Audit-Log')
    await testInfo.attach('pickerl-due-contact-dialog-no-consent-de', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.getByRole('button', { name: 'Abbrechen' }).click()

    // Scenario 6b: revoke consent on consented row
    await consentedRow.getByRole('button', { name: 'Kontakt erfassen' }).click()
    await page.getByLabel('Kunde widerruft Einwilligung').click()
    await page.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(
      consentedRow.getByText('Keine Telefon-Einwilligung – nicht zu Werbezwecken anrufen'),
    ).toBeVisible()
    await expect(consentedRow.getByRole('link', { name: '+43660111222' })).toHaveCount(0)
    await testInfo.attach('pickerl-due-consent-revoked-de', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    // Scenario 3: filter "Kontaktiert: Nein"
    await page.getByLabel('Kontaktstatus').click()
    await page.getByRole('option', { name: 'Kontaktiert: Nein' }).click()
    await expect(page).toHaveURL(/filter_contacted=no/)
    await expect(page.getByText('W-EMAIL-1').first()).toBeVisible()
    await expect(page.getByText('W-CALL-1')).toHaveCount(0)
    await testInfo.attach('pickerl-due-filter-uncontacted-de', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    // Mobile 375px: secondary line + card button >=44px + ⋯ sheet action with >=44px tap target
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/Telefon · Max Berater/).first()).toBeVisible()
    const cardContactBtn = page.getByRole('button', { name: 'Kontakt erfassen' }).first()
    await expect(cardContactBtn).toBeVisible()
    const cardBtnBox = await cardContactBtn.boundingBox()
    expect(cardBtnBox?.height ?? 0).toBeGreaterThanOrEqual(44)
    const moreBtn = page.getByRole('button', { name: /Aktionen für/i }).first()
    await moreBtn.click()
    const contactMenuItem = page.getByRole('menuitem', { name: 'Kontakt erfassen' })
    await expect(contactMenuItem).toBeVisible()
    const box = await contactMenuItem.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    await testInfo.attach('pickerl-due-mobile-375-de', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('saves and reopens contacted=no view (Scenario 5)', async ({ page }, testInfo) => {
    const savedViews: Array<Record<string, unknown>> = []

    await page.route(AutoCorePage.apiRouteMatcher('/api/saved-views'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: savedViews }),
        })
        return
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { name: string; href: string; listPath: string }
        const created = {
          id: 'sv-pickerl-1',
          listPath: body.listPath,
          name: body.name,
          href: body.href,
          visibility: 'PERSONAL',
          ownerUserId: 'test-user',
          version: 1,
          createdAt: '2026-11-25T08:00:00.000Z',
          updatedAt: '2026-11-25T08:00:00.000Z',
        }
        savedViews.push(created)
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        })
        return
      }
      await route.continue()
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      const url = new URL(route.request().url())
      const contactedParam = url.searchParams.get('contacted')
      const rows = [
        {
          id: 'v-consented',
          make: 'Audi',
          model: 'A4',
          plate: 'W-CALL-1',
          customer: { first_name: 'Anna', last_name: 'Telefon', phone: '+43660111222', type: 'PRIVATE' },
          pickerl_due: { status: 'OVERDUE', due_month: '2026-01', warnings: [] },
          last_contacted_at: '2026-11-20T10:00:00.000Z',
          last_contact_channel: 'PHONE',
          last_contact_by: 'Max Berater',
          phone_consent_allowed: true,
        },
        {
          id: 'v-email-only',
          make: 'VW',
          model: 'Golf',
          plate: 'W-EMAIL-1',
          customer: { first_name: 'Bernd', last_name: 'NurEmail', phone: '+43660333444', type: 'PRIVATE' },
          pickerl_due: { status: 'DUE_SOON', due_month: '2026-12', warnings: [] },
          last_contacted_at: null,
          last_contact_channel: null,
          last_contact_by: null,
          phone_consent_allowed: false,
        },
      ].filter((r) => {
        if (contactedParam === 'no') return !r.last_contacted_at
        if (contactedParam === 'yes') return Boolean(r.last_contacted_at)
        return true
      })

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse(rows, rows.length)),
      })
    })

    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')

    await page.getByLabel('Kontaktstatus').click()
    await page.getByRole('option', { name: 'Kontaktiert: Nein' }).click()
    await expect(page).toHaveURL(/filter_contacted=no/)

    await page
      .getByRole('button', {
        name: DE_COMMON.savedViews.saveAria.replace('{{title}}', DE_VEHICLES.pickerlDue.title),
      })
      .click()
    const saveDialog = page.getByRole('dialog', { name: DE_COMMON.savedViews.title })
    await saveDialog.getByLabel(DE_COMMON.savedViews.nameLabel, { exact: true }).fill('Nicht kontaktiert')
    await saveDialog.getByRole('button', { name: DE_COMMON.actions.save, exact: true }).click()
    await expect(saveDialog).toBeHidden()

    await page.goto('/vehicles/pickerl-due')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('W-CALL-1').first()).toBeVisible()

    await page
      .getByRole('button', {
        name: DE_COMMON.savedViews.menuAria.replace('{{title}}', DE_VEHICLES.pickerlDue.title),
      })
      .click()
    await page
      .getByRole('dialog', { name: DE_COMMON.savedViews.menuTitle })
      .getByRole('button', { name: 'Nicht kontaktiert', exact: true })
      .click()

    await expect(page).toHaveURL(/filter_contacted=no/)
    await expect(page.getByText('W-EMAIL-1').first()).toBeVisible()
    await expect(page.getByText('W-CALL-1')).toHaveCount(0)
    await testInfo.attach('pickerl-due-saved-view-reopened-de', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('lists vehicle as uncontacted with empty contact cell after due month advances (Scenario 4 & Anti-criterion 1)', async ({ page }, testInfo) => {
    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles/pickerl-due'), async (route) => {
      const url = new URL(route.request().url())
      const contactedParam = url.searchParams.get('contacted')
      const rows = [
        {
          id: 'v-rolled-over',
          make: 'Audi',
          model: 'A4',
          plate: 'W-CALL-1',
          customer: { first_name: 'Anna', last_name: 'Telefon', phone: '+43660111222', type: 'PRIVATE' },
          pickerl_due: { status: 'DUE_SOON', due_month: '2027-01', warnings: [] },
          last_contacted_at: null,
          last_contact_channel: null,
          last_contact_by: null,
          phone_consent_allowed: true,
        },
      ].filter((r) => {
        if (contactedParam === 'no') return !r.last_contacted_at
        return true
      })

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse(rows, rows.length)),
      })
    })

    await page.goto('/vehicles/pickerl-due?filter_contacted=no')
    await page.waitForLoadState('networkidle')

    const row = page.locator('tr', { hasText: 'W-CALL-1' })
    await expect(row).toBeVisible()
    await expect(row.getByText('2027-01')).toBeVisible()
    await expect(row.locator('td').nth(6)).toHaveText('—')
    await expect(row.getByText(/Telefon ·/)).toHaveCount(0)

    await testInfo.attach('pickerl-due-rollover-uncontacted-de', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
