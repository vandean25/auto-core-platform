import { expect, test } from '@playwright/test'
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockWorkshopOrder } from './utils/mock-factories'

const ORDER_ID = 'ws-check-in-offline-1'

test.describe('AUT-558: check-in offline draft', () => {
  test('keeps draft field values across reload while offline', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({
      id: ORDER_ID,
      order_number: 'WO-OFFLINE-1',
      status: 'INTAKE',
      odometer: 120000,
      fuel_level: 40,
    })

    let checkIn = {
      id: 'check-in-offline-1',
      workshop_order_id: ORDER_ID,
      status: 'DRAFT',
      revision: 2,
      condition_json: {
        schema_version: 1,
        tyre_season: 'UNKNOWN',
        exterior_notes: '',
        interior_notes: '',
      },
      damage_markers_json: [],
      items_left: '',
      key_count: 0,
      warning_lights: [],
      odometer: 120000,
      fuel_level: 40,
      inspection_id: null,
      content_sha256: null,
      completed_at: null,
      pdf_sha256: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(order),
        })
        return
      }
      await route.continue()
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/check-in`), async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkIn) })
        return
      }
      if (method === 'PATCH') {
        await route.abort('failed')
        return
      }
      await route.continue()
    })

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/check-in/media`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      },
    )

    await corePage.navigate(`/workshop/orders/${ORDER_ID}/check-in`)
    await expect(page.getByTestId('check-in-step-vehicle')).toBeVisible()

    const odometer = page.getByRole('spinbutton', { name: deWorkshop.checkIn.fields.odometer })
    await odometer.fill('120500')
    await page.waitForTimeout(2_000)

    await page.reload()
    await expect(page.getByTestId('check-in-step-vehicle')).toBeVisible()
    await expect(odometer).toHaveValue('120500')
  })
})
