import { expect, test, type Locator, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockBay, createMockCustomer, createMockEmployee, createMockWorkshopOrder } from './utils/mock-factories'
import deCommon from '../../../locales/de/common.json' with { type: 'json' }
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }
import enWorkshop from '../../../locales/en/workshop.json' with { type: 'json' }

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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
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
    await expect(page.getByRole('listbox')).toHaveAccessibleName(deWorkshop.orderHeader.assignedTech)
    await expect(page.getByRole('listbox', { name: 'Suggestions' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: deWorkshop.orderHeader.unassigned })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expectSearchAnchoredTo(page, mechanicTrigger)
    await page.screenshot({ path: testInfo.outputPath('mechanic-picker.png') })
    await mechanicTrigger.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')

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
test.describe('375px DE/EN assign and unassign flows keep >=44px targets and toasts', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  for (const localeCase of [
    {
      lang: 'de',
      listLabel: deWorkshop.orderHeader.assignedTech,
      unassigned: deWorkshop.orderHeader.unassigned,
      unassignedToast: deWorkshop.orderDetail.toast.technicianUnassigned,
      assignedToast: deWorkshop.orderDetail.toast.technicianAssigned,
      assignLabel: deWorkshop.orderCard.assign,
    },
    {
      lang: 'en',
      listLabel: enWorkshop.orderHeader.assignedTech,
      unassigned: enWorkshop.orderHeader.unassigned,
      unassignedToast: enWorkshop.orderDetail.toast.technicianUnassigned,
      assignedToast: enWorkshop.orderDetail.toast.technicianAssigned,
      assignLabel: enWorkshop.orderCard.assign,
    },
  ] as const) {
    test(`detail unassign and board assign work at 375px in ${localeCase.lang}`, async ({ page }, testInfo) => {
      const mechanic = createMockEmployee({ id: 'mech-1', name: 'Alex Example' })
      const bay = createMockBay({ id: 'bay-1', name: 'Bay 01' })
      let currentOrder = { ...order, mechanicId: 'mech-1', mechanic_id: 'mech-1' }

      await page.addInitScript((lang) => {
        window.localStorage.setItem('acp:ui-language', lang)
      }, localeCase.lang)

      await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${ORDER_ID}`), async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentOrder) })
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
      await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/board/active'), async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [currentOrder] }),
        })
      })
      await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/board/assign'), async (route) => {
        const body = route.request().postDataJSON() as { mechanicId?: string | null }
        const nextMechanicId = body.mechanicId ?? null
        currentOrder = { ...currentOrder, mechanicId: nextMechanicId, mechanic_id: nextMechanicId }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: ORDER_ID,
            orderNumber: 'WO-2026-1212',
            status: 'SCHEDULED',
            mechanicId: nextMechanicId,
            bayId: 'bay-1',
            stagingLocationId: null,
            updatedAt: '2026-08-21T06:00:00.000Z',
          }),
        })
      })

      await new AutoCorePage(page, 'Order').navigate(`/workshop/orders/${ORDER_ID}`)
      const mechanicTrigger = page.getByTestId('assigned-tech-select')
      await expect(mechanicTrigger).toBeVisible()
      const triggerBox = await mechanicTrigger.boundingBox()
      expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44)

      await expect(mechanicTrigger).toHaveText('Alex Example')
      await mechanicTrigger.click()
      await expect(page.getByRole('listbox')).toHaveAccessibleName(localeCase.listLabel)
      await expect(page.getByRole('listbox', { name: 'Suggestions' })).toHaveCount(0)
      await expect(page.getByRole('option', { name: 'Alex Example' })).toHaveAttribute('aria-selected', 'true')
      const unassignedOption = page.getByRole('option', { name: localeCase.unassigned })
      await expect(unassignedOption).toHaveAttribute('aria-selected', 'false')
      await expect(unassignedOption).toBeVisible()
      const optionBox = await unassignedOption.boundingBox()
      expect(optionBox?.height ?? 0).toBeGreaterThanOrEqual(44)
      await testInfo.attach(`detail-picker-${localeCase.lang}-375.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await testInfo.attach(`detail-picker-${localeCase.lang}-375.aria.txt`, {
        body: await page.getByRole('listbox').ariaSnapshot(),
        contentType: 'text/plain',
      })
      await expectNoHorizontalOverflow(page)

      await page.setViewportSize({ width: 390, height: 844 })
      await expect(page.getByRole('listbox')).toHaveAccessibleName(localeCase.listLabel)
      await expect(page.getByRole('listbox', { name: 'Suggestions' })).toHaveCount(0)
      await expect(page.getByRole('option', { name: 'Alex Example' })).toHaveAttribute('aria-selected', 'true')
      const optionAt390 = await page.getByRole('option', { name: localeCase.unassigned }).boundingBox()
      expect(optionAt390?.height ?? 0).toBeGreaterThanOrEqual(44)
      const triggerAt390 = await mechanicTrigger.boundingBox()
      expect(triggerAt390?.height ?? 0).toBeGreaterThanOrEqual(44)
      await expectNoHorizontalOverflow(page)
      await testInfo.attach(`detail-picker-${localeCase.lang}-390.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await page.setViewportSize({ width: 375, height: 812 })

      await unassignedOption.click()
      await expect(mechanicTrigger).toHaveText(localeCase.unassigned)
      const unassignToast = page.locator('[data-sonner-toast]').filter({ hasText: localeCase.unassignedToast })
      await expect(unassignToast).toBeVisible()
      await expect(unassignToast).toHaveCSS('opacity', '1')
      await page.screenshot({ path: testInfo.outputPath(`detail-unassign-toast-${localeCase.lang}-375.png`) })

      await mechanicTrigger.click()
      await expect(unassignedOption).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('option', { name: 'Alex Example' })).toHaveAttribute('aria-selected', 'false')
      await testInfo.attach(`detail-picker-unassigned-${localeCase.lang}-375.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await page.getByRole('option', { name: 'Alex Example' }).click()
      await expect(mechanicTrigger).toHaveText('Alex Example')
      await mechanicTrigger.click()
      await expect(page.getByRole('option', { name: 'Alex Example' })).toHaveAttribute('aria-selected', 'true')
      await testInfo.attach(`detail-picker-reassigned-${localeCase.lang}-375.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      await unassignedOption.click()
      await expect(mechanicTrigger).toHaveText(localeCase.unassigned)

      await new AutoCorePage(page, 'Board').navigate('/workshop/board')
      const assignBtn = page.getByRole('button', { name: new RegExp(localeCase.assignLabel, 'i') }).first()
      await expect(assignBtn).toBeVisible()
      const assignBtnBox = await assignBtn.boundingBox()
      expect(assignBtnBox?.height ?? 0).toBeGreaterThanOrEqual(44)

      await assignBtn.click()
      const menuItem = page.getByTestId('assign-mechanic-mech-1')
      await expect(menuItem).toBeVisible()
      const menuItemBox = await menuItem.boundingBox()
      expect(menuItemBox?.height ?? 0).toBeGreaterThanOrEqual(44)
      await page.screenshot({ path: testInfo.outputPath(`board-assign-menu-${localeCase.lang}-375.png`) })

      await menuItem.click()
      const assignToast = page.locator('[data-sonner-toast]').filter({ hasText: localeCase.assignedToast })
      await expect(assignToast).toBeVisible()
      await expect(assignToast).toHaveCSS('opacity', '1')
      await page.screenshot({ path: testInfo.outputPath(`board-assign-toast-${localeCase.lang}-375.png`) })
    })
  }
})
