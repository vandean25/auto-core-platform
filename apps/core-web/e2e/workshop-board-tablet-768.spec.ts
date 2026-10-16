import { test, expect, type Page } from '@playwright/test'
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
      make: 'Skoda',
      model: 'Octavia',
      year: 2020,
      plate: `SK-20-${index}`,
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

async function expectColumnHeadersReachable(page: Page) {
  for (const id of MECHANIC_IDS) {
    await expect(page.getByTestId(`board-column-${id}`)).toBeVisible()
  }
  await expect(page.getByTestId('board-column-unassigned')).toBeVisible()
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

async function expectCardTextNotClipped(page: Page, orderId: string) {
  const card = page.getByTestId(`workshop-order-card-${orderId}`)
  await expect(card).toBeVisible()
  const clipped = await card.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const range = document.createRange()
      range.selectNodeContents(node)
      const rects = range.getClientRects()
      for (const rect of rects) {
        if (rect.width === 0 && (node.textContent?.trim().length ?? 0) > 0) {
          return true
        }
      }
      node = walker.nextNode()
    }
    return false
  })
  expect(clipped).toBe(false)
}

async function exerciseAssignWithKeyboardAndTouch(page: Page) {
  const assignButton = page.getByRole('button', { name: 'Assign WO-2026-102' })
  await assignButton.scrollIntoViewIfNeeded()
  await expect(assignButton).toBeVisible()

  const box = await assignButton.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24)
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(24)

  await assignButton.focus()
  await expect(assignButton).toBeFocused()
  await page.keyboard.press('Enter')
  const menuItem = page.getByTestId(`assign-mechanic-${MECHANIC_IDS[1]}`)
  await expect(menuItem).toBeVisible()
  await menuItem.click()
}

test.describe('AUT-489: Workshop board at 768px tablet', () => {
  test('768×1024 — stacked columns reachable, no overlap, assign actions work, axe passes', async ({
    page,
  }) => {
    await openBoardAtViewport(page, 768, 1024)

    await expectColumnHeadersReachable(page)
    await expectNoOverlappingColumnHeaders(page)
    await expectCardTextNotClipped(page, ORDER_IDS[1])

    await exerciseAssignWithKeyboardAndTouch(page)
    await expectNoCriticalA11yViolations(page)
  })

  test('1024×768 — horizontal scroll reaches all columns, actions work, axe passes', async ({
    page,
  }) => {
    await openBoardAtViewport(page, 1024, 768)

    const unassigned = page.getByTestId('board-column-unassigned')
    if (!(await unassigned.isVisible())) {
      const scrollRight = page.getByRole('button', { name: 'Scroll right' })
      while (await scrollRight.isVisible()) {
        await scrollRight.click()
        if (await unassigned.isVisible()) break
      }
    }

    await expectColumnHeadersReachable(page)
    await expectNoOverlappingColumnHeaders(page)
    await expect(page.getByTestId('workshop-board-scroll-hint')).toBeVisible()

    await exerciseAssignWithKeyboardAndTouch(page)
    await expectNoCriticalA11yViolations(page)
  })
})
