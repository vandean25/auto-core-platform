import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockWorkshopOrder } from './utils/mock-factories'
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }

const ORDER_ID = 'ws-check-in-tablet-1'
const CHECK_IN_ID = '51500000-0000-4000-8000-000000000557'

test.use({
  viewport: { width: 834, height: 1194 },
  isMobile: true,
  hasTouch: true,
})

test.describe('AUT-557: workshop check-in tablet flow', () => {
  test('three-screen flow with autosave, upload, and conflict recovery', async ({
    page,
  }) => {
    const corePage = new AutoCorePage(page, 'Order')
    const order = createMockWorkshopOrder({
      id: ORDER_ID,
      order_number: 'WO-2026-1017',
      status: 'INTAKE',
      odometer: 88000,
      fuel_level: 60,
    })

    let revision = 1
    let checkIn = {
      id: CHECK_IN_ID,
      workshop_order_id: ORDER_ID,
      status: 'DRAFT',
      revision,
      condition_json: {
        schema_version: 1,
        tyre_season: 'UNKNOWN',
        exterior_notes: '',
        interior_notes: '',
      },
      damage_markers_json: [] as unknown[],
      items_left: '',
      key_count: 0,
      warning_lights: [] as string[],
      odometer: 88000,
      fuel_level: 60,
      inspection_id: null,
      content_sha256: null,
      completed_at: null,
      pdf_sha256: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    let patchCount = 0

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/check-in`), async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkIn) })
        return
      }
      if (method === 'POST') {
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(checkIn) })
        return
      }
      if (method === 'PATCH') {
        const body = route.request().postDataJSON() as { expected_revision: number; odometer?: number }
        patchCount += 1
        if (patchCount === 1) {
          revision = 99
          checkIn = {
            ...checkIn,
            revision,
            odometer: 89000,
            updated_at: new Date().toISOString(),
          }
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 'CHECK_IN_CONFLICT',
              message: 'stale',
            }),
          })
          return
        }
        if (body.expected_revision !== revision) {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 'CHECK_IN_CONFLICT',
              message: 'stale',
            }),
          })
          return
        }
        revision += 1
        checkIn = {
          ...checkIn,
          revision,
          odometer: body.odometer ?? checkIn.odometer,
          updated_at: new Date().toISOString(),
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(checkIn) })
        return
      }
      await route.continue()
    })

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/check-in/inspection`),
      async (route) => {
        await route.fulfill({ status: 404 })
      },
    )

    let uploadPurpose: string | undefined
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/check-in/media`),
      async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
          return
        }
        if (route.request().method() === 'POST') {
          const postData = route.request().postData() ?? ''
          uploadPurpose = postData.includes('name="purpose"') ? 'CHECK_IN' : undefined
          const mediaId = 'media-check-in-1'
          revision += 1
          checkIn = { ...checkIn, revision }
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              id: mediaId,
              purpose: 'CHECK_IN',
              mime_type: 'image/jpeg',
              size_bytes: 1024,
              preview_url: null,
              processing_status: 'READY',
            }),
          })
          return
        }
        await route.continue()
      },
    )

    await corePage.navigate(`/workshop/orders/${ORDER_ID}/check-in`)

    await expect(page.getByTestId('check-in-step-vehicle')).toBeVisible()
    await page
      .getByRole('spinbutton', { name: deWorkshop.checkIn.fields.odometer })
      .fill('88100')

    await expect(page.getByText(deWorkshop.checkIn.errors.CHECK_IN_CONFLICT)).toBeVisible({
      timeout: 5000,
    })
    await expect(
      page.getByRole('spinbutton', { name: deWorkshop.checkIn.fields.odometer }),
    ).toHaveValue('89000')

    await page
      .getByRole('spinbutton', { name: deWorkshop.checkIn.fields.odometer })
      .fill('89100')
    await expect(page.getByTestId('check-in-save-indicator')).toContainText(
      deWorkshop.checkIn.save.saved,
      { timeout: 5000 },
    )

    await page.getByTestId('check-in-next').click()
    await expect(page.getByTestId('check-in-step-condition')).toBeVisible()

    const captureButton = page.getByRole('button', { name: deWorkshop.checkIn.media.capture })
    await expect(captureButton).toHaveCSS('min-height', '44px')

    const fixture = await readFile(
      new URL('../../../apps/core-api/src/common/media/fixtures/gps-oriented.jpg', import.meta.url),
    )
    await page.getByTestId('check-in-camera-input').setInputFiles({
      name: 'check-in.jpg',
      mimeType: 'image/jpeg',
      buffer: fixture,
    })
    await expect(page.getByText(deWorkshop.checkIn.media.uploaded)).toBeVisible({
      timeout: 5000,
    })
    expect(uploadPurpose).toBe('CHECK_IN')

    await page.getByTestId('check-in-next').click()
    await expect(page.getByTestId('check-in-step-review')).toBeVisible()
    await expect(page.getByTestId('check-in-signature-slot')).toBeVisible()
  })
})
