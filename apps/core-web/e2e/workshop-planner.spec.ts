import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_WORKSHOP } from './helpers/de-workshop'
import { createMockBay } from './utils/mock-factories'
import { TouchGestureClient } from './utils/touch-gestures'

const P = DE_WORKSHOP.planner

test.describe('Blueprint: Workshop Planner', () => {
  const BAY_ID = 'bay-planner-001'
  const mockBay = createMockBay({
    id: BAY_ID,
    name: 'Planner Bay 01',
    isActive: true,
    sortOrder: 1,
  })

  const mockPlanner = {
    timezone: 'Europe/Vienna',
    slotMinutes: 60,
    range: {
      from: '2026-08-21T05:30:00.000Z',
      to: '2026-08-22T05:30:00.000Z',
    },
    bays: [mockBay],
    openings: [
      { weekday: 1, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 2, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 3, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 4, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 6, isClosed: false, openTime: '08:00', closeTime: '12:00' },
      { weekday: 7, isClosed: true, openTime: '07:30', closeTime: '17:00' },
    ],
    holidays: [
      {
        date: '2026-12-24',
        name: 'Nationalfeiertag',
        isClosed: true,
        openTime: null,
        closeTime: null,
      },
    ],
    employeesAway: [],
    bookings: [],
  }

  async function setupPlannerRoutes(page: import('@playwright/test').Page, planner = mockPlanner) {
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/settings'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          timezone: planner.timezone,
          slotMinutes: planner.slotMinutes,
          holidayCountryIso: 'AT',
          holidaySubdivisionCode: null,
          openingHours: planner.openings,
        }),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/planner'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(planner),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mechanics: [], bays: planner.bays }),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/search'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            vehicles: [
              {
                id: 'veh-1',
                make: 'VW',
                model: 'Golf',
                year: 2020,
                plate: 'W-12345',
                customer: {
                  id: 'cust-1',
                  first_name: 'Max',
                  last_name: 'Mustermann',
                },
              },
            ],
            customers: [],
          },
          meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
        }),
      })
    })
  }

  test('Planner renders header, toggle, and create action', async ({ page }) => {
    const corePage = new AutoCorePage(page, P.page.title)
    await setupPlannerRoutes(page)
    await corePage.navigate('/workshop/planner?date=2026-08-21')

    await expect(page.getByRole('heading', { name: P.page.title, exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: P.viewMode.day })).toBeVisible()
    await expect(page.getByRole('radio', { name: P.viewMode.week })).toBeVisible()
    await expect(page.getByRole('button', { name: P.page.createOrder })).toBeVisible()
  })

  test('Creates booking from empty day slot', async ({ page }) => {
    const corePage = new AutoCorePage(page, P.page.title)
    await setupPlannerRoutes(page)

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'order-new',
            order_number: 'WO-2026-0200',
            status: 'SCHEDULED',
          }),
        })
        return
      }
      await route.continue()
    })

    await page.route(new RegExp(`.*/api/workshop/orders/order-new(\\?.*)?$`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'order-new',
          order_number: 'WO-2026-0200',
          status: 'SCHEDULED',
          customer: { id: 'cust-1', first_name: 'Max', last_name: 'Mustermann' },
          vehicle: { id: 'veh-1', make: 'VW', model: 'Golf', year: 2020, plate: 'W-12345' },
          tasks: [],
        }),
      })
    })

    await corePage.navigate('/workshop/planner?date=2026-08-21')
    await page.getByRole('button', { name: P.grid.bookSlot.replace('{{label}}', '09:30') }).click()
    await page.getByPlaceholder(P.createSheet.searchPlaceholder).fill('W-12345')
    await page.getByText('2020 VW Golf').click()
    await page.getByRole('button', { name: P.page.createOrder }).click()

    await expect(page.getByText(P.createSheet.toastScheduled)).toBeVisible()
    // The order page also repeats the number in its breadcrumb trail (AUT-475), so assert the heading.
    await expect(page.getByRole('heading', { name: 'WO-2026-0200' })).toBeVisible()
  })

  test('Shows no bays empty state', async ({ page }) => {
    const corePage = new AutoCorePage(page, P.page.title)
    await setupPlannerRoutes(page, { ...mockPlanner, bays: [] })
    await corePage.navigate('/workshop/planner')

    await expect(page.getByText(P.page.noBaysTitle)).toBeVisible()
    await expect(page.getByRole('button', { name: P.page.goToSettings })).toBeVisible()
  })

  test('Create booking shows collision toast on 409', async ({ page }) => {
    const corePage = new AutoCorePage(page, P.page.title)
    await setupPlannerRoutes(page)

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Bay is already occupied by WO-2026-0099' }),
        })
        return
      }
      await route.continue()
    })

    await corePage.navigate('/workshop/planner?date=2026-08-21')
    await page.getByRole('button', { name: P.page.createOrder }).click()
    await page.getByPlaceholder(P.createSheet.searchPlaceholder).fill('W-12345')
    await page.getByText('2020 VW Golf').click()
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Planner Bay 01' }).click()
    await page.locator('#planner-start').fill('2026-08-21T09:00')
    await page.locator('#planner-end').fill('2026-08-21T10:00')
    await page.getByRole('button', { name: P.page.createOrder }).click()

    await expect(page.getByText('Bay is already occupied by WO-2026-0099')).toBeVisible()
  })

  test('Closed weekday empty state copy', async ({ page }) => {
    const corePage = new AutoCorePage(page, P.page.title)
    const closedPlanner = {
      ...mockPlanner,
      openings: mockPlanner.openings.map((row) => ({ ...row, isClosed: true })),
    }

    await setupPlannerRoutes(page, closedPlanner)
    await page.addInitScript(() => {
      window.localStorage.setItem('workshop-planner-view', 'day')
    })

    await corePage.navigate('/workshop/planner?date=2026-08-21')
    await expect(page.getByText(P.page.closedTitle)).toBeVisible()
    await expect(page.getByRole('button', { name: P.page.goToSettings })).toBeVisible()
  })

  test('Closed holiday empty state copy', async ({ page }) => {
    const corePage = new AutoCorePage(page, P.page.title)
    await setupPlannerRoutes(page)
    await page.addInitScript(() => {
      window.localStorage.setItem('workshop-planner-view', 'day')
    })

    await corePage.navigate('/workshop/planner?date=2026-12-24')
    await expect(
      page.getByText(P.grid.closedWithHoliday.replace('{{name}}', 'Nationalfeiertag')),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: P.page.goToSettings })).toBeVisible()
  })

  test('Short holiday uses shortened slot labels', async ({ page }) => {
    const corePage = new AutoCorePage(page, P.page.title)
    const shortHolidayPlanner = {
      ...mockPlanner,
      holidays: [
        {
          date: '2026-08-21',
          name: 'Bridge day',
          isClosed: false,
          openTime: '10:00',
          closeTime: '12:00',
        },
      ],
    }

    await setupPlannerRoutes(page, shortHolidayPlanner)
    await corePage.navigate('/workshop/planner?date=2026-08-21')

    await expect(
      page.getByRole('button', { name: P.grid.bookSlot.replace('{{label}}', '10:00') }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: P.grid.bookSlot.replace('{{label}}', '11:00') }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: P.grid.bookSlot.replace('{{label}}', '07:30') }),
    ).toHaveCount(0)
  })

  // AUT-1065: WHEN /workshop/planner renders at 390px THEN every bay row, including its chips, is fully visible.
  test('WHEN /workshop/planner renders at 390px THEN every bay row, including its chips, is fully visible', async ({
    page,
  }, testInfo) => {
    const bay1 = createMockBay({ id: 'bay-1065-1', name: 'Bay 1', isActive: true, sortOrder: 1 })
    const bay2 = createMockBay({ id: 'bay-1065-2', name: 'Bay 2', isActive: true, sortOrder: 2 })
    const plannerWithTwoBays = {
      ...mockPlanner,
      bays: [bay1, bay2],
      bookings: [
        {
          orderId: 'order-1065-1',
          orderNumber: 'WO-2026-1065',
          status: 'SCHEDULED',
          occupancyKind: 'BOOKING',
          bayId: bay1.id,
          mechanicId: 'mech-1',
          mechanicName: 'Max Mustermann',
          scheduledStartAt: '2026-08-21T07:00:00.000Z',
          scheduledEndAt: '2026-08-21T09:00:00.000Z',
          vehicle: { id: 'v-1', make: 'VW', model: 'Golf', plate: 'W-1065A' },
          customer: { id: 'c-1', name: 'Kunde Eins' },
        },
        {
          orderId: 'order-1065-2',
          orderNumber: 'WO-2026-1066',
          status: 'IN_PROGRESS',
          occupancyKind: 'BOOKING',
          bayId: bay2.id,
          mechanicId: 'mech-2',
          mechanicName: 'Anna Gruber',
          scheduledStartAt: '2026-08-21T08:00:00.000Z',
          scheduledEndAt: '2026-08-21T10:00:00.000Z',
          vehicle: { id: 'v-2', make: 'Audi', model: 'A4', plate: 'W-1065B' },
          customer: { id: 'c-2', name: 'Kunde Zwei' },
        },
      ],
    }

    await page.setViewportSize({ width: 390, height: 812 })
    await setupPlannerRoutes(page, plannerWithTwoBays)
    await new AutoCorePage(page, P.page.title).navigate('/workshop/planner?date=2026-08-21')

    for (const orderId of ['order-1065-1', 'order-1065-2']) {
      const chip = page.getByTestId(`planner-booking-${orderId}`)
      await expect(chip).toBeVisible()
      const geometry = await chip.evaluate((el) => {
        const chipBox = el.getBoundingClientRect()
        const gridContainer = el.closest('.overflow-x-auto')
        const gridBox = gridContainer?.getBoundingClientRect()
        return {
          chipBottom: chipBox.bottom,
          chipTop: chipBox.top,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          gridBottom: gridBox ? gridBox.bottom : null,
          gridTop: gridBox ? gridBox.top : null,
        }
      })
      expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight + 1)
      if (geometry.gridBottom !== null && geometry.gridTop !== null) {
        expect(geometry.chipTop).toBeGreaterThanOrEqual(geometry.gridTop - 1)
        expect(geometry.chipBottom).toBeLessThanOrEqual(geometry.gridBottom + 1)
      }
    }

    await testInfo.attach('workshop-planner-de-390', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByTestId('planner-booking-order-1065-2')).toBeVisible()
    await testInfo.attach('workshop-planner-de-1280', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})

test.describe('AUT-1035: Workshop planner touch drag-and-drop', () => {
  test.use({ hasTouch: true })

  const BAY_1_ID = 'bay-planner-001'
  const BAY_2_ID = 'bay-planner-002'
  const ORDER_ID = 'order-planner-touch-1'

  const touchPlannerPayload = {
    timezone: 'Europe/Vienna',
    slotMinutes: 60,
    range: {
      from: '2026-08-21T05:30:00.000Z',
      to: '2026-08-22T05:30:00.000Z',
    },
    bays: [
      createMockBay({ id: BAY_1_ID, name: 'Planner Bay 01', isActive: true, sortOrder: 1 }),
      createMockBay({ id: BAY_2_ID, name: 'Planner Bay 02', isActive: true, sortOrder: 2 }),
      createMockBay({ id: 'bay-planner-003', name: 'Planner Bay 03', isActive: true, sortOrder: 3 }),
      createMockBay({ id: 'bay-planner-004', name: 'Planner Bay 04', isActive: true, sortOrder: 4 }),
      createMockBay({ id: 'bay-planner-005', name: 'Planner Bay 05', isActive: true, sortOrder: 5 }),
      createMockBay({ id: 'bay-planner-006', name: 'Planner Bay 06', isActive: true, sortOrder: 6 }),
    ],
    openings: [
      { weekday: 1, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 2, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 3, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 4, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 6, isClosed: false, openTime: '08:00', closeTime: '12:00' },
      { weekday: 7, isClosed: true, openTime: '07:30', closeTime: '17:00' },
    ],
    holidays: [],
    employeesAway: [],
    bookings: [
      {
        orderId: ORDER_ID,
        orderNumber: 'WO-2026-0301',
        status: 'SCHEDULED',
        occupancyKind: 'BOOKING',
        bayId: BAY_1_ID,
        mechanicId: null,
        mechanicName: null,
        scheduledStartAt: '2026-08-21T06:00:00.000Z',
        scheduledEndAt: '2026-08-21T07:00:00.000Z',
        vehicle: { make: 'VW', model: 'Golf', plate: 'W-301AA' },
        customerName: 'Max Mustermann',
      },
    ],
  }

  async function setupTouchPlanner(page: import('@playwright/test').Page) {
    let rescheduleCalls = 0
    let lastRescheduleBody: Record<string, unknown> | null = null
    const bookings = touchPlannerPayload.bookings.map((booking) => ({ ...booking }))

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/settings'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          timezone: touchPlannerPayload.timezone,
          slotMinutes: touchPlannerPayload.slotMinutes,
          holidayCountryIso: 'AT',
          holidaySubdivisionCode: null,
          openingHours: touchPlannerPayload.openings,
        }),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/planner'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...touchPlannerPayload, bookings }),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mechanics: [], bays: touchPlannerPayload.bays }),
      })
    })

    await page.route(new RegExp(`.*/api/workshop/orders/${ORDER_ID}(\\?.*)?$`), async (route) => {
      if (route.request().method() === 'PATCH') {
        rescheduleCalls += 1
        lastRescheduleBody = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
        const nextBayId = (lastRescheduleBody['bayId'] as string | undefined) ?? BAY_2_ID
        const nextStart =
          (lastRescheduleBody['scheduledStartAt'] as string | undefined) ?? '2026-08-21T08:00:00.000Z'
        const nextEnd =
          (lastRescheduleBody['scheduledEndAt'] as string | undefined) ?? '2026-08-21T09:00:00.000Z'
        const booking = bookings.find((entry) => entry.orderId === ORDER_ID)
        if (booking) {
          booking.bayId = nextBayId
          booking.scheduledStartAt = nextStart
          booking.scheduledEndAt = nextEnd
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: ORDER_ID,
            order_number: 'WO-2026-0301',
            status: 'SCHEDULED',
            bay_id: nextBayId,
            scheduled_start_at: nextStart,
            scheduled_end_at: nextEnd,
          }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ORDER_ID,
          order_number: 'WO-2026-0301',
          status: 'SCHEDULED',
          customer: { id: 'cust-1', first_name: 'Max', last_name: 'Mustermann' },
          vehicle: { id: 'veh-1', make: 'VW', model: 'Golf', year: 2020, plate: 'W-301AA' },
          tasks: [],
        }),
      })
    })

    await page.addInitScript(() => {
      window.localStorage.setItem('acp:sidebar-collapsed', 'true')
      window.localStorage.setItem('workshop-planner-view', 'day')
    })

    return {
      getRescheduleCalls: () => rescheduleCalls,
      getLastRescheduleBody: () => lastRescheduleBody,
    }
  }

  test('WHEN a user on a touch device long-presses a scheduled booking and moves it to another bay THEN it reschedules', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const tracker = await setupTouchPlanner(page)
    await new AutoCorePage(page, P.page.title).navigate('/workshop/planner?date=2026-08-21')

    const booking = page.getByTestId(`planner-booking-${ORDER_ID}`)
    const targetSlot = page.locator(`[data-testid^="planner-slot-${BAY_2_ID}__"]`).nth(0)
    await expect(booking).toBeVisible()
    await expect(targetSlot).toBeVisible()

    const bookingBox = (await booking.boundingBox())!
    const targetBox = (await targetSlot.boundingBox())!
    const startPoint = { x: bookingBox.x + bookingBox.width / 2, y: bookingBox.y + bookingBox.height / 2 }
    const endPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 }

    const touch = await TouchGestureClient.create(page)
    try {
      await touch.start(startPoint)
      // Wait for 250ms TouchSensor activation (DragOverlay renders a second block with opacity-60).
      await expect(page.getByTestId(`planner-booking-${ORDER_ID}`)).toHaveCount(2, { timeout: 2000 })

      const patchPromise = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/workshop/orders/${ORDER_ID}`) &&
          response.request().method() === 'PATCH',
      )
      await touch.move(startPoint, endPoint, 10)
      await touch.end()
      await patchPromise
    } finally {
      await touch.dispose()
    }

    expect(tracker.getRescheduleCalls()).toBe(1)
    expect(tracker.getLastRescheduleBody()).toMatchObject({ bayId: BAY_2_ID })

    const bay1Row = page
      .locator('div.relative')
      .filter({ has: page.locator(`[data-testid^="planner-slot-${BAY_1_ID}__"]`) })
    const bay2Row = page
      .locator('div.relative')
      .filter({ has: page.locator(`[data-testid^="planner-slot-${BAY_2_ID}__"]`) })
    await expect(bay2Row.getByTestId(`planner-booking-${ORDER_ID}`)).toBeVisible()
    await expect(bay1Row.getByTestId(`planner-booking-${ORDER_ID}`)).toHaveCount(0)
    // Wait for DragOverlay dropAnimation to finish so no ghost block remains in the screenshot.
    await expect(page.getByTestId(`planner-booking-${ORDER_ID}`)).toHaveCount(1)

    await testInfo.attach('aut-1035-planner-touch-longpress-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('WHEN a user taps a scheduled booking THEN it opens the order detail without rescheduling', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const tracker = await setupTouchPlanner(page)
    await new AutoCorePage(page, P.page.title).navigate('/workshop/planner?date=2026-08-21')

    const booking = page.getByTestId(`planner-booking-${ORDER_ID}`)
    await expect(booking).toBeVisible()

    await booking.tap()
    await expect(page).toHaveURL(new RegExp(`/workshop/orders/${ORDER_ID}$`))
    await expect(page.getByRole('heading', { name: 'WO-2026-0301' })).toBeVisible()
    await expect(page.getByText('Max Mustermann', { exact: true })).toBeVisible()
    expect(tracker.getRescheduleCalls()).toBe(0)
    await testInfo.attach('aut-1035-planner-touch-tap-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('WHEN a user swipes quickly over the planner without holding THEN it scrolls and does not reschedule', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 500 })
    const tracker = await setupTouchPlanner(page)
    await new AutoCorePage(page, P.page.title).navigate('/workshop/planner?date=2026-08-21')

    const booking = page.getByTestId(`planner-booking-${ORDER_ID}`)
    await expect(booking).toBeVisible()

    const bookingBox = (await booking.boundingBox())!
    const scrollBefore = await page.evaluate(() => window.scrollY)

    const touch = await TouchGestureClient.create(page)
    try {
      await touch.swipe(
        { x: bookingBox.x + bookingBox.width / 2, y: bookingBox.y + bookingBox.height / 2 },
        { x: bookingBox.x + bookingBox.width / 2, y: bookingBox.y - 220 },
        8,
      )
    } finally {
      await touch.dispose()
    }

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore)
    expect(tracker.getRescheduleCalls()).toBe(0)
    await testInfo.attach('aut-1035-planner-touch-swipe-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
