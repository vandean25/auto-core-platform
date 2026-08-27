import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockBay } from './utils/mock-factories'

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
    const corePage = new AutoCorePage(page, 'Workshop Planner')
    await setupPlannerRoutes(page)
    await corePage.navigate('/workshop/planner?date=2026-08-21')

    await expect(page.getByRole('heading', { name: 'Workshop Planner', exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Day/i })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Week/i })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Workshop Order' })).toBeVisible()
  })

  test('Creates booking from empty day slot', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Workshop Planner')
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
    await page.getByRole('button', { name: 'Book 09:30' }).click()
    await page.getByPlaceholder('VIN, plate, or customer name').fill('W-12345')
    await page.getByText('2020 VW Golf').click()
    await page.getByRole('button', { name: '+ Workshop Order' }).click()

    await expect(page.getByText('Workshop order scheduled.')).toBeVisible()
    await expect(page.getByText('WO-2026-0200')).toBeVisible()
  })

  test('Shows no bays empty state', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Workshop Planner')
    await setupPlannerRoutes(page, { ...mockPlanner, bays: [] })
    await corePage.navigate('/workshop/planner')

    await expect(page.getByText('No bays configured')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Go to Settings' })).toBeVisible()
  })

  test('Create booking shows collision toast on 409', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Workshop Planner')
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
    await page.getByRole('button', { name: '+ Workshop Order' }).click()
    await page.getByPlaceholder('VIN, plate, or customer name').fill('W-12345')
    await page.getByText('2020 VW Golf').click()
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Planner Bay 01' }).click()
    await page.locator('#planner-start').fill('2026-08-21T09:00')
    await page.locator('#planner-end').fill('2026-08-21T10:00')
    await page.getByRole('button', { name: '+ Workshop Order' }).click()

    await expect(page.getByText('Bay is already occupied by WO-2026-0099')).toBeVisible()
  })

  test('Closed weekday empty state copy', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Workshop Planner')
    const closedPlanner = {
      ...mockPlanner,
      openings: mockPlanner.openings.map((row) => ({ ...row, isClosed: true })),
    }

    await setupPlannerRoutes(page, closedPlanner)
    await page.addInitScript(() => {
      window.localStorage.setItem('workshop-planner-view', 'day')
    })

    await corePage.navigate('/workshop/planner?date=2026-08-21')
    await expect(page.getByText('Workshop closed')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Go to Settings' })).toBeVisible()
  })

  test('Closed holiday empty state copy', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Workshop Planner')
    await setupPlannerRoutes(page)
    await page.addInitScript(() => {
      window.localStorage.setItem('workshop-planner-view', 'day')
    })

    await corePage.navigate('/workshop/planner?date=2026-12-24')
    await expect(page.getByText('Closed — Nationalfeiertag')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Go to Settings' })).toBeVisible()
  })

  test('Short holiday uses shortened slot labels', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Workshop Planner')
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

    await expect(page.getByRole('button', { name: 'Book 10:00' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Book 11:00' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Book 07:30' })).toHaveCount(0)
  })
})
