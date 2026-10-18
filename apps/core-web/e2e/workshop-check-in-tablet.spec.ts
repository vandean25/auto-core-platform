import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockWorkshopOrder } from './utils/mock-factories'
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }

const ORDER_ID = 'ws-check-in-tablet-1'
const CHECK_IN_ID = '51500000-0000-4000-8000-000000000557'
const E2E_SITE_ID = 'e2e-site-1'

test.use({
  viewport: { width: 834, height: 1194 },
  isMobile: true,
  hasTouch: true,
})

test.describe('AUT-557: workshop check-in tablet flow', () => {
  test('three-screen flow with autosave, upload, and conflict recovery', async ({
    page,
  }) => {
    await page.addInitScript((siteId) => {
      window.localStorage.setItem('e2e-active-site-id', siteId)
    }, E2E_SITE_ID)

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
          const purposeMatch = postData.match(
            /name="purpose"\r?\n\r?\n(CHECK_IN|[^\r\n]+)/,
          )
          uploadPurpose = purposeMatch?.[1]
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
      timeout: 10_000,
    })
    const conflictDialog = page.getByTestId('check-in-conflict-dialog')
    await expect(conflictDialog).toBeVisible({ timeout: 5_000 })
    await page
      .getByRole('button', { name: deWorkshop.checkIn.offline.conflict.keepServer })
      .click()
    await expect(
      page.getByRole('spinbutton', { name: deWorkshop.checkIn.fields.odometer }),
    ).toHaveValue('89000', { timeout: 5_000 })

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
    await expect(page.getByText(deWorkshop.checkIn.media.queued)).toBeVisible({
      timeout: 5000,
    })
    await expect.poll(() => uploadPurpose, { timeout: 10_000 }).toBe('CHECK_IN')

    await page.getByTestId('check-in-next').click()
    await expect(page.getByTestId('check-in-step-review')).toBeVisible()
    await expect(page.getByTestId('check-in-signature-slot')).toBeVisible()

    const signatureMediaId = 'media-signature-1'
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/check-in/complete`),
      async (route) => {
        const body = route.request().postDataJSON() as {
          signature_media_id: string
          signed_by_name: string
        }
        expect(body.signature_media_id).toBe(signatureMediaId)
        expect(body.signed_by_name).toBe('Signer Example')
        checkIn = {
          ...checkIn,
          status: 'COMPLETED',
          revision: revision + 1,
          signed_by_name: body.signed_by_name,
          signature_media_id: body.signature_media_id,
          signed_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(checkIn),
        })
      },
    )

    await page.getByTestId('check-in-signed-by-name').fill('Signer Example')
    await page.getByRole('checkbox', { name: deWorkshop.checkIn.review.signatureAcknowledgementAria }).check()

    await page.getByTestId('check-in-signature-canvas').evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement
      const ctx = element.getContext('2d')
      if (!ctx) {
        return
      }
      element.width = 320
      element.height = 160
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(20, 80)
      ctx.lineTo(140, 40)
      ctx.lineTo(260, 90)
      ctx.stroke()
    })

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/check-in/media`),
      async (route) => {
        if (route.request().method() === 'POST') {
          const postData = route.request().postData() ?? ''
          const purposeMatch = postData.match(
            /name="purpose"\r?\n\r?\n(CHECK_IN_SIGNATURE|CHECK_IN)/,
          )
          uploadPurpose = purposeMatch?.[1]
          revision += 1
          checkIn = { ...checkIn, revision }
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              id: signatureMediaId,
              purpose: 'CHECK_IN_SIGNATURE',
              mime_type: 'image/png',
              size_bytes: 2048,
              preview_url: null,
              processing_status: 'READY',
            }),
          })
          return
        }
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: [
                {
                  id: 'media-check-in-1',
                  purpose: 'CHECK_IN',
                  mime_type: 'image/jpeg',
                  size_bytes: 1024,
                  preview_url: null,
                  processing_status: 'READY',
                },
              ],
            }),
          })
          return
        }
        await route.continue()
      },
    )

    await page.getByTestId('check-in-complete').click()
    await expect(page.getByText(deWorkshop.checkIn.complete.success)).toBeVisible({
      timeout: 5000,
    })
    expect(uploadPurpose).toBe('CHECK_IN_SIGNATURE')
  })
})
