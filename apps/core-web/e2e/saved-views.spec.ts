import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { SavedViewDto } from '../src/api/saved-views'
import deNav from '../../../locales/de/nav.json' with { type: 'json' }
import enNav from '../../../locales/en/nav.json' with { type: 'json' }
import deCommon from '../../../locales/de/common.json' with { type: 'json' }
import enCommon from '../../../locales/en/common.json' with { type: 'json' }
import deEnums from '../../../locales/de/enums.json' with { type: 'json' }
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }
import enWorkshop from '../../../locales/en/workshop.json' with { type: 'json' }
import { DE_SHELL } from './helpers/de-shell'
import { AutoCorePage } from './pom/AutoCorePage'
import { mockCursorList } from './utils/cursor-list-mock'
import { createMockCustomer, createMockListResponse, createMockVehicleListItem, createMockWorkshopOrder } from './utils/mock-factories'
import { expectNoPageScroll } from './utils/phone-layout'

test.describe('Saved views mobile (AUT-940)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('saved views at 375px', async ({ page }) => {
    const views = [
      {
        id: 'sv-1',
        listPath: '/customers',
        name: 'Stammkunden',
        href: '/customers?search=Huber',
        visibility: 'PERSONAL',
        ownerUserId: 'test-user',
        version: 1,
        createdAt: '2026-11-01T08:00:00.000Z',
        updatedAt: '2026-11-01T08:00:00.000Z',
      },
    ]

    await page.route(AutoCorePage.apiRouteMatcher('/api/customers'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createMockListResponse([
            createMockCustomer({
              id: 'cust-1',
              first_name: 'Anna',
              last_name: 'Huber',
              email: 'anna.huber@example.at',
            }),
          ]),
        ),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/saved-views'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: views }),
        })
        return
      }
      await route.continue()
    })

    await page.route('**/api/saved-views/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { visibility?: 'PERSONAL' | 'TENANT'; version?: number }
        views[0] = {
          ...views[0],
          visibility: body.visibility ?? views[0].visibility,
          version: (body.version ?? views[0].version) + 1,
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(views[0]),
        })
        return
      }
      await route.continue()
    })

    const corePage = new AutoCorePage(page, 'Kunde')
    await corePage.navigate('/customers')

    const trigger = page.getByRole('button', { name: 'Gespeicherte Ansichten für Kunden' })
    await expect(trigger).toBeVisible()
    const triggerBox = await trigger.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(triggerBox!.width).toBeGreaterThanOrEqual(44)
    expect(triggerBox!.height).toBeGreaterThanOrEqual(44)

    await trigger.click()

    const sheet = page.getByRole('dialog', { name: 'Ansichten' })
    await expect(sheet).toBeVisible()

    const viewButton = sheet.getByRole('button', { name: 'Stammkunden', exact: true })
    const shareButton = sheet.getByRole('button', { name: 'Ansicht Stammkunden mit Team teilen' })
    await expect(viewButton).toBeVisible()
    await expect(shareButton).toBeVisible()

    for (const locator of [viewButton, shareButton]) {
      const box = await locator.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }

    await shareButton.click()

    const teamSection = sheet.getByRole('region', { name: 'Team' })
    await expect(teamSection).toBeVisible()
    await expect(teamSection.getByRole('button', { name: 'Stammkunden Team', exact: true })).toBeVisible()
  })
})

const LONG_VIEW_NAME = 'Offene Werkstattaufträge für das gesamte Serviceteam im Hauptbetrieb'

function savedView(overrides: Partial<SavedViewDto> = {}): SavedViewDto {
  return {
    id: 'saved-view-1',
    listPath: '/workshop/orders',
    name: 'Serviceaufträge',
    href: '/workshop/orders?search=Service',
    visibility: 'PERSONAL',
    ownerUserId: 'test-user',
    version: 1,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  }
}

async function mockSavedViews(page: Page, initial: SavedViewDto[]) {
  let views = initial
  await page.route(AutoCorePage.apiRouteMatcher('/api/saved-views'), (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON() as Pick<SavedViewDto, 'name' | 'href' | 'listPath' | 'visibility'>
      const created = savedView(input)
      views = [...views, created]
      return route.fulfill({ status: 201, json: created })
    }
    return route.fulfill({ json: { data: views } })
  })
  await page.route('**/api/saved-views/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    const id = new URL(route.request().url()).pathname.split('/').at(-1)
    const body = route.request().postDataJSON() as { name?: string; visibility?: 'PERSONAL' | 'TENANT'; version: number }
    views = views.map((view) => view.id === id ? { ...view, ...body, version: body.version + 1 } : view)
    await route.fulfill({ json: views.find((view) => view.id === id) })
  })
}

async function expectTouchTarget(control: Locator) {
  await expect(control).toBeVisible()
  const box = await control.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
}

const CUSTOMER_CONTACT = 'anna.huber@example.at'
const CUSTOMER_LAYOUT = '/customers?cols=email&density=compact'

function customerLayoutOptions(page: Page) {
  return page.getByRole('button', { name: deCommon.dataTable.columns, exact: true })
}

async function openCustomerSavedView(page: Page, name: string) {
  await page.getByRole('button', { name: 'Gespeicherte Ansichten für Kunden' }).click()
  await page.getByRole('dialog', { name: deCommon.savedViews.menuTitle })
    .getByRole('button', { name, exact: true }).click()
}

test.describe('Customer custom fields in list views (AUT-1044)', () => {
  const field = 'Flottennummer'
  const value = 'FL-1044'

  test.beforeEach(async ({ page }, testInfo) => {
    await page.addInitScript((enabled) => {
      window.localStorage.setItem('acp:ui-language', 'de')
      window.localStorage.setItem('e2e-custom-fields-enabled', String(enabled))
    }, !testInfo.title.startsWith('flag off'))
    await page.route(AutoCorePage.apiRouteMatcher('/api/custom-fields/definitions'), (route) => route.fulfill({
      json: [{ id: 'def-list', entity: 'CUSTOMER', key: 'fleet_no', label: field, type: 'TEXT', options: null, archived: false }],
    }))
    await mockCursorList(page, {
      path: '/api/customers',
      rows: [{ ...createMockCustomer({ first_name: 'Anna', last_name: 'Huber' }), custom_fields: { fleet_no: value } }],
    })
  })

  async function enableColumn(page: Page) {
    await customerLayoutOptions(page).click()
    await page.getByRole('menuitemcheckbox', { name: field }).click({ timeout: 5000 })
    await page.keyboard.press('Escape')
  }

  test('reopening a saved view restores the enabled custom column and its filter', async ({ page }, testInfo) => {
    await mockSavedViews(page, [])
    await new AutoCorePage(page, '').navigate('/customers?cf.deleted=x')
    await expect(page.getByText('Anna Huber', { exact: true })).toBeVisible()
    await expect(page.getByText(value, { exact: true })).toHaveCount(0)
    await enableColumn(page)
    await page.getByRole('button', { name: 'Eigene Felder', exact: true }).click()
    await page.getByRole('textbox', { name: field }).fill(value)
    const filtered = page.waitForRequest((request) =>
      new URL(request.url()).searchParams.get('cf.fleet_no[contains]') === value,
    )
    await page.getByRole('button', { name: 'Anwenden', exact: true }).click()
    await filtered
    await page.getByRole('button', { name: deCommon.savedViews.saveAria.replace('{{title}}', 'Kunden') }).click()
    const dialog = page.getByRole('dialog', { name: deCommon.savedViews.title })
    await dialog.getByLabel(deCommon.savedViews.nameLabel, { exact: true }).fill('Flottenkunden')
    await dialog.getByRole('button', { name: deCommon.actions.save, exact: true }).click()
    await expect(dialog).toBeHidden()
    await new AutoCorePage(page, '').navigate('/customers')
    await openCustomerSavedView(page, 'Flottenkunden')
    await expect(page).toHaveURL((url) => url.searchParams.get('cols') === 'cf.fleet_no' &&
      url.searchParams.get('cf.fleet_no[contains]') === value &&
      url.searchParams.get('cf.deleted') === 'x')
    await expect(page.getByText(value, { exact: true })).toBeVisible()
    await testInfo.attach('custom-column-saved-desktop', { body: await page.screenshot(), contentType: 'image/png' })
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByRole('definition').filter({ hasText: value })).toBeVisible()
    await expectTouchTarget(customerLayoutOptions(page))
    await expectTouchTarget(page.getByRole('button', { name: 'Eigene Felder', exact: true }))
    await expectNoPageScroll(page)
    await testInfo.attach('custom-column-saved-375', { body: await page.screenshot(), contentType: 'image/png' })
  })

  test('CSV includes the enabled custom column header and value', async ({ page }, testInfo) => {
    await new AutoCorePage(page, '').navigate('/customers')
    await enableColumn(page)
    const csv = page.getByRole('button', { name: deCommon.dataTable.exportCsv, exact: true })
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 812 })
      if (width === 375) await expectTouchTarget(csv)
      const download = page.waitForEvent('download')
      await csv.click()
      const content = await readFile((await (await download).path())!, 'utf8')
      const [header, firstRow] = content.split('\r\n')
      expect(firstRow.split(';')[header.split(';').indexOf(field)]).toBe(value)
      await testInfo.attach(`custom-column-csv-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
    }
  })

  test('flag off suppresses custom column and filter controls even with a saved layout', async ({ page }, testInfo) => {
    await new AutoCorePage(page, '').navigate('/customers?cols=cf.fleet_no&cf.fleet_no=FL-1044')
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 812 })
      await expect(page.getByText('Anna Huber', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Eigene Felder', exact: true })).toHaveCount(0)
      await customerLayoutOptions(page).click()
      await expect(page.getByRole('menuitemcheckbox', { name: field })).toHaveCount(0)
      await testInfo.attach(`custom-lists-flag-off-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
      await page.keyboard.press('Escape')
    }
  })

  test('keeps sort headers enabled with a custom filter, honours URL sortField, and reopens a saved view with both', async ({ page }, testInfo) => {
    await mockSavedViews(page, [])
    await new AutoCorePage(page, '').navigate('/customers?cf.fleet_no=FL-1044')
    await expect(page.getByText('Anna Huber', { exact: true })).toBeVisible()

    // Sort button on Name column must remain visible and interactive while cf.* is active
    const nameSortButton = page.getByRole('button', { name: 'Name', exact: true })
    await expect(nameSortButton).toBeVisible()
    const sortedRequest = page.waitForRequest((request) => {
      const url = new URL(request.url())
      return (
        url.pathname === '/api/customers' &&
        url.searchParams.get('pagination') === 'cursor' &&
        url.searchParams.get('cf.fleet_no') === 'FL-1044' &&
        url.searchParams.get('sortField') === 'company_name'
      )
    })
    await nameSortButton.click()
    await sortedRequest
    await expect(page).toHaveURL((url) =>
      url.searchParams.get('cf.fleet_no') === 'FL-1044' &&
      url.searchParams.get('sortField') === 'company_name',
    )

    // Save the filtered + sorted view, navigate away, and reopen it
    await page.getByRole('button', { name: deCommon.savedViews.saveAria.replace('{{title}}', 'Kunden') }).click()
    const dialog = page.getByRole('dialog', { name: deCommon.savedViews.title })
    await dialog.getByLabel(deCommon.savedViews.nameLabel, { exact: true }).fill('Flotte sortiert')
    await dialog.getByRole('button', { name: deCommon.actions.save, exact: true }).click()
    await expect(dialog).toBeHidden()

    await new AutoCorePage(page, '').navigate('/customers')
    const reopenedRequest = page.waitForRequest((request) => {
      const url = new URL(request.url())
      return (
        url.pathname === '/api/customers' &&
        url.searchParams.get('pagination') === 'cursor' &&
        url.searchParams.get('cf.fleet_no') === 'FL-1044' &&
        url.searchParams.get('sortField') === 'company_name'
      )
    })
    await openCustomerSavedView(page, 'Flotte sortiert')
    await reopenedRequest
    await expect(page).toHaveURL((url) =>
      url.searchParams.get('cf.fleet_no') === 'FL-1044' &&
      url.searchParams.get('sortField') === 'company_name',
    )
    await expect(page.getByText('Anna Huber', { exact: true })).toBeVisible()
    await testInfo.attach('custom-filter-sorted-desktop', { body: await page.screenshot(), contentType: 'image/png' })

    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByText('Anna Huber', { exact: true })).toBeVisible()
    await expectNoPageScroll(page)
    await testInfo.attach('custom-filter-sorted-375', { body: await page.screenshot(), contentType: 'image/png' })
  })
})

test.describe('Vehicle custom fields in list views (AUT-1097)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('acp:ui-language', 'de')
      window.localStorage.setItem('e2e-custom-fields-enabled', 'true')
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/custom-fields/definitions'), (route) => route.fulfill({
      json: [{ id: 'def-veh', entity: 'VEHICLE', key: 'bay', label: 'Stellplatz', type: 'TEXT', options: null, archived: false }],
    }))
    await mockCursorList(page, {
      path: '/api/vehicles',
      rows: [{ ...createMockVehicleListItem({ make: 'Skoda', model: 'Octavia', year: 2022, plate: 'W-1097-AT' }), custom_fields: { bay: 'A1' } }],
    })
  })

  test('keeps cursor-eligible sort headers enabled on vehicles while cf filter is active and applies sortField', async ({ page }, testInfo) => {
    await mockSavedViews(page, [])
    await new AutoCorePage(page, '').navigate('/vehicles?cf.bay=A1')
    await expect(page.getByText('Skoda Octavia', { exact: true })).toBeVisible()

    const yearSortButton = page.getByRole('button', { name: 'Baujahr', exact: true })
    await expect(yearSortButton).toBeVisible()
    // Relation sort on Kunde stays disabled while cf.* is active
    await expect(page.getByRole('button', { name: 'Kunde', exact: true })).toHaveCount(0)

    const sortedRequest = page.waitForRequest((request) => {
      const url = new URL(request.url())
      return (
        url.pathname === '/api/vehicles' &&
        url.searchParams.get('pagination') === 'cursor' &&
        url.searchParams.get('cf.bay') === 'A1' &&
        url.searchParams.get('sortField') === 'year'
      )
    })
    await yearSortButton.click()
    await sortedRequest
    await expect(page).toHaveURL((url) =>
      url.searchParams.get('cf.bay') === 'A1' &&
      url.searchParams.get('sortField') === 'year',
    )
    await testInfo.attach('vehicle-custom-filter-sorted-desktop', { body: await page.screenshot(), contentType: 'image/png' })

    await page.setViewportSize({ width: 375, height: 812 })
    await expect(page.getByText('Skoda Octavia', { exact: true })).toBeVisible()
    await expectNoPageScroll(page)
    await testInfo.attach('vehicle-custom-filter-sorted-375', { body: await page.screenshot(), contentType: 'image/png' })
  })
})

test.describe('Customer view layout (AUT-1046)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('acp:ui-language', 'de'))
    await page.route(AutoCorePage.apiRouteMatcher('/api/customers'), (route) => route.fulfill({
      json: createMockListResponse([createMockCustomer({ first_name: 'Anna', last_name: 'Huber', email: CUSTOMER_CONTACT })]),
    }))
  })

  test('hidden columns stay hidden after reload', async ({ page }, testInfo) => {
    await new AutoCorePage(page, '').navigate('/customers')
    await expect(page.getByText(CUSTOMER_CONTACT)).toBeVisible()
    await expectTouchTarget(customerLayoutOptions(page))
    await customerLayoutOptions(page).click()
    const contact = page.getByRole('menuitemcheckbox', { name: deEnums.dataTableColumn.email, exact: true })
    await expectTouchTarget(contact)
    await contact.click()
    await expect(page).toHaveURL((url) => url.searchParams.get('cols') === 'email')
    await page.reload()
    await expect(page.getByText('Anna Huber', { exact: true })).toBeVisible()
    await expect(page.getByText(CUSTOMER_CONTACT)).toHaveCount(0)
    await testInfo.attach('column-hidden-after-reload', { body: await page.screenshot(), contentType: 'image/png' })
  })

  test('compact rows stay compact after reload', async ({ page }, testInfo) => {
    await new AutoCorePage(page, '').navigate('/customers')
    const row = page.locator('[data-row-primary]').first()
    await expect(row).toBeVisible()
    const normalHeight = (await row.boundingBox())!.height
    await customerLayoutOptions(page).click()
    const compact = page.getByRole('menuitemcheckbox', { name: deCommon.dataTable.density.compact })
    await expectTouchTarget(compact)
    await compact.click()
    await expect(page).toHaveURL((url) => url.searchParams.get('density') === 'compact')
    await page.reload()
    await expect(page.locator('[data-table-list]')).toHaveAttribute('data-density', 'compact')
    await expect.poll(async () => (await row.boundingBox())?.height ?? normalHeight).toBeLessThan(normalHeight)
    await expectTouchTarget(row)
    await testInfo.attach('compact-after-reload', { body: await page.screenshot(), contentType: 'image/png' })
  })

  test('reopening a saved view restores both layout settings', async ({ page }, testInfo) => {
    await mockSavedViews(page, [])
    await new AutoCorePage(page, '').navigate(CUSTOMER_LAYOUT)
    await page.getByRole('button', { name: deCommon.savedViews.saveAria.replace('{{title}}', 'Kunden') }).click()
    const dialog = page.getByRole('dialog', { name: deCommon.savedViews.title })
    await dialog.getByLabel(deCommon.savedViews.nameLabel, { exact: true }).fill('Kompakte Kunden')
    await dialog.getByRole('button', { name: deCommon.actions.save, exact: true }).click()
    await expect(dialog).toBeHidden()
    await new AutoCorePage(page, '').navigate('/customers')
    await expect(page.getByText(CUSTOMER_CONTACT)).toBeVisible()
    await openCustomerSavedView(page, 'Kompakte Kunden')
    await expect(page.locator('[data-table-list]')).toHaveAttribute('data-density', 'compact')
    await expect(page.getByText(CUSTOMER_CONTACT)).toHaveCount(0)
    await testInfo.attach('saved-layout-reopened', { body: await page.screenshot(), contentType: 'image/png' })
  })

  test('opening a teammate’s shared view restores both layout settings', async ({ page }, testInfo) => {
    await mockSavedViews(page, [savedView({
      listPath: '/customers', name: 'Kundenliste', href: CUSTOMER_LAYOUT, visibility: 'TENANT', ownerUserId: 'teammate',
    })])
    await new AutoCorePage(page, '').navigate('/customers')
    await openCustomerSavedView(page, 'Kundenliste Team')
    await expect(page.locator('[data-table-list]')).toHaveAttribute('data-density', 'compact')
    await expect(page.getByText(CUSTOMER_CONTACT)).toHaveCount(0)
    await testInfo.attach('team-layout-opened', { body: await page.screenshot(), contentType: 'image/png' })
  })

  test('Reset restores both defaults and removes their URL parameters', async ({ page }, testInfo) => {
    await new AutoCorePage(page, '').navigate(CUSTOMER_LAYOUT)
    await customerLayoutOptions(page).click()
    const reset = page.getByRole('menuitem', { name: deCommon.dataTable.reset })
    await expectTouchTarget(reset)
    await reset.click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL((url) => !url.searchParams.has('cols') && !url.searchParams.has('density'))
    await expect(page.locator('[data-table-list]')).toHaveAttribute('data-density', 'comfortable')
    await expect(page.getByText(CUSTOMER_CONTACT)).toBeVisible()
    await testInfo.attach('layout-reset', { body: await page.screenshot(), contentType: 'image/png' })
  })

  test('unknown column keys leave the customer name visible', async ({ page }, testInfo) => {
    await new AutoCorePage(page, '').navigate('/customers?cols=foo,email')
    await expect(page.getByText('Anna Huber', { exact: true })).toBeVisible()
    await expect(page.getByText(CUSTOMER_CONTACT)).toHaveCount(0)
    await testInfo.attach('unknown-column-ignored', { body: await page.screenshot(), contentType: 'image/png' })
  })

  test('a saved view without layout parameters restores the defaults', async ({ page }, testInfo) => {
    await mockSavedViews(page, [savedView({ listPath: '/customers', name: 'Standardliste', href: '/customers?search=Huber' })])
    await new AutoCorePage(page, '').navigate(CUSTOMER_LAYOUT)
    await openCustomerSavedView(page, 'Standardliste')
    await expect(page).toHaveURL((url) => url.searchParams.get('search') === 'Huber')
    await expect(page.locator('[data-table-list]')).toHaveAttribute('data-density', 'comfortable')
    await expect(page.getByText(CUSTOMER_CONTACT)).toBeVisible()
    await testInfo.attach('existing-view-defaults', { body: await page.screenshot(), contentType: 'image/png' })
  })
})

async function expectFullViewName(label: Locator) {
  await expect(label).toBeVisible()
  expect(await label.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    return Array.from(range.getClientRects()).every((rect) =>
      rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 &&
      rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1,
    )
  }), 'the full name must fit inside its visible label, not be clipped').toBe(true)
}

for (const locale of ['de', 'en'] as const) {
  const common = locale === 'de' ? deCommon : enCommon
  const workshop = locale === 'de' ? deWorkshop : enWorkshop
  const nav = locale === 'de' ? deNav : enNav
  const saveName = common.savedViews.saveAria.replace('{{title}}', workshop.orders.list.saveViewTitle)
  const menuName = common.savedViews.menuAria.replace('{{title}}', workshop.orders.list.saveViewTitle)

  test.describe(`Saved-view access in ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => window.localStorage.setItem('acp:ui-language', language), locale)
      await setupWorkshopOrdersForSaveView(page)
    })

    test('help names the same save action as the button', async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 })
      await new AutoCorePage(page, '').navigate('/workshop/orders?search=Service')
      const save = page.getByRole('button', { name: saveName })
      await expect(save).toBeVisible()
      await expect(save).toContainText(common.savedViews.saveButton)
      await save.focus()
      const hint = page.getByRole('tooltip')
      await expect(hint).toHaveText(common.savedViews.saveHint)
      await expect(hint).not.toContainText(/filter/i)
      expect(common.savedViews.title).toBe(common.savedViews.saveButton)
      expect(nav.favorites.empty).toContain(common.savedViews.saveButton)
      expect(nav.favorites.empty.toLowerCase()).not.toContain('filter')
      await expect(page.getByText(nav.favorites.empty, { exact: true })).toHaveCount(0)
    })

    for (const width of [375, 390, 1400]) {
      test(`unfiltered list can be saved at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 })
        await new AutoCorePage(page, '').navigate('/workshop/orders')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await testInfo.attach('unfiltered-list', { body: await page.screenshot(), contentType: 'image/png' })
        const save = page.getByRole('button', { name: saveName })
        await expect(save).toBeVisible()
        if (width < 768) await expectTouchTarget(save)
        await expectNoPageScroll(page)
        await save.click()
        const dialog = page.getByRole('dialog', { name: common.savedViews.title })
        await dialog.getByLabel(common.savedViews.nameLabel, { exact: true }).fill('Alle Aufträge')
        const request = page.waitForRequest((request) =>
          new URL(request.url()).pathname === '/api/saved-views' && request.method() === 'POST',
        )
        await dialog.getByRole('button', { name: common.actions.save, exact: true }).click()
        expect((await request).postDataJSON()).toMatchObject({
          name: 'Alle Aufträge', href: '/workshop/orders', visibility: 'PERSONAL',
        })
        await expect(dialog).toBeHidden()
        const savedToast = page.locator('[data-sonner-toast]').filter({ hasText: common.savedViews.added })
        await expect(savedToast).toBeVisible()
        await expect(savedToast).toBeHidden()
        await expectNoPageScroll(page)
      })

      test(`full team and personal names are readable at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 })
        await mockSavedViews(page, [
          savedView({ name: LONG_VIEW_NAME, visibility: 'TENANT' }),
          savedView({ id: 'personal-2', name: LONG_VIEW_NAME }),
        ])
        await new AutoCorePage(page, '').navigate('/workshop/orders')
        await page.getByRole('button', { name: menuName }).click()
        const menu = page.getByRole('dialog', { name: common.savedViews.menuTitle, exact: true })
        await expect(menu).toBeVisible()
        await testInfo.attach('view-names', { body: await page.screenshot(), contentType: 'image/png' })
        for (const section of [common.savedViews.teamSection, common.savedViews.personalSection]) {
          await expectFullViewName(menu.getByRole('region', { name: section, exact: true }).getByText(LONG_VIEW_NAME, { exact: true }))
        }
        await expectNoPageScroll(page)
      })

      test(`sidebar favourite can be renamed and shared at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 })
        await mockSavedViews(page, [savedView()])
        await new AutoCorePage(page, '').navigate('/workshop/orders')
        const navigation = page.getByRole('navigation', { name: nav.aria.mainNavigation })
        const openFavorites = async () => {
          if (width < 768) await page.getByRole('navigation', { name: nav.phoneNav.aria }).getByRole('button', { name: nav.phoneNav.more }).click()
        }
        await openFavorites()
        const favorite = navigation.locator('[data-sidebar="menu-item"]').filter({ has: page.getByRole('link', { name: 'Serviceaufträge', exact: true }) })
        await expect(favorite).toBeVisible()
        await favorite.scrollIntoViewIfNeeded()
        await testInfo.attach('sidebar-favourite', { body: await page.screenshot(), contentType: 'image/png' })
        const actions = favorite.getByRole('button', { name: common.peek.moreActions })
        if (width < 768) await expectTouchTarget(actions)
        await actions.focus()
        await page.keyboard.press('Enter')
        const rename = page.getByRole('menuitem', { name: common.savedViews.renameAction, exact: true })
        await expect(rename).toBeVisible()
        await testInfo.attach('sidebar-actions', { body: await page.screenshot(), contentType: 'image/png' })
        if (width < 768) await expectTouchTarget(rename)
        await rename.click()
        const dialog = page.getByRole('dialog', { name: common.savedViews.renameTitle })
        await dialog.getByLabel(common.savedViews.nameLabel, { exact: true }).fill('Service heute')
        const renameRequest = page.waitForRequest((request) => request.url().endsWith('/api/saved-views/saved-view-1') && request.method() === 'PATCH')
        await dialog.getByRole('button', { name: common.actions.save, exact: true }).click()
        expect((await renameRequest).postDataJSON()).toEqual({ name: 'Service heute', version: 1 })
        await expect(dialog).toBeHidden()
        await openFavorites()
        const renamed = navigation.locator('[data-sidebar="menu-item"]').filter({ has: page.getByRole('link', { name: 'Service heute' }) })
        await expect(renamed.getByRole('link')).toHaveAttribute('href', '/workshop/orders?search=Service')
        await renamed.getByRole('button', { name: common.peek.moreActions }).click()
        const share = page.getByRole('menuitem', { name: common.savedViews.shareAction, exact: true })
        if (width < 768) await expectTouchTarget(share)
        const shareRequest = page.waitForRequest((request) => request.url().endsWith('/api/saved-views/saved-view-1') && request.method() === 'PATCH')
        await share.click()
        expect((await shareRequest).postDataJSON()).toEqual({ visibility: 'TENANT', version: 2 })
        await expect(renamed.getByText(common.savedViews.teamBadge, { exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: menuName }).click()
        await expect(page.getByRole('dialog', { name: common.savedViews.menuTitle, exact: true })
          .getByRole('region', { name: common.savedViews.teamSection, exact: true })
          .getByText('Service heute', { exact: true })).toBeVisible()
      })
    }
  })
}

test('without shared-view permission neither surface shares or edits a read-only team view', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.addInitScript(() => window.localStorage.setItem('e2e-active-role', 'SALES'))
  await setupWorkshopOrdersForSaveView(page)
  await mockSavedViews(page, [
    savedView(),
    savedView({ id: 'team-2', name: 'Teamaufträge', visibility: 'TENANT', ownerUserId: 'another-user' }),
  ])
  await new AutoCorePage(page, '').navigate('/workshop/orders')
  const navigation = page.getByRole('navigation', { name: deNav.aria.mainNavigation })
  const personal = navigation.locator('[data-sidebar="menu-item"]').filter({ has: page.getByRole('link', { name: 'Serviceaufträge', exact: true }) })
  await personal.getByRole('button', { name: deCommon.peek.moreActions }).click()
  await expect(page.getByRole('menuitem', { name: deCommon.savedViews.renameAction })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: deCommon.savedViews.shareAction })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const team = navigation.locator('[data-sidebar="menu-item"]').filter({ has: page.getByRole('link', { name: 'Teamaufträge Team', exact: true }) })
  await expect(team).toBeVisible()
  await expect(team.getByRole('button')).toHaveCount(0)
  await page.getByRole('button', {
    name: deCommon.savedViews.menuAria.replace('{{title}}', deWorkshop.orders.list.saveViewTitle),
  }).click()
  const menu = page.getByRole('dialog', { name: 'Ansichten', exact: true })
  await expect(menu.getByRole('button', { name: 'Ansicht Serviceaufträge umbenennen' })).toBeVisible()
  await expect(menu.getByRole('button', { name: /mit Team teilen|Teilen.*aufheben|Teamaufträge umbenennen/ })).toHaveCount(0)
  await expect(menu.getByRole('button', { name: 'Ansicht Teamaufträge als eigene Ansicht speichern' })).toBeVisible()
})

type RectBox = { left: number; right: number; top: number; bottom: number }

async function textUnderDialogCloseButton(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const close = dialog?.querySelector<HTMLElement>('button .sr-only')?.closest('button')
    if (!dialog || !close) return ['no dialog or close button']
    const button: RectBox = close.getBoundingClientRect()
    const hits: string[] = []
    const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || close.contains(node)) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) {
        const overlaps =
          rect.left < button.right && rect.right > button.left && rect.top < button.bottom && rect.bottom > button.top
        if (overlaps && rect.width > 0) {
          hits.push(`"${node.textContent.trim().slice(0, 40)}" at ${Math.round(rect.left)}-${Math.round(rect.right)}`)
        }
      }
    }
    return hits
  })
}

async function setupWorkshopOrdersForSaveView(page: Page) {
  const createdViews: Array<{ name: string; href: string }> = []
  const order = createMockWorkshopOrder({
    id: 'wo-aut950-1',
    order_number: 'WO-2026-0950',
  })

  await mockCursorList(page, { path: '/api/workshop/orders', rows: [order] })
  await page.route(AutoCorePage.apiRouteMatcher('/api/saved-views'), async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
      return
    }
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string; href: string }
      createdViews.push(body)
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'sv-new', ...body, listPath: '/workshop/orders', visibility: 'PERSONAL', version: 1 }),
      })
      return
    }
    await route.continue()
  })

  return { createdViews }
}

type SaveViewLayoutScenario = {
  name: string
  viewport: { width: number; height: number }
  locale: 'de' | 'en'
  checkOverflow?: boolean
}

const SAVE_VIEW_LAYOUT_SCENARIOS: SaveViewLayoutScenario[] = [
  {
    name: 'WHEN the save-view dialog opens from /workshop/orders on desktop in DE THEN the full description is visible and does not run under the close button',
    viewport: { width: 1400, height: 900 },
    locale: 'de',
  },
  {
    name: 'WHEN the same dialog opens in EN THEN the translated description also clears the close button',
    viewport: { width: 1400, height: 900 },
    locale: 'en',
  },
  {
    name: 'WHEN the dialog opens at 375px THEN there is no text/X overlap and no horizontal overflow',
    viewport: { width: 375, height: 812 },
    locale: 'de',
    checkOverflow: true,
  },
]

test.describe('Save-view dialog layout and close control (AUT-880 / AUT-950)', () => {
  for (const scenario of SAVE_VIEW_LAYOUT_SCENARIOS) {
    test(scenario.name, async ({ page }) => {
      await page.setViewportSize(scenario.viewport)
      await setupWorkshopOrdersForSaveView(page)
      await new AutoCorePage(page, 'Order').navigate('/workshop/orders?search=Gruber')

      if (scenario.locale === 'en') {
        await page.getByRole('button', { name: DE_SHELL.user.accountEmail }).click()
        await page.getByTestId('language-option-en').click()
        await expect(page.locator('html')).toHaveAttribute('lang', 'en')
        await page.keyboard.press('Escape')
      }

      const common = scenario.locale === 'en' ? enCommon : deCommon
      const workshop = scenario.locale === 'en' ? enWorkshop : deWorkshop
      const triggerName = common.savedViews.saveAria.replace('{{title}}', workshop.orders.list.saveViewTitle)
      await page.getByRole('button', { name: triggerName }).click()

      const dialog = page.getByRole('dialog', { name: common.savedViews.title })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(common.savedViews.description)).toHaveCount(0)

      const closeButton = dialog.getByRole('button', { name: common.actions.close })
      const closeBox = await closeButton.boundingBox()
      expect(closeBox).not.toBeNull()
      expect(closeBox!.width).toBeGreaterThanOrEqual(44)
      expect(closeBox!.height).toBeGreaterThanOrEqual(44)

      expect(await textUnderDialogCloseButton(page), 'text under the close button').toEqual([])

      if (scenario.checkOverflow) {
        const dialogOverflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)
        expect(dialogOverflow).toBe(false)
        await expectNoPageScroll(page)
      }
    })
  }

  test('WHEN the X is used THEN the dialog closes and no view is saved', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    const { createdViews } = await setupWorkshopOrdersForSaveView(page)
    await new AutoCorePage(page, 'Order').navigate('/workshop/orders?search=Gruber')

    const triggerName = deCommon.savedViews.saveAria.replace('{{title}}', deWorkshop.orders.list.saveViewTitle)
    await page.getByRole('button', { name: triggerName }).click()

    const dialog = page.getByRole('dialog', { name: deCommon.savedViews.title })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: deCommon.actions.close }).click()
    await expect(dialog).toBeHidden()
    expect(createdViews).toEqual([])
  })
})
