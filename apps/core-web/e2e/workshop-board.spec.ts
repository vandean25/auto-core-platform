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
import { expectNoPageScroll } from './utils/phone-layout'
import {
  createMockEmployee,
  createMockBay,
} from './utils/mock-factories'
import { TouchGestureClient } from './utils/touch-gestures'

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

  test('Cards show parts status badge when actionable (READY) and omit NO_PARTS', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_WORKSHOP.board.title)

    await setupBoardRoutes(page)

    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    await corePage.navigate('/workshop/board')

    // First card has READY parts status
    await expect(page.getByText('WO-2026-0001')).toBeVisible()
    await expect(page.getByText(DE_STATUS.READY).first()).toBeVisible()

    // Second card has NO_PARTS (omitted per AUT-952)
    await expect(page.getByText('WO-2026-0002')).toBeVisible()
    await expect(page.getByText(DE_STATUS.NO_PARTS)).toHaveCount(0)
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

  test('Keeps the card in its column and reports the error if the assign API call fails', async ({ page }) => {
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

  async function setupDragBoard(page: import('@playwright/test').Page, assignStatus: number) {
    const mechanic2 = createMockEmployee({
      id: 'emp-mech-002',
      name: 'Grok Bot',
      role: 'MECHANIC',
      isActive: true,
      sortOrder: 2,
    })
    // Alex Novak keeps WO-0001; Grok Bot is empty; WO-0002 is the only card in "Nicht zugeordnet".
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mechanics: [mockMechanic, mechanic2], bays: [mockBay] }),
      }),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/board/active'), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockBoardActiveResponse),
      }),
    )
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/board/assign'), (route) =>
      route.fulfill({
        status: assignStatus,
        contentType: 'application/json',
        body: JSON.stringify(
          assignStatus === 200
            ? { id: ORDER_ID_2, mechanicId: 'emp-mech-002', bayId: null, updatedAt: new Date().toISOString() }
            : { message: 'Order is in a terminal state' },
        ),
      }),
    )
    await page.addInitScript(() => {
      window.localStorage.removeItem('workshop-board-view-mode')
    })
    await new AutoCorePage(page, DE_WORKSHOP.board.title).navigate('/workshop/board')
  }

  async function startDraggingCard(page: import('@playwright/test').Page) {
    const cardBox = await page.getByTestId('workshop-order-card-ws-board-002').boundingBox()
    const targetBox = await page.getByTestId('board-column-emp-mech-002').boundingBox()
    if (!cardBox || !targetBox) throw new Error('Expected card and target column to be visible')
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 80, { steps: 12 })
    return { targetBox }
  }

  test('WHEN a card is dragged out of a column THEN that column keeps its height and the empty state waits for the server; WHEN it hovers an empty column THEN a drop slot is shown', async ({ page }) => {
    await setupDragBoard(page, 200)
    const source = page.getByTestId('board-column-unassigned')
    const target = page.getByTestId('board-column-emp-mech-002')
    const heightBefore = (await source.boundingBox())?.height

    await startDraggingCard(page)

    expect((await source.boundingBox())?.height).toBe(heightBefore)
    await expect(source).not.toContainText(DE_WORKSHOP.board.emptyColumn)
    await expect(target.getByTestId('board-drop-slot')).toBeVisible()
    await expect(target).not.toContainText(DE_WORKSHOP.board.emptyColumn)

    // The move is server-confirmed (ADR-0036): the mocked board still lists the card as unassigned, so it stays.
    await page.mouse.up()
    await expect(source.getByTestId('workshop-order-card-ws-board-002')).toBeVisible()
    await expect(source).not.toContainText(DE_WORKSHOP.board.emptyColumn)
    await expect(target.getByTestId('workshop-order-card-ws-board-002')).toHaveCount(0)
  })

  test('WHEN the assign request fails after a drag THEN the card returns to the source column', async ({ page }) => {
    await setupDragBoard(page, 422)
    const source = page.getByTestId('board-column-unassigned')

    await startDraggingCard(page)
    await page.mouse.up()

    await expect(page.getByText(DE_WORKSHOP.board.assignError)).toBeVisible()
    await expect(source.getByTestId('workshop-order-card-ws-board-002')).toBeVisible()
    await expect(page.getByTestId('board-column-emp-mech-002')).not.toContainText('WO-2026-0002')
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

  test('WHEN /workshop/board is opened at 375px THEN Mechaniker/Hebebühne controls sit on one row without overflow', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await setupBoardRoutes(page)
    await new AutoCorePage(page, DE_WORKSHOP.board.title).navigate('/workshop/board')

    const mechanic = page.getByRole('radio', { name: DE_WORKSHOP.board.viewMode.byMechanic })
    const bay = page.getByRole('radio', { name: DE_WORKSHOP.board.viewMode.byBay })
    await expect(mechanic).toBeVisible()
    const mechanicBox = (await mechanic.boundingBox())!
    const bayBox = (await bay.boundingBox())!
    expect(Math.abs(mechanicBox.y - bayBox.y), 'controls share one row').toBeLessThan(8)
    expect(bayBox.x, 'bay sits beside mechanic').toBeGreaterThanOrEqual(mechanicBox.x + mechanicBox.width - 1)
    expect(bayBox.x + bayBox.width).toBeLessThanOrEqual(375)
    expect(mechanicBox.height).toBeGreaterThanOrEqual(43.5)
    expect(bayBox.height).toBeGreaterThanOrEqual(43.5)
    await expectNoPageScroll(page)
    await testInfo.attach('aut-953-board-375', { body: await page.screenshot(), contentType: 'image/png' })
  })
})

test.describe('AUT-1035: Workshop board touch drag-and-drop', () => {
  test.use({ hasTouch: true })

  const MECHANIC_1_ID = 'emp-mech-001'
  const MECHANIC_2_ID = 'emp-mech-002'
  const ORDER_1_ID = 'ws-touch-001'
  const ORDER_2_ID = 'ws-touch-002'

  function createTouchBoardData(extraMechanicsCount = 0) {
    const mechanics = [
      createMockEmployee({
        id: MECHANIC_1_ID,
        name: 'Alex Novak',
        role: 'MECHANIC',
        isActive: true,
        sortOrder: 1,
      }),
      createMockEmployee({
        id: MECHANIC_2_ID,
        name: 'Grok Bot',
        role: 'MECHANIC',
        isActive: true,
        sortOrder: 2,
      }),
      ...Array.from({ length: extraMechanicsCount }, (_, index) =>
        createMockEmployee({
          id: `emp-mech-extra-${index + 1}`,
          name: `Extra Mech ${index + 1}`,
          role: 'MECHANIC',
          isActive: true,
          sortOrder: index + 3,
        }),
      ),
    ]

    const orders = [
      {
        id: ORDER_1_ID,
        orderNumber: 'WO-2026-0101',
        status: 'INTAKE',
        customer: {
          id: 'cust-t1',
          type: 'PRIVATE',
          firstName: 'John',
          lastName: 'Doe',
          companyName: null,
        },
        vehicle: {
          id: 'veh-t1',
          make: 'Skoda',
          model: 'Octavia',
          year: 2020,
          plate: 'SK-2020-OCT',
        },
        mechanicId: MECHANIC_1_ID,
        bayId: null,
        stagingLocationId: null,
        partsStatus: 'READY',
        tasks: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: ORDER_2_ID,
        orderNumber: 'WO-2026-0102',
        status: 'SCHEDULED',
        customer: {
          id: 'cust-t2',
          type: 'PRIVATE',
          firstName: 'Maria',
          lastName: 'Müller',
          companyName: null,
        },
        vehicle: {
          id: 'veh-t2',
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
      },
    ]

    return { mechanics, orders }
  }

  async function setupTouchBoard(
    page: import('@playwright/test').Page,
    options?: { extraMechanicsCount?: number },
  ) {
    const { mechanics, orders } = createTouchBoardData(options?.extraMechanicsCount ?? 0)
    let boardOrders = structuredClone(orders)
    let assignCalls = 0
    let lastAssignPayload: Record<string, unknown> | null = null

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mechanics, bays: [] }),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/board/active'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: boardOrders }),
      })
    })

    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/board/assign'), async (route) => {
      assignCalls += 1
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
      lastAssignPayload = body
      boardOrders = boardOrders.map((order) =>
        order.id === body['orderId']
          ? { ...order, mechanicId: (body['mechanicId'] as string | null) ?? null, bayId: null }
          : order,
      )
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
    })

    await page.addInitScript(() => {
      window.localStorage.setItem('acp:sidebar-collapsed', 'true')
      window.localStorage.removeItem('workshop-board-view-mode')
    })

    return {
      getAssignCalls: () => assignCalls,
      getLastAssignPayload: () => lastAssignPayload,
    }
  }

  test('WHEN a user on a touch device long-presses an order card (~250 ms) and moves it to another column THEN the order moves to that column and the toast appears', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const tracker = await setupTouchBoard(page)
    await new AutoCorePage(page, DE_WORKSHOP.board.title).navigate('/workshop/board')

    const card = page
      .getByTestId(`board-column-${MECHANIC_1_ID}`)
      .getByTestId(`workshop-order-card-${ORDER_1_ID}`)
    const targetColumn = page.getByTestId(`board-column-${MECHANIC_2_ID}`)
    await expect(card).toBeVisible()
    await expect(targetColumn).toBeVisible()

    const cardBox = (await card.boundingBox())!
    const targetBox = (await targetColumn.boundingBox())!
    const startPoint = { x: cardBox.x + cardBox.width / 3, y: cardBox.y + cardBox.height / 2 }
    const endPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + 60 }

    const touch = await TouchGestureClient.create(page)
    try {
      await touch.start(startPoint)
      // Wait for the 250ms TouchSensor activation to put the source card into placeholder state.
      await expect(card).toHaveClass(/invisible/, { timeout: 2000 })

      const assignPromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/workshop/board/assign') &&
          response.request().method() === 'PATCH',
      )
      await touch.move(startPoint, endPoint, 10)
      await touch.end()
      await assignPromise
    } finally {
      await touch.dispose()
    }

    expect(tracker.getAssignCalls()).toBe(1)
    expect(tracker.getLastAssignPayload()).toMatchObject({
      orderId: ORDER_1_ID,
      mechanicId: MECHANIC_2_ID,
    })
    await expect(targetColumn.getByTestId(`workshop-order-card-${ORDER_1_ID}`)).toBeVisible()
    await expect(page.getByText(DE_WORKSHOP.board.technicianAssigned)).toBeVisible()
    await testInfo.attach('aut-1035-board-touch-longpress-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('WHEN the target column is horizontally scrolled out of view THEN dragging to the edge auto-scrolls and the drop succeeds', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    const tracker = await setupTouchBoard(page, { extraMechanicsCount: 4 })
    await new AutoCorePage(page, DE_WORKSHOP.board.title).navigate('/workshop/board')

    const card = page
      .getByTestId(`board-column-${MECHANIC_1_ID}`)
      .getByTestId(`workshop-order-card-${ORDER_1_ID}`)
    const targetColumn = page.getByTestId('board-column-unassigned')
    await expect(card).toBeVisible()

    const scrollRegion = page.getByTestId('horizontal-scroll-area').getByRole('region')
    const scrollBox = (await scrollRegion.boundingBox())!
    const cardBox = (await card.boundingBox())!
    const startPoint = { x: cardBox.x + cardBox.width / 3, y: cardBox.y + cardBox.height / 2 }
    const rightEdgePoint = { x: scrollBox.x + scrollBox.width - 12, y: scrollBox.y + 120 }

    // Target column starts scrolled out of view to the right.
    const initialTargetBox = await targetColumn.boundingBox()
    expect(initialTargetBox && initialTargetBox.x >= scrollBox.x + scrollBox.width).toBe(true)

    const touch = await TouchGestureClient.create(page)
    try {
      await touch.start(startPoint)
      await expect(card).toHaveClass(/invisible/, { timeout: 2000 })
      await touch.move(startPoint, rightEdgePoint, 10)

      // Wait for dnd-kit auto-scroll to bring the off-screen target column into the scroll viewport.
      await expect
        .poll(async () => {
          const box = await targetColumn.boundingBox()
          return box ? box.x + box.width / 2 < scrollBox.x + scrollBox.width : false
        })
        .toBe(true)

      const visibleTargetBox = (await targetColumn.boundingBox())!
      const dropPoint = {
        x: Math.min(visibleTargetBox.x + visibleTargetBox.width / 2, scrollBox.x + scrollBox.width - 20),
        y: visibleTargetBox.y + 80,
      }

      const assignPromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/workshop/board/assign') &&
          response.request().method() === 'PATCH',
      )
      await touch.move(rightEdgePoint, dropPoint, 6)
      await touch.end()
      await assignPromise
    } finally {
      await touch.dispose()
    }

    expect(tracker.getAssignCalls()).toBe(1)
    expect(tracker.getLastAssignPayload()).toMatchObject({
      orderId: ORDER_1_ID,
      mechanicId: null,
    })
    await expect(targetColumn.getByTestId(`workshop-order-card-${ORDER_1_ID}`)).toBeVisible()
    await testInfo.attach('aut-1035-board-touch-autoscroll-1024', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('WHEN a user swipes quickly over the board without holding THEN the board scrolls and no drag starts', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 600 })
    const tracker = await setupTouchBoard(page, { extraMechanicsCount: 4 })
    await new AutoCorePage(page, DE_WORKSHOP.board.title).navigate('/workshop/board')

    const sourceColumn = page.getByTestId(`board-column-${MECHANIC_1_ID}`)
    const card = sourceColumn.getByTestId(`workshop-order-card-${ORDER_1_ID}`)
    await expect(card).toBeVisible()

    const cardBox = (await card.boundingBox())!
    const scrollBefore = await page.evaluate(() => window.scrollY)

    const touch = await TouchGestureClient.create(page)
    try {
      await touch.swipe(
        { x: cardBox.x + cardBox.width / 3, y: cardBox.y + cardBox.height / 2 },
        { x: cardBox.x + cardBox.width / 3, y: cardBox.y - 220 },
        8,
      )
    } finally {
      await touch.dispose()
    }

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore)
    expect(tracker.getAssignCalls()).toBe(0)
    await expect(sourceColumn.getByTestId(`workshop-order-card-${ORDER_1_ID}`)).toBeVisible()
    await testInfo.attach('aut-1035-board-touch-swipe-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('WHEN a user touches the grip button THEN the drag starts without the long-press delay', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const tracker = await setupTouchBoard(page)
    await new AutoCorePage(page, DE_WORKSHOP.board.title).navigate('/workshop/board')

    const card = page.getByTestId(`workshop-order-card-${ORDER_1_ID}`)
    const grip = card.getByRole('button', { name: workshopOrderMoveAria('WO-2026-0101') })
    const targetColumn = page.getByTestId(`board-column-${MECHANIC_2_ID}`)
    await expect(grip).toBeVisible()
    await expect(targetColumn).toBeVisible()

    const gripBox = (await grip.boundingBox())!
    const targetBox = (await targetColumn.boundingBox())!
    const startPoint = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 }
    const endPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + 60 }

    const touch = await TouchGestureClient.create(page)
    try {
      const assignPromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/workshop/board/assign') &&
          response.request().method() === 'PATCH',
      )
      // Immediate move after touchStart (no 250ms wait) — only succeeds when grip bypasses delay.
      await touch.start(startPoint)
      await touch.move(startPoint, endPoint, 10)
      await touch.end()
      await assignPromise
    } finally {
      await touch.dispose()
    }

    expect(tracker.getAssignCalls()).toBe(1)
    expect(tracker.getLastAssignPayload()).toMatchObject({
      orderId: ORDER_1_ID,
      mechanicId: MECHANIC_2_ID,
    })
    await expect(targetColumn.getByTestId(`workshop-order-card-${ORDER_1_ID}`)).toBeVisible()
    await testInfo.attach('aut-1035-board-touch-grip-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })

  test('WHEN a user taps an order card THEN no assign mutation is sent', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const tracker = await setupTouchBoard(page)
    await new AutoCorePage(page, DE_WORKSHOP.board.title).navigate('/workshop/board')

    const sourceColumn = page.getByTestId(`board-column-${MECHANIC_1_ID}`)
    const card = sourceColumn.getByTestId(`workshop-order-card-${ORDER_1_ID}`)
    await expect(card).toBeVisible()

    await card.tap()

    expect(tracker.getAssignCalls()).toBe(0)
    await expect(sourceColumn.getByTestId(`workshop-order-card-${ORDER_1_ID}`)).toBeVisible()
    await testInfo.attach('aut-1035-board-touch-tap-375', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
