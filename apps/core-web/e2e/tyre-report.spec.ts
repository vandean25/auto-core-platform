import { expect, test, type Locator, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockCustomer, createMockListResponse, createMockVehicle, createMockWorkshopOrder } from './utils/mock-factories'
import { waitForDeNamespace } from './helpers/wait-for-i18n'
import { deErrorCode } from './helpers/de-errors'
import { measurement } from '../src/features/tyre-report/tyre-report.test-fixtures'
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }
import deInventory from '../../../locales/de/inventory.json' with { type: 'json' }

const ORDER_ID = '80400000-0000-4000-8000-000000000001'
const CHECK_IN_ID = '80400000-0000-4000-8000-000000000002'
const TYRE_SET_ID = '80400000-0000-4000-8000-000000000003'
const VEHICLE_ID = '80400000-0000-4000-8000-000000000004'
const ORDER_PATH = `/workshop/orders/${ORDER_ID}`
const HOTEL_PATH = `/workshop/tyre-storage/${TYRE_SET_ID}`
const ORDER_ENDPOINT = `/api/workshop-orders/${ORDER_ID}/tyre-measurements`
const CHECK_IN_ENDPOINT = `/api/workshop-check-ins/${CHECK_IN_ID}/tyre-measurements`
const HOTEL_ENDPOINT = `/api/tyre-sets/${TYRE_SET_ID}/inspect`
const report = deWorkshop.tyreReport
const POSITIONS = ['FL', 'FR', 'RL', 'RR'] as const
const POINTS = ['treadInnerMm', 'treadMiddleMm', 'treadOuterMm'] as const

type Measurement = typeof measurement
type Submission = { endpoint: string; body: { weightClass: string; wheels: Array<Record<string, unknown>> } }

async function mockTyreReport(page: Page, role = 'ADMIN', signed = false) {
  await page.addInitScript((activeRole) => {
    localStorage.setItem('e2e-active-role', activeRole)
    localStorage.setItem('e2e-active-site-id', 'e2e-site-1')
  }, role)
  const vehicle = createMockVehicle({ id: VEHICLE_ID, plate: 'W-SYNTH-804' })
  const order = createMockWorkshopOrder({
    id: ORDER_ID, vehicle, tasks: [],
    customer: createMockCustomer({ first_name: 'pilot', last_name: 'customer', email: 'pilot@example.com' }),
  })
  let latest: Measurement = {
    ...measurement, workshopOrderId: ORDER_ID, checkInId: CHECK_IN_ID,
    vehicleId: VEHICLE_ID, measuredByName: 'Synthetic inspector',
  }
  let hotelStatus = 'IN_STORAGE'
  const submissions: Submission[] = []
  const forbiddenOrderFetches: string[] = []
  const completions: unknown[] = []
  const checkIn = {
    id: CHECK_IN_ID, workshop_order_id: ORDER_ID, status: 'DRAFT', revision: 1,
    condition_json: { schema_version: 1, tyre_season: 'UNKNOWN', exterior_notes: '', interior_notes: '' },
    damage_markers_json: [], items_left: '', key_count: 0, warning_lights: [],
    odometer: 88000, fuel_level: 60, inspection_id: null, content_sha256: null,
    completed_at: null, pdf_sha256: null,
    signature_media_id: signed ? 'signature-synthetic-804' : null,
    signed_by_name: signed ? 'pilot customer' : null,
    created_at: '2026-10-29T12:00:00Z', updated_at: '2026-10-29T12:00:00Z',
  }
  const tyreSet = () => ({
    id: TYRE_SET_ID, customerId: order.customer.id, vehicleId: VEHICLE_ID,
    siteId: 'e2e-site-1', locationId: 'rack-804', locationCode: 'SYNTH-A',
    label: 'Synthetic tyre set 804', season: 'SUMMER', tyreCount: 4, rimType: 'ALLOY',
    brand: 'Example', model: 'Road', dimension: '205/55 R16', dotCodes: ['1220'],
    treadDepthMm: 3.5, conditionNotes: null, status: hotelStatus,
    storedSince: '2026-10-01', plannedSwapOn: null, binLabel: 'A-804',
    customerName: 'pilot customer', vehiclePlate: vehicle.plate, events: [],
    latestMeasurement: { ...latest, tyreSetId: TYRE_SET_ID },
  })

  // Anchor at the origin so Vite's /src/api/ modules remain JavaScript.
  // Never forward an unhandled API request to a backend, including writes.
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const endpoint = new URL(route.request().url()).pathname
    const method = route.request().method()
    const json = (body: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    })
    if ([ORDER_ENDPOINT, CHECK_IN_ENDPOINT, HOTEL_ENDPOINT].includes(endpoint) && method === 'POST') {
      const body = route.request().postDataJSON() as Submission['body']
      submissions.push({ endpoint, body })
      if (body.wheels.some((wheel) => wheel.dot === '5420')) {
        return json({ statusCode: 400, code: 'TYRE_DOT_INVALID_WEEK', params: { position: 'FL' } }, 400)
      }
      latest = {
        ...latest, id: 'measurement-saved-804',
        wheels: latest.wheels.map((wheel) => ({
          ...wheel, ...body.wheels.find((entry) => entry.position === wheel.position),
        })),
      }
      return json(endpoint === HOTEL_ENDPOINT ? tyreSet() : latest, 201)
    }
    if ([ORDER_ENDPOINT, CHECK_IN_ENDPOINT].includes(endpoint)) return json(createMockListResponse([latest]))
    if (endpoint === `/api/workshop/orders/${ORDER_ID}`) {
      if (role === 'TECH') {
        forbiddenOrderFetches.push(endpoint)
        return json({ message: 'Office order access forbidden for TECH' }, 403)
      }
      return json(order)
    }
    if (endpoint === `/api/vehicles/${VEHICLE_ID}`) return json(vehicle)
    if (endpoint === `/api/tyre-sets/${TYRE_SET_ID}`) return json(tyreSet())
    if (endpoint === `/api/workshop/orders/${ORDER_ID}/check-in`) {
      if (method === 'PATCH') Object.assign(checkIn, route.request().postDataJSON(), { revision: checkIn.revision + 1 })
      return json(checkIn)
    }
    if (endpoint.endsWith('/check-in/complete') && method === 'POST') {
      completions.push(route.request().postDataJSON())
      Object.assign(checkIn, { status: 'COMPLETED', completed_at: '2026-10-29T12:30:00Z' })
      return json(checkIn)
    }
    if (endpoint.endsWith('/check-in/inspection')) return json({}, 404)
    if (endpoint.endsWith('/check-in/media')) return json({ data: [] })
    if (endpoint === '/api/search') return json({ groups: [] })
    if (endpoint === '/api/workshop/resources') return json({ mechanics: [], bays: [] })
    if (endpoint === '/api/inventory/locations') return json([])
    if (endpoint === '/api/me/sites') return json([])
    if (endpoint.startsWith('/api/tyre-sets/by-')) return json([])
    if (method !== 'GET') return json({ message: 'Unexpected synthetic write' }, 400)
    return json(createMockListResponse([]))
  })
  await page.route('**/socket.io/**', (route) => route.fulfill({ status: 403, body: '' }))
  return { submissions, completions, forbiddenOrderFetches, setHotelStatus: (status: string) => { hotelStatus = status } }
}

async function navigateToPlacement(page: Page, placement: 'order' | 'check-in' | 'hotel') {
  const path = placement === 'hotel' ? HOTEL_PATH : placement === 'check-in' ? `${ORDER_PATH}/check-in` : ORDER_PATH
  const localeReady = waitForDeNamespace(page, placement === 'hotel' ? 'inventory' : 'workshop', 1000)
  await new AutoCorePage(page, report.title).navigate(path)
  await localeReady
  if (placement === 'check-in') {
    await expect(page.getByTestId('check-in-step-vehicle')).toBeVisible()
    await page.getByTestId('check-in-next').click()
    await expect(page.getByTestId('check-in-step-condition')).toBeVisible()
  }
  await expect(page.getByTestId('tyre-wheel-layout')).toBeVisible()
}

async function fillMeasurement(scope: Locator) {
  for (const position of POSITIONS) {
    for (const point of POINTS) {
      await scope.getByRole('spinbutton', { name: `${report.positions[position]} ${report.fields[point]}`, exact: true }).fill('4.25')
    }
    await scope.getByRole('textbox', { name: `${report.positions[position]} ${report.fields.dot}`, exact: true }).fill('1220')
    await scope.getByRole('textbox', { name: `${report.positions[position]} ${report.fields.brand}`, exact: true }).fill('Saved synthetic brand')
  }
}

async function openMeasurement(page: Page, entity: 'workOrder' | 'tyreSet') {
  await page.locator(`[data-action-id="${entity}.recordTyreMeasurement"]`).click()
  const dialog = page.getByRole('dialog', { name: report.record })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/action=recordTyreMeasurement/)
  if (entity === 'tyreSet') await dialog.getByRole('checkbox', { name: report.record, exact: true }).check()
  return dialog
}

async function assertNoOverflow(scope: Locator) {
  expect(await scope.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
}

function assertSubmission(submission: Submission, endpoint: string) {
  expect(submission.endpoint).toBe(endpoint)
  expect(submission.body.weightClass).toBe('UP_TO_3500_KG')
  expect(submission.body.wheels.map((wheel) => wheel.position)).toEqual(POSITIONS)
  for (const wheel of submission.body.wheels) {
    expect(wheel).toMatchObject({ treadInnerMm: 4.25, treadMiddleMm: 4.25, treadOuterMm: 4.25, dot: '1220' })
  }
}

test.describe('Synthetic tyre reports', () => {
  for (const width of [1440, 375]) {
    for (const placement of ['order', 'check-in', 'hotel'] as const) {
      test(`${placement} shows report cards without overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 })
        await mockTyreReport(page)
        await navigateToPlacement(page, placement)
        await expect(page.getByText('Bewertung und Grenzwerte')).toHaveCount(0)
        const layout = page.getByTestId('tyre-wheel-layout')
        for (const position of POSITIONS) {
          const card = layout.getByRole('article', { name: report.positions[position], exact: true })
          await expect(card).toBeVisible()
          await expect(card).toContainText('205/55 R16')
          await expect(card.locator('[data-worst-point="true"]')).toHaveText('3,5 mm')
          await expect(card).toContainText(report.reasons.TREAD_REPLACEMENT_RECOMMENDED)
          await assertNoOverflow(card)
        }
        await assertNoOverflow(layout)
        await assertNoOverflow(page.locator('html'))
        if (placement !== 'check-in') {
          const dialog = await openMeasurement(page, placement === 'hotel' ? 'tyreSet' : 'workOrder')
          await assertNoOverflow(dialog)
          await expect(dialog.getByRole('spinbutton', { name: `${report.positions.FL} ${report.fields.treadInnerMm}`, exact: true })).toBeVisible()
        }
      })
    }
  }

  test('work order maps a server DOT error to the wheel field and saves the corrected measurement', async ({ page }) => {
    const state = await mockTyreReport(page)
    await navigateToPlacement(page, 'order')
    const dialog = await openMeasurement(page, 'workOrder')
    await fillMeasurement(dialog)
    const dot = dialog.getByRole('textbox', { name: `${report.positions.FL} ${report.fields.dot}`, exact: true })
    await dot.fill('5420')
    await dialog.getByRole('button', { name: report.save, exact: true }).click()
    await expect(dot).toHaveAttribute('aria-invalid', 'true')
    await expect(dot).toBeFocused()
    await expect(dialog.getByText(deErrorCode('TYRE_DOT_INVALID_WEEK'), { exact: true })).toBeVisible()
    await expect(dot).toHaveAttribute('aria-describedby', 'wheels.0.dot-error')
    await expect(dialog).toBeVisible()
    await dot.fill('1220')
    await dialog.getByRole('button', { name: report.save, exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page).not.toHaveURL(/action=recordTyreMeasurement/)
    await expect(page.getByTestId('tyre-wheel-layout').getByRole('article').first()).toContainText('Saved synthetic brand')
    expect(state.submissions).toHaveLength(2)
    assertSubmission(state.submissions[1], ORDER_ENDPOINT)
  })

  test('check-in keeps an unsaved measurement across steps and posts to the check-in endpoint', async ({ page }) => {
    const state = await mockTyreReport(page)
    await navigateToPlacement(page, 'check-in')
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: report.save, exact: true }) })
    await fillMeasurement(form)
    await page.getByTestId('check-in-next').click()
    await expect(page.getByTestId('check-in-step-review')).toBeVisible()
    await expect(form).toBeHidden()
    await page.getByRole('button', { name: deWorkshop.checkIn.actions.back, exact: true }).click()
    await expect(form.getByRole('spinbutton', { name: `${report.positions.FL} ${report.fields.treadInnerMm}`, exact: true })).toHaveValue('4.25')
    await form.getByRole('button', { name: report.save, exact: true }).click()
    await expect(page.getByTestId('tyre-wheel-layout').getByRole('article').first()).toContainText('Saved synthetic brand')
    expect(state.submissions).toHaveLength(1)
    assertSubmission(state.submissions[0], CHECK_IN_ENDPOINT)
  })

  test('full and legacy DOT identifiers are submitted unchanged', async ({ page }) => {
    const state = await mockTyreReport(page)
    await navigateToPlacement(page, 'order')
    const dialog = await openMeasurement(page, 'workOrder')
    await fillMeasurement(dialog)
    await dialog.getByRole('textbox', { name: `${report.positions.FL} ${report.fields.dot}`, exact: true }).fill('DOT ABC4 1220')
    await dialog.getByRole('textbox', { name: `${report.positions.FR} ${report.fields.dot}`, exact: true }).fill('DOT ABC4 120')
    await dialog.getByRole('button', { name: report.save, exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(state.submissions[0].body.wheels[0].dot).toBe('DOT ABC4 1220')
    expect(state.submissions[0].body.wheels[1].dot).toBe('DOT ABC4 120')
  })

  for (const resolution of ['save', 'discard'] as const) {
    test(`check-in cannot complete unsaved readings until ${resolution}`, async ({ page }) => {
      const state = await mockTyreReport(page, 'ADMIN', true)
      await navigateToPlacement(page, 'check-in')
      const form = page.locator('form').filter({ has: page.getByRole('button', { name: report.save, exact: true }) })
      await fillMeasurement(form)
      await page.getByTestId('check-in-next').click()
      await page.getByRole('checkbox', { name: deWorkshop.checkIn.review.signatureAcknowledgementAria, exact: true }).check()
      await expect(page.getByTestId('check-in-complete')).toBeDisabled()
      await expect(page.getByRole('alert')).toHaveText(report.unsavedCheckIn)
      expect(state.completions).toEqual([])
      await page.getByRole('button', { name: deWorkshop.checkIn.actions.back, exact: true }).click()
      if (resolution === 'save') {
        await form.getByRole('button', { name: report.save, exact: true }).click()
        await expect(form.getByRole('button', { name: report.discard, exact: true })).toHaveCount(0)
      } else {
        await form.getByRole('button', { name: report.discard, exact: true }).click()
        await page.getByRole('alertdialog').getByRole('button', { name: report.confirmDiscard, exact: true }).click()
        await expect(form.getByRole('spinbutton').first()).toHaveValue('')
      }
      await page.getByTestId('check-in-next').click()
      await expect(page.getByTestId('check-in-complete')).toBeEnabled()
      await page.getByTestId('check-in-complete').click()
      await expect(page.getByTestId('check-in-complete')).toHaveCount(0)
      expect(state.completions).toHaveLength(1)
      expect(state.submissions).toHaveLength(resolution === 'save' ? 1 : 0)
    })
  }

  test('hotel inspection opt-in saves wheel measurements and refreshes the latest report', async ({ page }) => {
    const state = await mockTyreReport(page)
    await navigateToPlacement(page, 'hotel')
    const dialog = await openMeasurement(page, 'tyreSet')
    await expect(dialog.getByText(report.noHotelPhotos)).toBeVisible()
    await expect(dialog.locator('input[type="file"]')).toHaveCount(0)
    await fillMeasurement(dialog)
    await dialog.getByRole('button', { name: report.save, exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByTestId('tyre-wheel-layout').getByRole('article').first()).toContainText('Saved synthetic brand')
    expect(state.submissions).toHaveLength(1)
    assertSubmission(state.submissions[0], HOTEL_ENDPOINT)
  })

  for (const { role, placement } of [
    { role: 'ADMIN', placement: 'order' }, { role: 'ADMIN', placement: 'hotel' },
    { role: 'TECH', placement: 'order' }, { role: 'TECH', placement: 'hotel' },
  ] as const) {
    test(`${role} reaches the same ${placement} inspection dialog through its registry button and Cmd+K`, async ({ page }) => {
      const state = await mockTyreReport(page, role)
      await navigateToPlacement(page, placement)
      const entity = placement === 'hotel' ? 'tyreSet' : 'workOrder'
      const dialog = await openMeasurement(page, entity)
      await expect(dialog.getByRole('spinbutton', { name: `${report.positions.FL} ${report.fields.treadInnerMm}`, exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      await page.keyboard.press('ControlOrMeta+k')
      const option = page.getByRole('option', { name: new RegExp(report.record) })
      await expect(option).toBeVisible()
      await option.click()
      await expect(dialog).toBeVisible()
      await expect(page).toHaveURL(/action=recordTyreMeasurement/)
      if (placement === 'hotel') {
        await dialog.getByRole('checkbox', { name: report.record, exact: true }).check()
        await expect(dialog.getByRole('spinbutton', { name: `${report.positions.FL} ${report.fields.treadInnerMm}`, exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        if (role === 'TECH') {
          await expect(page.getByRole('button', { name: deInventory.actions.checkOut, exact: true })).toHaveCount(0)
          state.setHotelStatus('RETURNED')
          await navigateToPlacement(page, 'hotel')
          await expect(page.getByRole('button', { name: deInventory.actions.checkIn, exact: true })).toHaveCount(0)
          await expect(page.locator('[data-action-id="tyreSet.recordTyreMeasurement"]')).toBeVisible()
        }
      }
      if (role === 'TECH') expect(state.forbiddenOrderFetches).toEqual([])
    })
  }
})
