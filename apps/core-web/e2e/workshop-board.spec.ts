import { test, expect } from '@playwright/test'
import { DE_STATUS } from './helpers/de-enums'
import {
  DE_WORKSHOP,
  workshopBoardA11yDroppedOn,
  workshopEmptyMechanicsTitle,
  workshopOrderAssignAria,
  workshopOrderMoveAria,
} from './helpers/de-workshop'
import { AutoCorePage } from './pom/AutoCorePage'
import { expectNoAxeViolationsForRules } from './utils/a11y'
import {
  createMockEmployee,
  createMockBay,
} from './utils/mock-factories'

/**
 * Blueprint: Workshop Board
 *
 * E2E tests for the Workshop Kanban Board page (/workshop/board).
 * Covers:
 * - Page rendering with correct header structure and view toggle.
 * - Dynamic swimlane columns built from /api/workshop/resources.
 * - Board cards rendered from /api/workshop/board/active with parts status.
 * - View mode toggle (mechanic ↔ bay) and localStorage persistence.
 * - Empty-state rendering when no resources are configured.
 * - Board assignment via PATCH /api/workshop/board/assign.
 * - Unassigned column is always visible regardless of view mode.
 */
test.describe('Blueprint: Workshop Board', () => {
  const MECHANIC_ID = 'emp-mech-001'
  const BAY_ID = 'bay-001'
  const ORDER_ID = 'ws-board-001'
  const ORDER_ID_2 = 'ws-board-002'

  const mockMechanic = createMockEmployee({
    id: MECHANIC_ID,
    name: 'Alex Novak',
    role: 'MECHANIC',
    isActive: true,
    sortOrder: 1,
  })

  const mockBay = createMockBay({
    id: BAY_ID,
    name: 'Bay 01',
    isActive: true,
    sortOrder: 1,
  })

  const mockResources = {
    mechanics: [mockMechanic],
    bays: [mockBay],
  }

  const mockOrder = {
    id: ORDER_ID,
    orderNumber: 'WO-2026-0001',
    status: 'INTAKE',
    customer: {
      id: 'cust-1',
      type: 'PRIVATE',
      firstName: 'John',
      lastName: 'Doe',
      companyName: null,
    },
    vehicle: {
      id: 'veh-1',
      make: 'Skoda',
      model: 'Octavia',
      year: 2020,
      plate: 'SK-2020-OCT',
    },
    mechanicId: MECHANIC_ID,
    bayId: null,
    stagingLocationId: null,
    partsStatus: 'READY',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const mockUnassignedOrder = {
    id: ORDER_ID_2,
    orderNumber: 'WO-2026-0002',
    status: 'SCHEDULED',
    customer: {
      id: 'cust-2',
      type: 'PRIVATE',
      firstName: 'Maria',
      lastName: 'Müller',
      companyName: null,
    },
    vehicle: {
      id: 'veh-2',
      make: 'VW',
      model: 'Golf',
      year: 2022,
      plate: 'VW-2022-GLF',
    },
    mechanicId: null,
    bayId: null,
    stagingLocationId: null,
    partsStatus: 'NO_PARTS',
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const mockBoardActiveResponse = {
    data: [mockOrder, mockUnassignedOrder],
  }

  async function setupBoardRoutes(page: import('@playwright/test').Page) {
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/resources'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockResources),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/active'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockBoardActiveResponse),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/assign'),
      async (route) => {
        const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: body['orderId'],
            mechanicId: body['mechanicId'] ?? null,
            bayId: body['bayId'] ?? null,
            updatedAt: new Date().toISOString(),
          }),
        })
      },
    )
  }

  test('Board renders with page header and view toggle', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    await setupBoardRoutes(page)
    await corePage.navigate('/workshop/board')

    // Header title (top-left)
    await expect(page.getByRole('heading', { name: DE_WORKSHOP.board.title, exact: true })).toBeVisible()

    // View toggle top-right
    await expect(page.getByRole('radio', { name: DE_WORKSHOP.board.viewMode.byMechanic })).toBeVisible()
    await expect(page.getByRole('radio', { name: DE_WORKSHOP.board.viewMode.byBay })).toBeVisible()
  })

  test('Board renders mechanic swimlane columns with order cards', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    await setupBoardRoutes(page)

    // Clear any persisted view mode so we always start on mechanic view
    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    // Mechanic column "Alex Novak" should appear
    await expect(page.getByTestId('board-column-emp-mech-001')).toBeVisible()

    // Unassigned column is always present
    await expect(page.getByTestId('board-column-unassigned')).toBeVisible()

    // Assigned order card under mechanic
    await expect(page.getByText('WO-2026-0001')).toBeVisible()
    await expect(page.getByText(/John Doe/)).toBeVisible()
    await expect(page.getByText(/Skoda Octavia/i)).toBeVisible()

    // Unassigned order card in Unassigned column
    await expect(page.getByText('WO-2026-0002')).toBeVisible()
    await expect(page.getByText(/Maria Müller/i)).toBeVisible()
  })

  test('Board renders bay swimlane columns when switching to Bay view', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    await setupBoardRoutes(page)

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    // Switch to bay view
    await page.getByRole('radio', { name: DE_WORKSHOP.board.viewMode.byBay }).click()

    // Bay column "Bay 01" should appear
    await expect(page.getByTestId('board-column-bay-001')).toBeVisible()

    // Unassigned column is still visible
    await expect(page.getByTestId('board-column-unassigned')).toBeVisible()
  })

  test('View mode persists across page refreshes via localStorage', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    await setupBoardRoutes(page)

    await page.addInitScript(() => {
      window.localStorage.setItem('workshop-board-view-mode', 'bay')
    })

    await corePage.navigate('/workshop/board')

    // Should start in bay mode — "Bay 01" column visible
    await expect(page.getByTestId('board-column-bay-001')).toBeVisible()
    // Mechanic column "Alex Novak" should NOT appear in bay mode
    await expect(page.getByTestId('board-column-emp-mech-001')).not.toBeVisible()
  })

  test('Cards show parts status badge (READY and NO_PARTS)', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    await setupBoardRoutes(page)

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    // First card has READY parts status
    await expect(page.getByText('WO-2026-0001')).toBeVisible()
    await expect(page.getByText(DE_STATUS.READY).first()).toBeVisible()

    // Second card has NO_PARTS
    await expect(page.getByText('WO-2026-0002')).toBeVisible()
    await expect(page.getByText(DE_STATUS.NO_PARTS).first()).toBeVisible()
  })

  test('Empty state card renders when no mechanic resources exist', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    // Override resources with empty mechanics
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/resources'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mechanics: [], bays: [mockBay] }),
        })
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/active'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      },
    )

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    // Empty state card
    await expect(page.getByText(workshopEmptyMechanicsTitle())).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(DE_WORKSHOP.board.emptyResources.goToSettings, 'i') })).toBeVisible()

    // Unassigned column still visible alongside the empty state
    await expect(page.getByText(DE_WORKSHOP.board.unassigned)).toBeVisible()
  })

  test('Empty state "Go to Settings" routes to Settings employees tab', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/resources'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mechanics: [], bays: [] }),
        })
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/active'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      },
    )

    // Intercept settings-page API calls
    await page.route(AutoCorePage.apiRouteMatcher('/api/employees'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 1 } }),
      })
    })

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.board.emptyResources.goToSettings, 'i') }).click()

    // Should navigate to /settings?tab=employees
    await expect(page).toHaveURL(/\/settings.*tab=employees/)
  })

  test('Quick assign button calls PATCH /api/workshop/board/assign and moves the card', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    let assignCalled = false
    let assignPayload: Record<string, unknown> = {}
    let boardData = structuredClone(mockBoardActiveResponse)

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/resources'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockResources),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/active'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(boardData),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/assign'),
      async (route) => {
        assignCalled = true
        assignPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
        boardData = {
          ...boardData,
          data: boardData.data.map((order) =>
            order.id === ORDER_ID_2 ? { ...order, mechanicId: MECHANIC_ID, bayId: null } : order,
          ),
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: ORDER_ID_2, mechanicId: MECHANIC_ID, bayId: null, updatedAt: new Date().toISOString() }),
        })
      },
    )

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    const card = page.getByTestId('workshop-order-card-ws-board-002')
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/workshop/board/assign') &&
        response.request().method() === 'PATCH',
    )

    await card.getByRole('button', { name: workshopOrderAssignAria('WO-2026-0002') }).click()
    await page.getByTestId('assign-mechanic-emp-mech-001').click()
    await responsePromise

    expect(assignCalled).toBe(true)
    expect(assignPayload.orderId).toBe(ORDER_ID_2)
    expect(assignPayload.mechanicId).toBe(MECHANIC_ID)

    await expect(page.getByTestId('board-column-emp-mech-001')).toContainText('WO-2026-0002')
    await expect(page.getByTestId('board-column-unassigned')).not.toContainText('WO-2026-0002')
  })

  test('Shows horizontal scroll cues when mechanic columns overflow', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    const manyMechanics = Array.from({ length: 8 }, (_, index) =>
      createMockEmployee({
        id: `emp-mech-${index + 1}`,
        name: index === 7 ? 'Grok Bot' : `Mechanic ${index + 1}`,
        role: 'MECHANIC',
        isActive: true,
        sortOrder: index + 1,
      }),
    )

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/resources'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mechanics: manyMechanics, bays: [mockBay] }),
        })
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/active'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      },
    )

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    const scrollRight = page.getByRole('button', { name: 'Nach rechts scrollen' })
    await expect(scrollRight).toBeVisible()

    await scrollRight.click()

    await expect(page.getByTestId('board-column-emp-mech-8')).toBeVisible()
    await expect(page.getByText('Grok Bot')).toBeVisible()
  })

  test('Rolls back optimistic update if assign API call fails', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/resources'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockResources),
        })
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/active'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockBoardActiveResponse),
        })
      },
    )
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/assign'),
      async (route) => {
        await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'Order is in a terminal state' }) })
      },
    )

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    const card = page.getByTestId('workshop-order-card-ws-board-002')
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/workshop/board/assign') &&
        response.request().method() === 'PATCH',
    )

    await card.getByRole('button', { name: workshopOrderAssignAria('WO-2026-0002') }).click()
    await page.getByTestId('assign-mechanic-emp-mech-001').click()
    const response = await responsePromise

    expect(response.status()).toBe(422)
    await expect(page.getByText(DE_WORKSHOP.board.assignError)).toBeVisible()
    await expect(page.getByTestId('board-column-unassigned')).toContainText('WO-2026-0002')
    await expect(page.getByTestId('board-column-emp-mech-001')).not.toContainText('WO-2026-0002')
  })

  test('Drag-and-drop assigns an unassigned card to the column under the cursor', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)
    const MECHANIC_ID_2 = 'emp-mech-002'
    const mockMechanic2 = createMockEmployee({
      id: MECHANIC_ID_2,
      name: 'Grok Bot',
      role: 'MECHANIC',
      isActive: true,
      sortOrder: 2,
    })

    let assignCalled = false
    let assignPayload: Record<string, unknown> = {}
    let boardData = structuredClone(mockBoardActiveResponse)

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/resources'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mechanics: [mockMechanic, mockMechanic2], bays: [mockBay] }),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/active'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(boardData),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/assign'),
      async (route) => {
        assignCalled = true
        assignPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
        boardData = {
          ...boardData,
          data: boardData.data.map((order) =>
            order.id === ORDER_ID_2 ? { ...order, mechanicId: MECHANIC_ID_2, bayId: null } : order,
          ),
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: ORDER_ID_2,
            mechanicId: MECHANIC_ID_2,
            bayId: null,
            updatedAt: new Date().toISOString(),
          }),
        })
      },
    )

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    const card = page.getByTestId('workshop-order-card-ws-board-002')
    const targetColumn = page.getByTestId(`board-column-${MECHANIC_ID_2}`)
    const cardBox = await card.boundingBox()
    const columnBox = await targetColumn.boundingBox()

    if (!cardBox || !columnBox) {
      throw new Error('Expected card and target column to be visible for drag-and-drop')
    }

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/workshop/board/assign') &&
        response.request().method() === 'PATCH',
    )

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + 80, { steps: 12 })
    await page.mouse.up()
    await responsePromise

    expect(assignCalled).toBe(true)
    expect(assignPayload.orderId).toBe(ORDER_ID_2)
    expect(assignPayload.mechanicId).toBe(MECHANIC_ID_2)

    await expect(targetColumn).toContainText('WO-2026-0002')
    await expect(targetColumn.getByTestId('workshop-order-card-ws-board-002')).toBeVisible()
    await expect(page.getByTestId('board-column-unassigned')).not.toContainText('WO-2026-0002')
  })

  test('Assign button is a visible target of at least 24px and passes axe target-size', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    await setupBoardRoutes(page)

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    const assignButton = page.getByRole('button', { name: workshopOrderAssignAria('WO-2026-0002') })
    await expect(assignButton).toBeVisible()

    const box = await assignButton.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24)

    await expectNoAxeViolationsForRules(page, ['target-size'])
  })

  test('Keyboard drag announces the order number and column, not the order id', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)
    const MECHANIC_ID_2 = 'emp-mech-002'
    const mockMechanic2 = createMockEmployee({
      id: MECHANIC_ID_2,
      name: 'Grok Bot',
      role: 'MECHANIC',
      isActive: true,
      sortOrder: 2,
    })

    let assignPayload: Record<string, unknown> = {}
    let boardData = structuredClone(mockBoardActiveResponse)

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/resources'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mechanics: [mockMechanic, mockMechanic2], bays: [mockBay] }),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/active'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(boardData),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher('/api/workshop/board/assign'),
      async (route) => {
        assignPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
        boardData = {
          ...boardData,
          data: boardData.data.map((order) =>
            order.id === ORDER_ID_2 ? { ...order, mechanicId: MECHANIC_ID, bayId: null } : order,
          ),
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: ORDER_ID_2, mechanicId: MECHANIC_ID, bayId: null, updatedAt: new Date().toISOString() }),
        })
      },
    )

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    // Columns run Alex Novak, Grok Bot, Unassigned, so the card moves left until it is over Alex Novak.
    const handle = page
      .getByTestId('workshop-order-card-ws-board-002')
      .getByRole('button', { name: workshopOrderMoveAria('WO-2026-0002') })
    const liveRegion = page.locator('[id^="DndLiveRegion"]')
    await handle.focus()
    await page.keyboard.press('Space')
    // dnd-kit announces the pick-up and the first over-change back to back, so assert the order number only.
    await expect(liveRegion).toContainText('WO-2026-0002')

    for (let step = 0; step < 80; step += 1) {
      await page.keyboard.press('ArrowLeft')
      if ((await liveRegion.textContent())?.includes('Mechaniker Alex Novak')) break
    }

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/workshop/board/assign') &&
        response.request().method() === 'PATCH',
    )
    await page.keyboard.press('Space')
    await responsePromise

    await expect(liveRegion).toHaveText(
      workshopBoardA11yDroppedOn('WO-2026-0002', 'Alex Novak'),
    )
    await expect(liveRegion).not.toContainText(ORDER_ID_2)
    expect(assignPayload.orderId).toBe(ORDER_ID_2)
    expect(assignPayload.mechanicId).toBe(MECHANIC_ID)
    await expect(page.getByTestId('board-column-emp-mech-001')).toContainText('WO-2026-0002')
  })
})
