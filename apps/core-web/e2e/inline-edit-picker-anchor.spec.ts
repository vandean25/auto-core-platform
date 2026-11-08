import { expect, test, type Locator, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockBay, createMockCustomer, createMockEmployee, createMockWorkshopOrder } from './utils/mock-factories'
import deCommon from '../../../locales/de/common.json' with { type: 'json' }

const ORDER_ID = 'wo-picker-anchor'
const SEARCH = deCommon.inlineEdit.search

const order = {
  ...createMockWorkshopOrder({
    id: ORDER_ID,
    order_number: 'WO-2026-1212',
    status: 'SCHEDULED',
    customer: createMockCustomer({ first_name: 'Alex', last_name: 'Example' }),
  }),
  bayId: 'bay-1',
  bay_id: 'bay-1',
  scheduledStartAt: '2026-08-21T06:00:00.000Z',
  scheduledEndAt: '2026-08-21T07:00:00.000Z',
  scheduled_start_at: '2026-08-21T06:00:00.000Z',
  scheduled_end_at: '2026-08-21T07:00:00.000Z',
}

async function expectSearchAnchoredTo(page: Page, trigger: Locator) {
  const dialog = page.getByRole('dialog')
  const search = dialog.getByPlaceholder(SEARCH)
  await expect(search).toBeVisible()
  const searchBox = await search.boundingBox()
  const dialogBox = await dialog.boundingBox()
  const triggerBox = await trigger.boundingBox()
  const viewport = page.viewportSize()
  expect(searchBox).not.toBeNull()
  expect(dialogBox).not.toBeNull()
  expect(triggerBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(searchBox!.y).toBeGreaterThanOrEqual(0)
  expect(searchBox!.y + searchBox!.height).toBeLessThanOrEqual(viewport!.height)
  expect(searchBox!.x).toBeGreaterThanOrEqual(0)
  expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(viewport!.width)
  const below = dialogBox!.y - (triggerBox!.y + triggerBox!.height)
  const above = triggerBox!.y - (dialogBox!.y + dialogBox!.height)
  const gap = below >= -8 ? below : above
  expect(gap).toBeGreaterThanOrEqual(-8)
  expect(gap).toBeLessThan(24)
  const overlapsTrigger =
    dialogBox!.x < triggerBox!.x + triggerBox!.width + 16 &&
    dialogBox!.x + dialogBox!.width > triggerBox!.x - 16
  expect(overlapsTrigger).toBe(true)
}

test.describe('desktop inline pickers stay anchored', () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  test('mechanic, date and task status search sit in the viewport under the trigger', async ({ page }, testInfo) => {
    const mechanic = createMockEmployee({ id: 'mech-1', name: 'Alex Example' })
    const bay = createMockBay({ id: 'bay-1', name: 'Bay 01' })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })
    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}/estimates`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mechanics: [mechanic], bays: [bay] }),
      })
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })

    await page.setViewportSize({ width: 1024, height: 768 })
    await new AutoCorePage(page, 'Order').navigate(`/workshop/orders/${ORDER_ID}`)

    const mechanicTrigger = page.getByTestId('assigned-tech-select')
    const dateTrigger = page.getByTestId('order-date-picker')
    const statusTrigger = page.getByTestId('task-status-picker-TASK-1')
    await expect(mechanicTrigger).toBeVisible()
    await expect(dateTrigger).toBeVisible()
    await expect(statusTrigger).toBeVisible()

    await mechanicTrigger.click()
    await expectSearchAnchoredTo(page, mechanicTrigger)
    await page.screenshot({ path: testInfo.outputPath('mechanic-picker.png') })
    await mechanicTrigger.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await dateTrigger.click()
    await expectSearchAnchoredTo(page, dateTrigger)
    await page.screenshot({ path: testInfo.outputPath('date-picker.png') })
    await dateTrigger.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await statusTrigger.click()
    await expectSearchAnchoredTo(page, statusTrigger)
    await page.screenshot({ path: testInfo.outputPath('status-picker.png') })
  })
})
