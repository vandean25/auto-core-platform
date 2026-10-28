import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { PHONE_WIDTHS, expectNoPageScroll } from './utils/phone-layout'

/** AUT-808: the close button of a side sheet has its own corner; no line of the title or subtitle runs under it. */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

type Box = { left: number; right: number; top: number; bottom: number }

/** Text lines of the open sheet that intersect the close button, as readable strings. */
async function textUnderCloseButton(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]')
    const close = sheet?.querySelector<HTMLElement>('button .sr-only')?.closest('button')
    if (!sheet || !close) return ['no sheet or close button']
    const button: Box = close.getBoundingClientRect()
    const hits: string[] = []
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || close.contains(node)) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) {
        const overlaps = rect.left < button.right && rect.right > button.left && rect.top < button.bottom && rect.bottom > button.top
        if (overlaps && rect.width > 0) hits.push(`"${node.textContent.trim().slice(0, 40)}" at ${Math.round(rect.left)}-${Math.round(rect.right)}`)
      }
    }
    return hits
  })
}

async function mockPlanner(page: Page) {
  const empty = { timezone: 'Europe/Vienna', slotMinutes: 60, range: { from: '2026-08-21T05:30:00.000Z', to: '2026-08-22T05:30:00.000Z' }, bays: [], openings: [], holidays: [], employeesAway: [], bookings: [] }
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/settings'), (route) =>
    route.fulfill(json({ timezone: 'Europe/Vienna', slotMinutes: 60, holidayCountryIso: 'AT', holidaySubdivisionCode: null, openingHours: [] })),
  )
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/planner'), (route) => route.fulfill(json(empty)))
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), (route) => route.fulfill(json({ mechanics: [], bays: [] })))
}

test.describe('Sheet close button on a phone (AUT-808)', () => {
  for (const width of PHONE_WIDTHS) {
    test(`Werkstattauftrag planen at ${width}px: the title and subtitle stay clear of the close button`, async ({ page }) => {
      await page.setViewportSize({ width, height: 667 })
      await mockPlanner(page)
      await new AutoCorePage(page, '').navigate('/workshop/planner?date=2026-08-21')

      await page.getByRole('button', { name: '+ Werkstattauftrag' }).click()
      await expect(page.getByRole('heading', { name: 'Werkstattauftrag planen' })).toBeVisible()
      await expect(page.getByText('Hebebühne-Slot buchen', { exact: false })).toBeVisible()

      expect(await textUnderCloseButton(page), 'text under the close button').toEqual([])
      await expectNoPageScroll(page)
    })

    test(`Mitgliedsdetails at ${width}px: the long subtitle stays clear of the close button`, async ({ page }) => {
      await page.setViewportSize({ width, height: 667 })
      const member = {
        id: 'm1', tenantId: 'tenant-1', userId: 'user-m1', email: 'anna.muster@werkstatt.example', firstName: 'Anna', lastName: 'Muster',
        role: 'ADMIN', isActive: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }
      await page.route(AutoCorePage.apiRouteMatcher('/api/tenant-members'), (route) =>
        route.fulfill(json({ data: [member], meta: { total: 1, page: 1, limit: 100, pageCount: 1 } })),
      )
      await new AutoCorePage(page, '').navigate('/settings?tab=team')
      await page.locator('[data-table-row="true"]').first().click()
      await expect(page.getByRole('heading', { name: 'Mitgliedsdetails' })).toBeVisible()

      expect(await textUnderCloseButton(page), 'text under the close button').toEqual([])
    })
  }
})
