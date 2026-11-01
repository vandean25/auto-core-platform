import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockWorkshopOrder } from './utils/mock-factories'
import { expectNoPageScroll } from './utils/phone-layout'
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }

test.describe('Workshop order task quick-add layout (AUT-842)', () => {
  const order = createMockWorkshopOrder({
    id: 'wo-aut-842',
    order_number: 'WO-2026-0842',
  })

  test.beforeEach(async ({ page }) => {
    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(order),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}/estimates`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })
  })

  test('at 375px phone width, quick-add input wraps to full-width row below title', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const corePage = new AutoCorePage(page, 'Order')
    await corePage.navigate(`/workshop/orders/${order.id}`)

    const title = page.getByRole('heading', { name: deWorkshop.taskList.repairTasks, exact: true })
    await expect(title).toBeVisible()

    const input = page.getByPlaceholder(deWorkshop.taskList.newTaskPlaceholder)
    await expect(input).toBeVisible()

    const addButton = page.getByRole('button', { name: deWorkshop.taskList.addTask, exact: true })
    await expect(addButton).toBeVisible()

    const titleBox = await title.boundingBox()
    const inputBox = await input.boundingBox()
    const addBtnBox = await addButton.boundingBox()

    expect(titleBox).not.toBeNull()
    expect(inputBox).not.toBeNull()
    expect(addBtnBox).not.toBeNull()

    // The input must wrap to its own row below the title (not squeezed next to it on the same line)
    expect(inputBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height - 2)

    // The input must be wide enough to comfortably type and read (previously squeezed to ~29px)
    expect(inputBox!.width).toBeGreaterThanOrEqual(180)

    // Button stays on the same line as the input
    expect(Math.abs(inputBox!.y - addBtnBox!.y)).toBeLessThan(10)

    // Verify no horizontal overflow at 375px
    await expectNoPageScroll(page)

    // Capture 375px screenshot of the tasks card
    const screenshotPath = process.cwd().endsWith('core-web')
      ? '../../docs/internal/assets/aut-842-task-quick-add-375.png'
      : 'docs/internal/assets/aut-842-task-quick-add-375.png'
    const taskCard = page.locator('div.rounded-xl.border').filter({ has: title }).first()
    if (await taskCard.isVisible()) {
      await taskCard.screenshot({ path: screenshotPath })
    } else {
      await page.screenshot({ path: screenshotPath })
    }
  })

  test('at 1400px desktop width, layout remains unchanged on a single row', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    const corePage = new AutoCorePage(page, 'Order')
    await corePage.navigate(`/workshop/orders/${order.id}`)

    const title = page.getByRole('heading', { name: deWorkshop.taskList.repairTasks, exact: true })
    await expect(title).toBeVisible()

    const input = page.getByPlaceholder(deWorkshop.taskList.newTaskPlaceholder)
    await expect(input).toBeVisible()

    const titleBox = await title.boundingBox()
    const inputBox = await input.boundingBox()

    expect(titleBox).not.toBeNull()
    expect(inputBox).not.toBeNull()

    // On desktop, title and quick-add sit on the same horizontal row
    expect(Math.abs(titleBox!.y - inputBox!.y)).toBeLessThan(15)

    // Input has full desktop width
    expect(inputBox!.width).toBeGreaterThan(250)
  })
})
