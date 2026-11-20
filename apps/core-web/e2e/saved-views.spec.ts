import { expect, test, type Locator, type Page } from '@playwright/test'
import type { SavedViewDto } from '../src/api/saved-views'
import deNav from '../../../locales/de/nav.json' with { type: 'json' }
import enNav from '../../../locales/en/nav.json' with { type: 'json' }
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

const LONG_VIEW_NAME = 'Offene Werkstattaufträge für das gesamte Serviceteam im Hauptbetrieb'

function savedView(overrides: Partial<SavedViewDto> = {}): SavedViewDto {
  return {
    id: 'saved-view-1',
    listPath: '/workshop/orders',
    name: 'Serviceaufträge',
    href: '/workshop/orders?search=Service',
    visibility: 'PERSONAL',
    ownerUserId: 'test-user',
    version: 1,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  }
}

async function mockSavedViews(page: Page, initial: SavedViewDto[]) {
  let views = initial
  await page.route(AutoCorePage.apiRouteMatcher('/api/saved-views'), (route) =>
    route.fulfill({ json: { data: views } }),
  )
  await page.route('**/api/saved-views/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    const id = new URL(route.request().url()).pathname.split('/').at(-1)
    const body = route.request().postDataJSON() as { name?: string; visibility?: 'PERSONAL' | 'TENANT'; version: number }
    views = views.map((view) => view.id === id ? { ...view, ...body, version: body.version + 1 } : view)
    await route.fulfill({ json: views.find((view) => view.id === id) })
  })
}

async function expectTouchTarget(control: Locator) {
  await expect(control).toBeVisible()
  const box = await control.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
}

async function expectFullViewName(label: Locator) {
  await expect(label).toBeVisible()
  expect(await label.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    return Array.from(range.getClientRects()).every((rect) =>
      rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 &&
      rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1,
    )
  }), 'the full name must fit inside its visible label, not be clipped').toBe(true)
}

for (const locale of ['de', 'en'] as const) {
  const common = locale === 'de' ? deCommon : enCommon
  const workshop = locale === 'de' ? deWorkshop : enWorkshop
  const nav = locale === 'de' ? deNav : enNav
  const saveName = common.savedViews.saveAria.replace('{{title}}', workshop.orders.list.saveViewTitle)
  const menuName = common.savedViews.menuAria.replace('{{title}}', workshop.orders.list.saveViewTitle)

  test.describe(`Saved-view access in ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => window.localStorage.setItem('acp:ui-language', language), locale)
      await setupWorkshopOrdersForSaveView(page)
    })

    test('help names the same save action as the button', async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 })
      await new AutoCorePage(page, '').navigate('/workshop/orders?search=Service')
      const save = page.getByRole('button', { name: saveName })
      await expect(save).toBeVisible()
      await expect(page.getByText(nav.favorites.empty, { exact: true })).toContainText((await save.innerText()).trim())
    })

    for (const width of [375, 390, 1400]) {
      test(`unfiltered list can be saved at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 })
        await new AutoCorePage(page, '').navigate('/workshop/orders')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await testInfo.attach('unfiltered-list', { body: await page.screenshot(), contentType: 'image/png' })
        const save = page.getByRole('button', { name: saveName })
        await expect(save).toBeVisible()
        if (width < 768) await expectTouchTarget(save)
        await expectNoPageScroll(page)
        await save.click()
        const dialog = page.getByRole('dialog', { name: common.savedViews.title })
        await dialog.getByLabel(common.savedViews.nameLabel, { exact: true }).fill('Alle Aufträge')
        const request = page.waitForRequest((request) =>
          new URL(request.url()).pathname === '/api/saved-views' && request.method() === 'POST',
        )
        await dialog.getByRole('button', { name: common.actions.save, exact: true }).click()
        expect((await request).postDataJSON()).toMatchObject({
          name: 'Alle Aufträge', href: '/workshop/orders', visibility: 'PERSONAL',
        })
        await expect(dialog).toBeHidden()
        const savedToast = page.locator('[data-sonner-toast]').filter({ hasText: common.savedViews.added })
        await expect(savedToast).toBeVisible()
        await expect(savedToast).toBeHidden()
        await expectNoPageScroll(page)
      })

      test(`full team and personal names are readable at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 })
        await mockSavedViews(page, [
          savedView({ name: LONG_VIEW_NAME, visibility: 'TENANT' }),
          savedView({ id: 'personal-2', name: LONG_VIEW_NAME }),
        ])
        await new AutoCorePage(page, '').navigate('/workshop/orders')
        await page.getByRole('button', { name: menuName }).click()
        const menu = page.getByRole('dialog', { name: common.savedViews.menuTitle, exact: true })
        await expect(menu).toBeVisible()
        await testInfo.attach('view-names', { body: await page.screenshot(), contentType: 'image/png' })
        for (const section of [common.savedViews.teamSection, common.savedViews.personalSection]) {
          await expectFullViewName(menu.getByRole('region', { name: section, exact: true }).getByText(LONG_VIEW_NAME, { exact: true }))
        }
        await expectNoPageScroll(page)
      })

      test(`sidebar favourite can be renamed and shared at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 })
        await mockSavedViews(page, [savedView()])
        await new AutoCorePage(page, '').navigate('/workshop/orders')
        const navigation = page.getByRole('navigation', { name: nav.aria.mainNavigation })
        const openFavorites = async () => {
          if (width < 768) await page.getByRole('navigation', { name: nav.phoneNav.aria }).getByRole('button', { name: nav.phoneNav.more }).click()
        }
        await openFavorites()
        const favorite = navigation.locator('[data-sidebar="menu-item"]').filter({ has: page.getByRole('link', { name: 'Serviceaufträge', exact: true }) })
        await expect(favorite).toBeVisible()
        await favorite.scrollIntoViewIfNeeded()
        await testInfo.attach('sidebar-favourite', { body: await page.screenshot(), contentType: 'image/png' })
        const actions = favorite.getByRole('button', { name: common.peek.moreActions })
        if (width < 768) await expectTouchTarget(actions)
        await actions.focus()
        await page.keyboard.press('Enter')
        const rename = page.getByRole('menuitem', { name: common.savedViews.renameAction, exact: true })
        await expect(rename).toBeVisible()
        await testInfo.attach('sidebar-actions', { body: await page.screenshot(), contentType: 'image/png' })
        if (width < 768) await expectTouchTarget(rename)
        await rename.click()
        const dialog = page.getByRole('dialog', { name: common.savedViews.renameTitle })
        await dialog.getByLabel(common.savedViews.nameLabel, { exact: true }).fill('Service heute')
        const renameRequest = page.waitForRequest((request) => request.url().endsWith('/api/saved-views/saved-view-1') && request.method() === 'PATCH')
        await dialog.getByRole('button', { name: common.actions.save, exact: true }).click()
        expect((await renameRequest).postDataJSON()).toEqual({ name: 'Service heute', version: 1 })
        await expect(dialog).toBeHidden()
        await openFavorites()
        const renamed = navigation.locator('[data-sidebar="menu-item"]').filter({ has: page.getByRole('link', { name: 'Service heute' }) })
        await expect(renamed.getByRole('link')).toHaveAttribute('href', '/workshop/orders?search=Service')
        await renamed.getByRole('button', { name: common.peek.moreActions }).click()
        const share = page.getByRole('menuitem', { name: common.savedViews.shareAction, exact: true })
        if (width < 768) await expectTouchTarget(share)
        const shareRequest = page.waitForRequest((request) => request.url().endsWith('/api/saved-views/saved-view-1') && request.method() === 'PATCH')
        await share.click()
        expect((await shareRequest).postDataJSON()).toEqual({ visibility: 'TENANT', version: 2 })
        await expect(renamed.getByText(common.savedViews.teamBadge, { exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: menuName }).click()
        await expect(page.getByRole('dialog', { name: common.savedViews.menuTitle, exact: true })
          .getByRole('region', { name: common.savedViews.teamSection, exact: true })
          .getByText('Service heute', { exact: true })).toBeVisible()
      })
    }
  })
}

test('without shared-view permission neither surface shares or edits a read-only team view', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.addInitScript(() => window.localStorage.setItem('e2e-active-role', 'SALES'))
  await setupWorkshopOrdersForSaveView(page)
  await mockSavedViews(page, [
    savedView(),
    savedView({ id: 'team-2', name: 'Teamaufträge', visibility: 'TENANT', ownerUserId: 'another-user' }),
  ])
  await new AutoCorePage(page, '').navigate('/workshop/orders')
  const navigation = page.getByRole('navigation', { name: deNav.aria.mainNavigation })
  const personal = navigation.locator('[data-sidebar="menu-item"]').filter({ has: page.getByRole('link', { name: 'Serviceaufträge', exact: true }) })
  await personal.getByRole('button', { name: deCommon.peek.moreActions }).click()
  await expect(page.getByRole('menuitem', { name: deCommon.savedViews.renameAction })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: deCommon.savedViews.shareAction })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const team = navigation.locator('[data-sidebar="menu-item"]').filter({ has: page.getByRole('link', { name: 'Teamaufträge Team', exact: true }) })
  await expect(team).toBeVisible()
  await expect(team.getByRole('button')).toHaveCount(0)
  await page.getByRole('button', {
    name: deCommon.savedViews.menuAria.replace('{{title}}', deWorkshop.orders.list.saveViewTitle),
  }).click()
  const menu = page.getByRole('dialog', { name: 'Ansichten', exact: true })
  await expect(menu.getByRole('button', { name: 'Ansicht Serviceaufträge umbenennen' })).toBeVisible()
  await expect(menu.getByRole('button', { name: /mit Team teilen|Teilen.*aufheben|Teamaufträge umbenennen/ })).toHaveCount(0)
  await expect(menu.getByRole('button', { name: 'Ansicht Teamaufträge als eigene Ansicht speichern' })).toBeVisible()
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

type SaveViewLayoutScenario = {
  name: string
  viewport: { width: number; height: number }
  locale: 'de' | 'en'
  checkOverflow?: boolean
}

const SAVE_VIEW_LAYOUT_SCENARIOS: SaveViewLayoutScenario[] = [
  {
    name: 'WHEN the save-view dialog opens from /workshop/orders on desktop in DE THEN the full description is visible and does not run under the close button',
    viewport: { width: 1400, height: 900 },
    locale: 'de',
  },
  {
    name: 'WHEN the same dialog opens in EN THEN the translated description also clears the close button',
    viewport: { width: 1400, height: 900 },
    locale: 'en',
  },
  {
    name: 'WHEN the dialog opens at 375px THEN there is no text/X overlap and no horizontal overflow',
    viewport: { width: 375, height: 812 },
    locale: 'de',
    checkOverflow: true,
  },
]

test.describe('Save-view dialog layout and close control (AUT-880 / AUT-950)', () => {
  for (const scenario of SAVE_VIEW_LAYOUT_SCENARIOS) {
    test(scenario.name, async ({ page }) => {
      await page.setViewportSize(scenario.viewport)
      await setupWorkshopOrdersForSaveView(page)
      await new AutoCorePage(page, 'Order').navigate('/workshop/orders?search=Gruber')

      if (scenario.locale === 'en') {
        await page.getByRole('button', { name: DE_SHELL.user.accountEmail }).click()
        await page.getByTestId('language-option-en').click()
        await expect(page.locator('html')).toHaveAttribute('lang', 'en')
        await page.keyboard.press('Escape')
      }

      const common = scenario.locale === 'en' ? enCommon : deCommon
      const workshop = scenario.locale === 'en' ? enWorkshop : deWorkshop
      const triggerName = common.savedViews.saveAria.replace('{{title}}', workshop.orders.list.saveViewTitle)
      await page.getByRole('button', { name: triggerName }).click()

      const dialog = page.getByRole('dialog', { name: common.savedViews.title })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(common.savedViews.description)).toBeVisible()

      const closeButton = dialog.getByRole('button', { name: common.actions.close })
      const closeBox = await closeButton.boundingBox()
      expect(closeBox).not.toBeNull()
      expect(closeBox!.width).toBeGreaterThanOrEqual(44)
      expect(closeBox!.height).toBeGreaterThanOrEqual(44)

      expect(await textUnderDialogCloseButton(page), 'text under the close button').toEqual([])

      if (scenario.checkOverflow) {
        const dialogOverflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)
        expect(dialogOverflow).toBe(false)
        await expectNoPageScroll(page)
      }
    })
  }

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
