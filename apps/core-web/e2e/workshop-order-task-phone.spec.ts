import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { createMockWorkshopOrder } from './utils/mock-factories'
import { controlsShorterThan44, expectNoPageScroll, pageOverflow } from './utils/phone-layout'
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

  test('at 375px phone width, quick-add input wraps to full-width row below title', async ({ page }, testInfo) => {
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

    // Verify touch targets at 375px: both input and button are at least 44px
    const quickAddContainer = input.locator('xpath=..')
    expect(await controlsShorterThan44(quickAddContainer), 'quick-add controls under 44px').toEqual([])
    expect(inputBox!.height).toBeGreaterThanOrEqual(43.5)
    expect(addBtnBox!.height).toBeGreaterThanOrEqual(43.5)

    // Verify no horizontal overflow at 375px
    await expectNoPageScroll(page)

    // Capture 375px screenshot of the tasks card into test output dir
    const screenshotPath = testInfo.outputPath('aut-842-task-quick-add-375.png')
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

test.describe('Workshop order undo toast above sticky chrome (AUT-919)', () => {
  const orderId = 'wo-aut-919'
  const undoAction = deWorkshop.orderDetail.undoNotes.action
  let order: ReturnType<typeof createMockWorkshopOrder> & { notes: string; updatedAt: string }

  test.beforeEach(async ({ page }) => {
    order = {
      ...createMockWorkshopOrder({
        id: orderId,
        order_number: 'WO-2026-0919',
        status: 'IN_PROGRESS',
      }),
      notes: 'Original internal note',
      updatedAt: '2026-11-05T12:00:00.000Z',
    }

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${orderId}`), async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { notes?: string }
        order = {
          ...order,
          notes: body.notes ?? order.notes,
          updatedAt: '2026-11-05T12:01:00.000Z',
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(order),
        })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${orderId}/estimates`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${orderId}/communications`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
    })

    await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${orderId}/notes/undo`), async (route) => {
      order = { ...order, notes: 'Original internal note', updatedAt: '2026-11-05T12:02:00.000Z' }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })
  })

  test('at 375×844 the undo toast action sits above the sticky checkout footer and is tappable', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 375, height: 844 })
    const corePage = new AutoCorePage(page, 'Order')
    await corePage.navigate(`/workshop/orders/${orderId}`)

    await expect(page.getByRole('heading', { name: deWorkshop.taskList.repairTasks, exact: true })).toBeVisible()

    const notesText = page.getByText('Original internal note', { exact: true })
    await notesText.scrollIntoViewIfNeeded()
    await notesText.click()
    const notesField = page.getByLabel(deWorkshop.taskList.internalNotesAria)
    await expect(notesField).toBeVisible()
    await notesField.fill('Edited internal note')
    await notesField.blur()

    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')),
        { timeout: 15_000 },
      )
      .not.toBe('')

    const undoButton = page.getByRole('button', { name: undoAction }).last()
    await expect(undoButton).toBeVisible()
    const undoBox = await undoButton.boundingBox()
    const footer = page.locator('[data-sticky-bottom-chrome]').first()
    await expect(footer).toBeVisible()
    const footerBox = await footer.boundingBox()
    const toast = page.locator('[data-sonner-toast]').last()
    const toastBox = await toast.boundingBox()
    expect(undoBox).not.toBeNull()
    expect(footerBox).not.toBeNull()
    expect(toastBox).not.toBeNull()
    expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(footerBox!.y + 2)
    expect(undoBox!.y + undoBox!.height).toBeLessThanOrEqual(footerBox!.y + 2)
    expect(undoBox!.height).toBeGreaterThanOrEqual(43.5)
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1)

    await undoButton.click()
    await expect(page.getByText(deWorkshop.orderDetail.toast.notesUndoSuccess)).toBeVisible()
  })

  test('at 1400×900 the undo toast clears the sticky Abrechnung action and both stay tappable (AUT-948)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1400, height: 900 })
    const corePage = new AutoCorePage(page, 'Order')
    await corePage.navigate(`/workshop/orders/${orderId}`)

    await expect(page.getByRole('heading', { name: deWorkshop.taskList.repairTasks, exact: true })).toBeVisible()

    const notesText = page.getByText('Original internal note', { exact: true })
    await notesText.scrollIntoViewIfNeeded()
    await notesText.click()
    const notesField = page.getByLabel(deWorkshop.taskList.internalNotesAria)
    await notesField.fill('Edited internal note')
    await notesField.blur()

    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.style.getPropertyValue('--sticky-bottom-chrome-h')),
        { timeout: 15_000 },
      )
      .not.toBe('')

    const checkoutAction = page
      .locator('[data-sticky-bottom-chrome]')
      .getByRole('button', { name: deWorkshop.checkout.primaryAction, exact: true })
    await expect(checkoutAction).toBeVisible()

    const undoButton = page.getByRole('button', { name: undoAction }).last()
    await expect(undoButton).toBeVisible()

    const footer = page.locator('[data-sticky-bottom-chrome]').first()
    const footerBox = await footer.boundingBox()
    const toastBox = await page.locator('[data-sonner-toast]').last().boundingBox()
    const undoBox = await undoButton.boundingBox()
    expect(footerBox).not.toBeNull()
    expect(toastBox).not.toBeNull()
    expect(undoBox).not.toBeNull()
    expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(footerBox!.y + 2)
    expect(undoBox!.y + undoBox!.height).toBeLessThanOrEqual(footerBox!.y + 2)

    await checkoutAction.click()
    await expect(page.getByRole('heading', { name: deWorkshop.checkout.title, exact: true })).toBeVisible()

    await undoButton.click()
    await expect(page.getByText(deWorkshop.orderDetail.toast.notesUndoSuccess)).toBeVisible()
  })
})

test('WHEN a work-order detail opens at 375px and 390px THEN page width equals the viewport, no horizontal scrollbar', async ({ page }, testInfo) => {
  const order = createMockWorkshopOrder({
    id: 'wo-aut-953',
    order_number: 'WO202608421STANDORTWIEN',
    status: 'IN_PROGRESS',
    customer: {
      id: 'cust-953',
      type: 'COMPANY',
      first_name: null,
      last_name: null,
      company_name: 'Nordwerkstatt Ersatzteile und Fahrzeugtechnik Gesellschaft',
      email: 'buero@example.invalid',
      phone: '+43 1 234567',
    },
  })

  await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
  })
  await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}/estimates`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })

  for (const width of [375, 390] as const) {
    await page.setViewportSize({ width, height: 812 })
    await new AutoCorePage(page, order.order_number).navigate(`/workshop/orders/${order.id}`)
    await expect(page.getByRole('heading', { name: order.order_number })).toBeVisible()
    await expectNoPageScroll(page)
    await testInfo.attach(`aut-953-work-order-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
  }
})

test('WHEN a work order with a Kostenvoranschlag opens at 320, 375 and 390 THEN the page is no wider than the screen', async ({ page }, testInfo) => {
  const order = createMockWorkshopOrder({
    id: 'wo-aut-953-estimate',
    order_number: 'WO-2026-0953',
    status: 'IN_PROGRESS',
  })
  const sentAt = '2026-10-10T08:05:00.000Z'
  const estimate = {
    id: 'est-953',
    workshop_order_id: order.id,
    estimate_number: 'KV-2026-0953',
    year: 2026,
    created_at: '2026-10-10T08:00:00.000Z',
    send_enabled: true,
    customer_send_blockers: [],
    overrun_threshold_pct: '15.00',
    overrun_warning: {
      detected_at: '2026-10-12T08:00:00.000Z',
      notified_at: null,
      notified_channel: null,
      notified_amount_gross: null,
      customer_reaction: null,
      note: null,
      requires_customer_notice: true,
      total_over_threshold: true,
      new_work_lines: false,
      approved_total_gross: '216.00',
      current_total_gross: '270.00',
      threshold_pct: '15.00',
      new_line_count: 0,
    },
    versions: [
      {
        id: 'est-953-v1',
        approval: null,
        version: 1,
        status: 'SENT',
        sent_at: sentAt,
        valid_from: sentAt,
        valid_until: '2026-10-24T08:05:00.000Z',
        total_net: '180.00',
        total_tax: '36.00',
        total_gross: '216.00',
        snapshot_sha256: 'a'.repeat(64),
        legal_text_version: 'kv-legal-de-v1',
        retain_until: null,
        legal_hold: false,
        pdf_generated_at: sentAt,
        pdf_generation_error: null,
      },
    ],
  }

  await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) })
  })
  await page.route(AutoCorePage.apiRouteMatcher(`/api/workshop/orders/${order.id}/estimates`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [estimate] }),
    })
  })
  await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })

  const card = page.locator('.rounded-xl.border').filter({
    has: page.getByRole('heading', { name: deWorkshop.estimateCard.title, exact: true }),
  })

  for (const width of [320, 375, 390] as const) {
    await page.setViewportSize({ width, height: 812 })
    await new AutoCorePage(page, order.order_number).navigate(`/workshop/orders/${order.id}`)
    await expect(page.getByRole('heading', { name: deWorkshop.estimateCard.title, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: deWorkshop.estimateCard.recordDecision })).toBeVisible()
    await expect(page.getByRole('button', { name: deWorkshop.estimateCard.pdfDownload })).toBeVisible()
    const scrollWidth = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0)
    expect(scrollWidth, `page is ${scrollWidth}px at ${width}px`).toBeLessThanOrEqual(width + 1)
    expect(await controlsShorterThan44(card), 'estimate card controls under 44px').toEqual([])
    await testInfo.attach(`aut-953-estimate-card-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
  }
})
