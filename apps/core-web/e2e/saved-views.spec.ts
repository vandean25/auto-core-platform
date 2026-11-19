import { expect, test, type Page } from '@playwright/test'
import deCommon from '../../../locales/de/common.json' with { type: 'json' }
import enCommon from '../../../locales/en/common.json' with { type: 'json' }
import deWorkshop from '../../../locales/de/workshop.json' with { type: 'json' }
import enWorkshop from '../../../locales/en/workshop.json' with { type: 'json' }
import { DE_SHELL } from './helpers/de-shell'
import { AutoCorePage } from './pom/AutoCorePage'
import { mockCursorList } from './utils/cursor-list-mock'
import { createMockCustomer, createMockListResponse, createMockWorkshopOrder } from './utils/mock-factories'
import { expectNoPageScroll } from './utils/phone-layout'

test.describe('Saved views mobile (AUT-940)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('saved views at 375px', async ({ page }) => {
    const views = [
      {
        id: 'sv-1',
        listPath: '/customers',
        name: 'Stammkunden',
        href: '/customers?search=Huber',
        visibility: 'PERSONAL',
        ownerUserId: 'test-user',
        version: 1,
        createdAt: '2026-11-01T08:00:00.000Z',
        updatedAt: '2026-11-01T08:00:00.000Z',
      },
    ]

    await page.route(AutoCorePage.apiRouteMatcher('/api/customers'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createMockListResponse([
            createMockCustomer({
              id: 'cust-1',
              first_name: 'Anna',
              last_name: 'Huber',
              email: 'anna.huber@example.at',
            }),
          ]),
        ),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/saved-views'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: views }),
        })
        return
      }
      await route.continue()
    })

    await page.route('**/api/saved-views/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { visibility?: 'PERSONAL' | 'TENANT'; version?: number }
        views[0] = {
          ...views[0],
          visibility: body.visibility ?? views[0].visibility,
          version: (body.version ?? views[0].version) + 1,
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(views[0]),
        })
        return
      }
      await route.continue()
    })

    const corePage = new AutoCorePage(page, 'Kunde')
    await corePage.navigate('/customers')

    const trigger = page.getByRole('button', { name: 'Gespeicherte Ansichten für Kunden' })
    await expect(trigger).toBeVisible()
    const triggerBox = await trigger.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(triggerBox!.width).toBeGreaterThanOrEqual(44)
    expect(triggerBox!.height).toBeGreaterThanOrEqual(44)

    await trigger.click()

    const sheet = page.getByRole('dialog', { name: 'Ansichten' })
    await expect(sheet).toBeVisible()

    const viewButton = sheet.getByRole('button', { name: 'Stammkunden', exact: true })
    const shareButton = sheet.getByRole('button', { name: 'Ansicht Stammkunden mit Team teilen' })
    await expect(viewButton).toBeVisible()
    await expect(shareButton).toBeVisible()

    for (const locator of [viewButton, shareButton]) {
      const box = await locator.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }

    await shareButton.click()

    const teamSection = sheet.getByRole('region', { name: 'Team' })
    await expect(teamSection).toBeVisible()
    await expect(teamSection.getByRole('button', { name: 'Stammkunden Team', exact: true })).toBeVisible()
  })
})

type RectBox = { left: number; right: number; top: number; bottom: number }

async function textUnderDialogCloseButton(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const close = dialog?.querySelector<HTMLElement>('button .sr-only')?.closest('button')
    if (!dialog || !close) return ['no dialog or close button']
    const button: RectBox = close.getBoundingClientRect()
    const hits: string[] = []
    const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || close.contains(node)) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) {
        const overlaps =
          rect.left < button.right && rect.right > button.left && rect.top < button.bottom && rect.bottom > button.top
        if (overlaps && rect.width > 0) {
          hits.push(`"${node.textContent.trim().slice(0, 40)}" at ${Math.round(rect.left)}-${Math.round(rect.right)}`)
        }
      }
    }
    return hits
  })
}

async function setupWorkshopOrdersForSaveView(page: Page) {
  const createdViews: Array<{ name: string; href: string }> = []
  const order = createMockWorkshopOrder({
    id: 'wo-aut950-1',
    order_number: 'WO-2026-0950',
  })

  await mockCursorList(page, { path: '/api/workshop/orders', rows: [order] })
  await page.route(AutoCorePage.apiRouteMatcher('/api/saved-views'), async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
      return
    }
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string; href: string }
      createdViews.push(body)
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'sv-new', ...body, listPath: '/workshop/orders', visibility: 'PERSONAL', version: 1 }),
      })
      return
    }
    await route.continue()
  })

  return { createdViews }
}

test.describe('Save-view dialog layout and close control (AUT-880 / AUT-950)', () => {
  test('WHEN the save-view dialog opens from /workshop/orders on desktop in DE THEN the full description is visible and does not run under the close button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await setupWorkshopOrdersForSaveView(page)
    await new AutoCorePage(page, 'Order').navigate('/workshop/orders?search=Gruber')

    const triggerName = deCommon.savedViews.saveAria.replace('{{title}}', deWorkshop.orders.list.saveViewTitle)
    await page.getByRole('button', { name: triggerName }).click()

    const dialog = page.getByRole('dialog', { name: deCommon.savedViews.title })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(deCommon.savedViews.description)).toBeVisible()

    const closeButton = dialog.getByRole('button', { name: deCommon.actions.close })
    const closeBox = await closeButton.boundingBox()
    expect(closeBox).not.toBeNull()
    expect(closeBox!.width).toBeGreaterThanOrEqual(44)
    expect(closeBox!.height).toBeGreaterThanOrEqual(44)

    expect(await textUnderDialogCloseButton(page), 'text under the close button').toEqual([])
  })

  test('WHEN the same dialog opens in EN THEN the translated description also clears the close button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await setupWorkshopOrdersForSaveView(page)
    await new AutoCorePage(page, 'Order').navigate('/workshop/orders?search=Gruber')

    await page.getByRole('button', { name: DE_SHELL.user.accountEmail }).click()
    await page.getByTestId('language-option-en').click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.keyboard.press('Escape')

    const triggerName = enCommon.savedViews.saveAria.replace('{{title}}', enWorkshop.orders.list.saveViewTitle)
    await page.getByRole('button', { name: triggerName }).click()

    const dialog = page.getByRole('dialog', { name: enCommon.savedViews.title })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(enCommon.savedViews.description)).toBeVisible()

    const closeButton = dialog.getByRole('button', { name: enCommon.actions.close })
    const closeBox = await closeButton.boundingBox()
    expect(closeBox).not.toBeNull()
    expect(closeBox!.width).toBeGreaterThanOrEqual(44)
    expect(closeBox!.height).toBeGreaterThanOrEqual(44)

    expect(await textUnderDialogCloseButton(page), 'text under the close button').toEqual([])
  })

  test('WHEN the dialog opens at 375px THEN there is no text/X overlap and no horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await setupWorkshopOrdersForSaveView(page)
    await new AutoCorePage(page, 'Order').navigate('/workshop/orders?search=Gruber')

    const triggerName = deCommon.savedViews.saveAria.replace('{{title}}', deWorkshop.orders.list.saveViewTitle)
    await page.getByRole('button', { name: triggerName }).click()

    const dialog = page.getByRole('dialog', { name: deCommon.savedViews.title })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(deCommon.savedViews.description)).toBeVisible()

    const closeButton = dialog.getByRole('button', { name: deCommon.actions.close })
    const closeBox = await closeButton.boundingBox()
    expect(closeBox).not.toBeNull()
    expect(closeBox!.width).toBeGreaterThanOrEqual(44)
    expect(closeBox!.height).toBeGreaterThanOrEqual(44)

    expect(await textUnderDialogCloseButton(page), 'text under the close button').toEqual([])
    const dialogOverflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(dialogOverflow).toBe(false)
    await expectNoPageScroll(page)
  })

  test('WHEN the X is used THEN the dialog closes and no view is saved', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    const { createdViews } = await setupWorkshopOrdersForSaveView(page)
    await new AutoCorePage(page, 'Order').navigate('/workshop/orders?search=Gruber')

    const triggerName = deCommon.savedViews.saveAria.replace('{{title}}', deWorkshop.orders.list.saveViewTitle)
    await page.getByRole('button', { name: triggerName }).click()

    const dialog = page.getByRole('dialog', { name: deCommon.savedViews.title })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: deCommon.actions.close }).click()
    await expect(dialog).toBeHidden()
    expect(createdViews).toEqual([])
  })
})
