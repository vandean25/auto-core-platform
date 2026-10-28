import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { PHONE_WIDTHS, expectNoPageScroll } from './utils/phone-layout'

/** AUT-808: the close button of a sheet has its own corner; no line of the title or subtitle (and, on a desktop, no header button) runs under it. */
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

test.describe('Sheet close button (AUT-808)', () => {
  test('Werkstattauftrag planen on a desktop: the header button ends before the close button', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await mockPlanner(page)
    await new AutoCorePage(page, '').navigate('/workshop/planner?date=2026-08-21')

    await page.getByRole('button', { name: '+ Werkstattauftrag' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Werkstattauftrag planen' })).toBeVisible()
    const create = (await sheet.getByRole('button', { name: '+ Werkstattauftrag' }).boundingBox())!
    const close = (await sheet.getByRole('button', { name: 'Schließen' }).boundingBox())!

    expect(create.x + create.width, 'right edge of the create button').toBeLessThanOrEqual(close.x)
  })

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
  }
})
