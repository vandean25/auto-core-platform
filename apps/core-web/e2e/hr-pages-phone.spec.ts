import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { controlsShorterThan44, expectNoPageScroll, PHONE_WIDTHS } from './utils/phone-layout'

/**
 * AUT-769: Personal > Zeiterfassung and Urlaub fit a phone (no horizontal page scroll, clock-in reachable by tap),
 * and the remaining leave is shown compactly in German.
 */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111'
const clock = { timezone: 'Europe/Vienna', state: 'CLOCKED_OUT', lastEvent: null, todayEvents: [] }
const workday = (weekday: number, isWorking: boolean) => ({
  weekday,
  isWorking,
  startTime: isWorking ? '08:00' : null,
  endTime: isWorking ? '17:35' : null,
  breakMinutes: isWorking ? 60 : 0,
})
const schedule = {
  current: {
    id: 'sched-1',
    effectiveFrom: '2026-01-01',
    siteId: null,
    days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => workday(weekday, weekday <= 5)),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  history: [],
}

async function mockHr(page: Page, options: { scheduleDelayMs?: number } = {}) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/hr/me'), (route) =>
    route.fulfill(
      json({
        employee: { id: EMPLOYEE_ID, name: 'Max Mechaniker', role: 'MECHANIC', hiredOn: '2020-01-01', annualLeaveMinutes: 12875 },
        clockState: 'CLOCKED_OUT',
        remainingLeaveMinutes: 12875,
        timezone: 'Europe/Vienna',
      }),
    ),
  )
  await page.route(AutoCorePage.apiRouteMatcher('/api/hr/me/clock'), (route) => route.fulfill(json(clock)))
  await page.route(new RegExp(`/api/hr/attendance/${EMPLOYEE_ID}/clock`), (route) => route.fulfill(json(clock)))
  await page.route(AutoCorePage.apiRouteMatcher('/api/hr/attendance'), (route) => route.fulfill(json([])))
  await page.route(AutoCorePage.apiRouteMatcher('/api/hr/me/leave'), (route) =>
    route.fulfill(json({ year: 2026, allowanceMinutes: 12875, carryoverMinutes: 0, remainingMinutes: 12875, bookings: [] })),
  )
  await page.route(AutoCorePage.apiRouteMatcher('/api/hr/leave'), (route) => route.fulfill(json([])))
  await page.route(AutoCorePage.apiRouteMatcher('/api/employees'), (route) =>
    route.fulfill(json({ data: [{ id: EMPLOYEE_ID, name: 'Max Mechaniker', role: 'MECHANIC', isActive: true }], meta: { total: 1, page: 1, limit: 100, pageCount: 1 } })),
  )
  await page.route(new RegExp(`/api/hr/employees/${EMPLOYEE_ID}/work-schedule`), async (route) => {
    if (options.scheduleDelayMs) await new Promise((resolve) => setTimeout(resolve, options.scheduleDelayMs))
    await route.fulfill(json(schedule))
  })
}

test.describe('Personal pages on a phone (AUT-769)', () => {
  for (const width of PHONE_WIDTHS) {
    test(`Zeiterfassung: employee select and clock-in are reachable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await mockHr(page)
      await new AutoCorePage(page, '').navigate('/hr/clock')

      const clockIn = page.getByRole('button', { name: 'Kommen' })
      await expect(clockIn).toBeVisible()
      const select = page.getByLabel('Mitarbeiter', { exact: true })
      await expect(select).toBeVisible()
      for (const control of [select, clockIn]) {
        const box = (await control.boundingBox())!
        expect(box.x, 'left edge').toBeGreaterThanOrEqual(0)
        expect(box.x + box.width, 'right edge').toBeLessThanOrEqual(width)
        expect(box.height, 'height').toBeGreaterThanOrEqual(44)
      }
      await expectNoPageScroll(page)
    })

    test(`Urlaub: no sideways scroll, month navigation and compact remaining leave at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await mockHr(page)
      await new AutoCorePage(page, '').navigate('/hr/leave')

      const next = page.getByRole('region', { name: 'Teamurlaub' }).getByRole('button', { name: 'Weiter' })
      await expect(next).toBeVisible()
      await expectNoPageScroll(page)
      const nextBox = (await next.boundingBox())!
      expect(nextBox.x + nextBox.width, 'Weiter right edge').toBeLessThanOrEqual(width)
      expect(nextBox.height, 'Weiter height').toBeGreaterThanOrEqual(44)

      // Days, in German, on one or two short lines: no minutes, no English.
      const badge = page.getByText(/^Rest:/)
      await expect(badge).toBeVisible()
      await expect(badge).toContainText('Tage')
      await expect(badge).not.toContainText(/days|Min\./)
      expect((await badge.boundingBox())!.height, 'remaining leave badge height').toBeLessThanOrEqual(48)
      const header = page.getByRole('heading', { name: 'Urlaub', level: 2 })
      expect(await controlsShorterThan44(header.locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')), 'header controls under 44px').toEqual([])
    })
  }

  test('Urlaub: the remaining days are the same while the work schedule is still loading', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await mockHr(page, { scheduleDelayMs: 1500 })
    await new AutoCorePage(page, '').navigate('/hr/leave')

    const badge = page.getByText(/^Rest:/)
    await expect(badge).toBeVisible()
    // Before the schedule is known the badge must not show a different number than afterwards (26,8 instead of 25).
    const early = await badge.innerText()
    await expect(badge).toContainText('25 Tage', { timeout: 10_000 })
    expect(early).not.toMatch(/26[.,]8/)
  })
})
