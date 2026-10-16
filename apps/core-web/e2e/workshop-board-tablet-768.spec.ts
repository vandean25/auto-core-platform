import { test, expect, type Page, type Locator } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { expectNoCriticalA11yViolations } from './utils/a11y'
import { createMockBay, createMockEmployee } from './utils/mock-factories'

const MECHANIC_IDS = ['emp-mech-001', 'emp-mech-002', 'emp-mech-003']
const BAY_ID = 'bay-001'
const ORDER_IDS = ['ws-board-001', 'ws-board-002', 'ws-board-003']

function buildBoardPayload() {
  const mechanics = MECHANIC_IDS.map((id, index) =>
    createMockEmployee({
      id,
      name: `Mechanic ${index + 1}`,
      role: 'MECHANIC',
      isActive: true,
      sortOrder: index + 1,
    }),
  )

  const orders = ORDER_IDS.map((id, index) => ({
    id,
    orderNumber: `WO-2026-10${index + 1}`,
    status: 'INTAKE',
    customer: {
      id: `cust-${index}`,
      type: 'PRIVATE',
      firstName: 'Pilot',
      lastName: `Customer ${index + 1}`,
      companyName: null,
    },
    vehicle: {
      id: `veh-${index}`,
      make: index === 0 ? 'Mercedes-Benz' : 'Skoda',
      model: index === 0 ? 'Sprinter' : 'Octavia',
      year: index === 0 ? 2018 : 2020,
      plate: index === 0 ? 'GR-123AB' : `SK-20-${index}`,
    },
    mechanicId: index === 0 ? MECHANIC_IDS[0] : null,
    bayId: null,
    stagingLocationId: null,
    partsStatus: 'READY',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))

  return {
    resources: {
      mechanics,
      bays: [
        createMockBay({
          id: BAY_ID,
          name: 'Bay 01',
          isActive: true,
          sortOrder: 1,
        }),
      ],
    },
    board: { data: orders },
  }
}

async function setupTabletBoard(page: Page) {
  const { resources, board } = buildBoardPayload()

  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resources),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/board/active'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(board),
    })
  })

  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/board/assign'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: ORDER_IDS[1],
        mechanicId: MECHANIC_IDS[1],
        bayId: null,
        updatedAt: new Date().toISOString(),
      }),
    })
  })
}

async function openBoardAtViewport(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await page.addInitScript(() => {
    window.localStorage.setItem('acp:sidebar-collapsed', 'true')
    window.localStorage.removeItem('workshop-board-view-mode')
  })
  const corePage = new AutoCorePage(page, 'Workshop Board')
  await setupTabletBoard(page)
  await corePage.navigate('/workshop/board')
  await expect(page.getByRole('heading', { name: 'Workshop Board' })).toBeVisible()
}

const COLUMN_TEST_IDS = [
  ...MECHANIC_IDS.map((id) => `board-column-${id}`),
  'board-column-unassigned',
]

async function isLocatorInViewport(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return (
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth
    )
  })
}

async function scrollColumnIntoViewport(page: Page, columnTestId: string) {
  const column = page.getByTestId(columnTestId)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await isLocatorInViewport(column)) return
    const scrollRight = page.getByTestId('workshop-board-scroll-right')
    if (!(await scrollRight.isVisible())) break
    await scrollRight.click()
  }
  await expect(column).toBeInViewport()
}

async function expectAllColumnsInViewport(page: Page) {
  for (const testId of COLUMN_TEST_IDS) {
    await scrollColumnIntoViewport(page, testId)
  }
}

async function expectNoOverlappingColumnHeaders(page: Page) {
  const boxes = await page
    .locator('[data-testid^="board-column-"]')
    .evaluateAll((elements) =>
      elements.map((el) => {
        const rect = el.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
      }),
    )

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      const overlapsVertically = a.top < b.bottom && b.top < a.bottom
      const overlapsHorizontally = a.left < b.right && b.left < a.right
      expect(
        overlapsVertically && overlapsHorizontally,
        `Columns ${i} and ${j} overlap`,
      ).toBe(false)
    }
  }
}

async function expectNoHorizontalPageOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
}

async function expectScrollControlsDoNotOverlapCard(page: Page, card: Locator) {
  const scrollRight = page.getByTestId('workshop-board-scroll-right')
  if (!(await scrollRight.isVisible())) return

  const buttonBox = await scrollRight.boundingBox()
  expect(buttonBox).not.toBeNull()
  const overlapsCard = await card.evaluate((el, btn) => {
    const cardRect = el.getBoundingClientRect()
    const b = btn as { x: number; y: number; width: number; height: number }
    const btnRight = b.x + b.width
    const btnBottom = b.y + b.height
    return !(
      btnRight < cardRect.left ||
      b.x > cardRect.right ||
      btnBottom < cardRect.top ||
      b.y > cardRect.bottom
    )
  }, buttonBox!)
  expect(overlapsCard).toBe(false)
}

async function exerciseAssignWithKeyboard(page: Page) {
  await scrollColumnIntoViewport(page, 'board-column-unassigned')
  const card = page.getByTestId(`workshop-order-card-${ORDER_IDS[1]}`)
  await card.scrollIntoViewIfNeeded()
  const assignButton = page.getByRole('button', { name: 'Assign WO-2026-102' })
  await expect(assignButton).toBeInViewport()

  const box = await assignButton.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24)
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(24)

  await assignButton.focus()
  await expect(assignButton).toBeFocused()
  await page.keyboard.press('Enter')
  const menuItem = page.getByTestId(`assign-mechanic-${MECHANIC_IDS[1]}`)
  await expect(menuItem).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
}

async function exerciseAssignWithTouch(page: Page) {
  await scrollColumnIntoViewport(page, 'board-column-unassigned')
  const card = page.getByTestId(`workshop-order-card-${ORDER_IDS[1]}`)
  await card.scrollIntoViewIfNeeded()
  const assignButton = page.getByRole('button', { name: 'Assign WO-2026-102' })
  await expect(assignButton).toBeInViewport()
  await assignButton.tap({ force: true })
  const menuItem = page.getByTestId(`assign-mechanic-${MECHANIC_IDS[1]}`)
  await expect(menuItem).toBeVisible()
  await menuItem.tap()
}

async function reloadBoard(page: Page) {
  await setupTabletBoard(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Workshop Board' })).toBeVisible()
}

test.describe('AUT-489: Workshop board at 768px tablet', () => {
  test.use({ hasTouch: true })
  test('768×1024 — stacked columns reachable, no overlap, assign actions work, axe passes', async ({
    page,
  }) => {
    await openBoardAtViewport(page, 768, 1024)

    for (const testId of COLUMN_TEST_IDS) {
      await expect(page.getByTestId(testId)).toBeInViewport()
    }
    await expectNoOverlappingColumnHeaders(page)

    await exerciseAssignWithTouch(page)
    await reloadBoard(page)
    await exerciseAssignWithKeyboard(page)
    await expectNoCriticalA11yViolations(page)
  })

  test('1024×768 — horizontal scroll reaches all columns, actions work, axe passes', async ({
    page,
  }) => {
    await openBoardAtViewport(page, 1024, 768)

    await expect(page.getByTestId('workshop-board-scroll-hint')).toBeVisible()
    await expectAllColumnsInViewport(page)
    await expectNoOverlappingColumnHeaders(page)

    const firstCard = page.getByTestId(`workshop-order-card-${ORDER_IDS[0]}`)
    await expect(firstCard).toBeInViewport()
    await expectScrollControlsDoNotOverlapCard(page, firstCard)

    await exerciseAssignWithTouch(page)
    await reloadBoard(page)
    await exerciseAssignWithKeyboard(page)
    await expectNoCriticalA11yViolations(page)
  })

  test('320px reflow (400% zoom equivalent) does not scroll the page horizontally', async ({
    page,
  }) => {
    await openBoardAtViewport(page, 320, 800)
    await expectNoHorizontalPageOverflow(page)
  })
})
