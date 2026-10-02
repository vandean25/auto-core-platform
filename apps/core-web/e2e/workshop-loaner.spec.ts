import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'

test.describe('Blueprint: Workshop Loaner Vehicles', () => {
  const mockFleet = [
    {
      id: 'loaner-1',
      siteId: 'site-1',
      vehicleId: 'veh-loaner-1',
      displayName: 'Golf Ersatz',
      status: 'AVAILABLE',
      dailyRateCents: null,
      insuranceNote: null,
      active: true,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      vehicle: {
        id: 'veh-loaner-1',
        make: 'VW',
        model: 'Golf',
        year: 2021,
        plate: 'W-LOAN 1',
        vin: null,
      },
    },
  ]

  const mockBookings = {
    data: [
      {
        id: 'booking-1',
        loanerVehicleId: 'loaner-1',
        workshopOrderId: null,
        customerId: 'cust-pilot',
        plannedFrom: '2026-10-10T08:00:00.000Z',
        plannedTo: '2026-10-12T18:00:00.000Z',
        status: 'RESERVED',
        handedOverAt: null,
        returnedAt: null,
        odometerOut: null,
        odometerIn: null,
        fuelOut: null,
        fuelIn: null,
        driverLicenceChecked: false,
        licenceCheckedById: null,
        notes: null,
        createdAt: '2026-10-09T10:00:00.000Z',
        updatedAt: '2026-10-09T10:00:00.000Z',
        customer: {
          id: 'cust-pilot',
          firstName: 'Pilot',
          lastName: 'Customer',
          companyName: null,
        },
      },
    ],
  }

  async function setupLoanerRoutes(page: import('@playwright/test').Page) {
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/loaner-vehicles'), async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: mockFleet }),
      })
    })

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/loaner-bookings/overdue'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      },
    )

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/loaner-bookings'), async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockBookings),
      })
    })
  }

  test('Loaner page renders fleet table and create action', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Ersatzfahrzeug')

    await setupLoanerRoutes(page)
    await corePage.navigate('/workshop/loaner-vehicles')

    await expect(page.getByRole('heading', { name: 'Ersatzfahrzeuge', exact: true })).toBeVisible()
    await expect(corePage.createButton).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByText('Golf Ersatz')).toBeVisible()
  })

  test('preselects fleet vehicle from query parameter', async ({ page }) => {
    await setupLoanerRoutes(page)
    await page.goto('/workshop/loaner-vehicles?vehicle=loaner-1')

    await expect(page.getByText('Buchungen · Golf Ersatz')).toBeVisible()
    await expect(page.getByText('Pilot Customer')).toBeVisible()
  })

  test('hand-over sends licence-checked payload', async ({ page }) => {
    let handOverBody: Record<string, unknown> | undefined
    await setupLoanerRoutes(page)
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/loaner-bookings/booking-1/hand-over'),
      async (route) => {
        handOverBody = route.request().postDataJSON() as Record<string, unknown>
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            ...mockBookings.data[0],
            status: 'HANDED_OVER',
            driverLicenceChecked: true,
          }),
        })
      },
    )

    await page.goto('/workshop/loaner-vehicles?vehicle=loaner-1')
    await page.getByRole('button', { name: 'Übergabe' }).click()
    await page.getByLabel('Kilometerstand').fill('15000')
    await page.getByLabel('Tankfüllung (%)').fill('80')
    await page.getByRole('button', { name: 'Übergabe speichern' }).click()
    expect(handOverBody).toBeUndefined()
    await page.getByLabel('Führerschein geprüft').check()
    await page.getByRole('button', { name: 'Übergabe speichern' }).click()

    await expect.poll(() => handOverBody?.driverLicenceChecked).toBe(true)
    expect(handOverBody).toMatchObject({
      odometerOut: 15000,
      fuelOut: 80,
      driverLicenceChecked: true,
    })
  })

  test('return sends odometer payload', async ({ page }) => {
    let returnBody: Record<string, unknown> | undefined
    const handedOver = {
      ...mockBookings.data[0],
      status: 'HANDED_OVER',
      odometerOut: 15000,
      fuelOut: 80,
      driverLicenceChecked: true,
      handedOverAt: '2026-10-10T09:00:00.000Z',
    }
    await setupLoanerRoutes(page)
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/loaner-bookings'), async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [handedOver] }),
      })
    })
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/loaner-bookings/booking-1/return'),
      async (route) => {
        returnBody = route.request().postDataJSON() as Record<string, unknown>
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ...handedOver, status: 'RETURNED' }),
        })
      },
    )

    await page.goto('/workshop/loaner-vehicles?vehicle=loaner-1')
    await page.getByRole('button', { name: 'Rückgabe' }).click()
    await page.getByLabel('Kilometerstand').fill('15100')
    await page.getByLabel('Tankfüllung (%)').fill('70')
    await page.getByRole('button', { name: 'Rückgabe speichern' }).click()

    await expect.poll(() => returnBody?.odometerIn).toBe(15100)
    expect(returnBody).toMatchObject({ odometerIn: 15100, fuelIn: 70 })
  })
})
