import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'

type DemoOrder = {
  id: string
  number: string
  status: 'SCHEDULED' | 'INTAKE' | 'IN_PROGRESS'
  plate: string
  hours: number
  start: string
}

const WEEK_DAYS = [
  { date: '2026-10-12', capacityHours: 9.5, openTime: '07:30', closeTime: '17:00' },
  { date: '2026-10-13', capacityHours: 9.5, openTime: '07:30', closeTime: '17:00' },
  { date: '2026-10-14', capacityHours: 9.5, openTime: '07:30', closeTime: '17:00' },
  { date: '2026-10-15', capacityHours: 9.5, openTime: '07:30', closeTime: '17:00' },
  { date: '2026-10-16', capacityHours: 9.5, openTime: '07:30', closeTime: '17:00' },
  { date: '2026-10-17', capacityHours: 4, openTime: '08:00', closeTime: '12:00' },
]

const DEMO_ORDERS: Record<string, Record<string, DemoOrder[]>> = {
  'Bay 1': {
    '2026-10-12': [
      { id: 'demo-101', number: 'WO-DEMO-101', status: 'SCHEDULED', plate: 'W 123 AB', hours: 2.5, start: '2026-10-12T06:00:00.000Z' },
      { id: 'demo-102', number: 'WO-DEMO-102', status: 'INTAKE', plate: 'W 456 CD', hours: 4, start: '2026-10-12T09:00:00.000Z' },
    ],
    '2026-10-13': [
      { id: 'demo-103', number: 'WO-DEMO-103', status: 'IN_PROGRESS', plate: 'G 789 EF', hours: 6, start: '2026-10-13T06:00:00.000Z' },
    ],
  },
  'Bay 2': {
    '2026-10-13': [
      { id: 'demo-201', number: 'WO-DEMO-201', status: 'IN_PROGRESS', plate: 'K 111 GH', hours: 7, start: '2026-10-13T05:30:00.000Z' },
      { id: 'demo-202', number: 'WO-DEMO-202', status: 'SCHEDULED', plate: 'K 222 JK', hours: 3.5, start: '2026-10-13T07:00:00.000Z' },
    ],
    '2026-10-14': [
      { id: 'demo-203', number: 'WO-DEMO-203', status: 'SCHEDULED', plate: 'L 333 LM', hours: 2, start: '2026-10-14T05:30:00.000Z' },
    ],
    '2026-10-17': [
      { id: 'demo-204', number: 'WO-DEMO-204', status: 'SCHEDULED', plate: 'M 444 NO', hours: 1.5, start: '2026-10-17T06:00:00.000Z' },
    ],
  },
  'Bay 3': {
    '2026-10-15': [
      { id: 'demo-301', number: 'WO-DEMO-301', status: 'INTAKE', plate: 'N 555 PQ', hours: 9.5, start: '2026-10-15T05:30:00.000Z' },
    ],
  },
}

function buildCell(bayName: string, day: (typeof WEEK_DAYS)[number]) {
  const orders = DEMO_ORDERS[bayName]?.[day.date] ?? []
  const booked = orders.reduce((sum, order) => sum + order.hours, 0)
  return {
    date: day.date,
    capacityHours: day.capacityHours,
    bookedHours: booked,
    freeHours: Math.max(0, day.capacityHours - booked),
    isOverbooked: booked > day.capacityHours,
    orders: orders.map((order) => ({
      orderId: order.id,
      orderNumber: order.number,
      status: order.status,
      occupancyKind: 'BOOKING',
      plate: order.plate,
      plannedLaborHours: order.hours,
      scheduledStartAt: order.start,
    })),
  }
}

function buildWeek(weekStart: string) {
  const days = WEEK_DAYS.map((day, index) => ({
    ...day,
    date: addDays(weekStart, index),
    isClosed: false,
    holidayName: null,
  }))
  return {
    timezone: 'Europe/Vienna',
    today: '2026-10-14',
    weekStart,
    days: days.map(({ date, isClosed, openTime, closeTime, capacityHours, holidayName }) => ({
      date,
      isClosed,
      openTime,
      closeTime,
      capacityHours,
      holidayName,
    })),
    bays: ['Bay 1', 'Bay 2', 'Bay 3'].map((name, index) => ({
      id: `bay-demo-${index + 1}`,
      name,
      sortOrder: index + 1,
      days: WEEK_DAYS.map((day, dayIndex) => buildCell(name, { ...day, date: days[dayIndex].date })),
    })),
  }
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

async function setupCapacityRoutes(page: Page, requestedUrls: string[]) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/capacity'), async (route) => {
    const url = new URL(route.request().url())
    requestedUrls.push(url.search)
    const weekStart = url.searchParams.get('weekStart') ?? '2026-10-12'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildWeek(weekStart)),
    })
  })
}

test.describe('Workshop capacity week board', () => {
  test('shows bays as rows with free hours and highlights overbooked cells', async ({ page }, testInfo) => {
    const requested: string[] = []
    await setupCapacityRoutes(page, requested)
    const corePage = new AutoCorePage(page, 'Workshop Capacity')
    await corePage.navigate('/workshop/capacity')

    await expect(page.getByRole('heading', { name: 'Workshop Capacity', exact: true })).toBeVisible()
    await expect(page.getByRole('rowheader')).toHaveText(['Bay 1', 'Bay 2', 'Bay 3'])
    await expect(page.getByText('3 h free', { exact: true })).toBeVisible()
    await expect(page.getByText('Fully booked', { exact: true })).toBeVisible()
    await expect(page.getByText('Overbooked by 1 h', { exact: true })).toBeVisible()
    await expect(page.locator('[data-overbooked="true"]')).toHaveCount(1)

    const chip = page.getByRole('link', { name: /WO-DEMO-101/ })
    await expect(chip).toHaveAttribute('href', '/workshop/orders/demo-101')

    await testInfo.attach('workshop-capacity-week', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })

  test('moves to the next week and sends weekStart to the API', async ({ page }) => {
    const requested: string[] = []
    await setupCapacityRoutes(page, requested)
    const corePage = new AutoCorePage(page, 'Workshop Capacity')
    await corePage.navigate('/workshop/capacity')

    await page.getByRole('button', { name: 'Next week' }).click()

    await expect.poll(() => requested.some((search) => search.includes('weekStart=2026-10-19'))).toBe(true)
  })
})
