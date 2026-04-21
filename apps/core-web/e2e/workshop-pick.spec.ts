import { test, expect, type Page } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockListResponse,
  createMockStorageLocation,
  createMockWorkshopOrder,
} from './utils/mock-factories';

const LIVE_PICK_SKU = '06J-115-403-Q';

async function seedWorkshopOrderForPick(page: Page) {
  const searchResponse = await page.request.get('/api/workshop/search?q=max');
  expect(searchResponse.ok(), 'Expected workshop search API to succeed').toBeTruthy();

  const searchPayload = await searchResponse.json();
  const vehicles = Array.isArray(searchPayload?.data?.vehicles)
    ? (searchPayload.data.vehicles as Array<{ customer?: { id?: string } | null; id: string }>)
    : [];
  const vehicle = vehicles.find((entry) => entry.customer?.id);
  expect(vehicle, 'Expected at least one seeded vehicle with a linked customer').toBeTruthy();

  const createOrderResponse = await page.request.post('/api/workshop/orders', {
    data: {
      customerId: vehicle.customer.id,
      vehicleId: vehicle.id,
      odometer: 123456,
      fuelLevel: 50,
      reportedIssue: 'E2E pick queue smoke',
    },
  });
  expect(createOrderResponse.ok(), 'Expected workshop order creation to succeed').toBeTruthy();
  const createdOrder = await createOrderResponse.json();

  const createTaskResponse = await page.request.post(
    `/api/workshop/orders/${createdOrder.id}/tasks`,
    {
      data: { title: 'E2E pickable task' },
    },
  );
  expect(createTaskResponse.ok(), 'Expected workshop task creation to succeed').toBeTruthy();
  const createdTask = await createTaskResponse.json();

  const replaceLineItemsResponse = await page.request.patch(
    `/api/workshop/orders/${createdOrder.id}/tasks/${createdTask.id}/line-items`,
    {
      data: {
        items: [
          {
            type: 'PART',
            itemNo: LIVE_PICK_SKU,
            description: 'E2E smoke pick part',
            qty: 1,
            unitPrice: 19.9,
          },
        ],
      },
    },
  );
  expect(
    replaceLineItemsResponse.ok(),
    'Expected workshop task line item replacement to succeed',
  ).toBeTruthy();

  const orderWithPartLines = await replaceLineItemsResponse.json();

  return {
    orderId: orderWithPartLines.id as string,
    orderNumber: (orderWithPartLines.order_number ?? createdOrder.order_number) as string,
  };
}

async function mockPickQueueBaseRoutes(page: Page, orderId = 'ws-123') {
  const mockedOrder = createMockWorkshopOrder({
    id: orderId,
    order_number: 'WO-2026-0099',
    status: 'INTAKE',
    tasks: [
      {
        id: 'task-1',
        title: 'Oil Service',
        done: false,
        status: 'NOT_STARTED',
        mechanicNotes: '',
        lineItems: [
          {
            id: 'line-1',
            type: 'PART',
            itemNo: '06J-115-403-Q',
            description: 'Oil Filter',
            qty: 2,
            unitPrice: 19.9,
          },
        ],
      },
    ],
  });

  const mockedLocations = [
    createMockStorageLocation({
      id: 'loc-tote-001',
      code: 'TOTE-001',
      name: 'Staging Tote 001',
      type: 'staging_tote',
    }),
    createMockStorageLocation({
      id: 'loc-bin-001',
      code: 'BIN-001',
      name: 'Primary Bin 001',
      type: 'bin',
    }),
  ];

  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockListResponse([mockedOrder])),
    });
  });

  await page.route(new RegExp(`.*/api/workshop/orders/${orderId}(\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockedOrder),
    });
  });

  await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockedLocations),
    });
  });

  return { mockedOrder, mockedLocations };
}

test.describe('Workshop Pick Queue — Smoke Tests (seed-based)', () => {
  test('should open pick drawer from a seeded pick queue row', async ({ page }) => {
    const seededOrder = await seedWorkshopOrderForPick(page);
    const corePage = new AutoCorePage(page, 'Order');

    await corePage.navigate('/workshop/pick-list');

    await expect(
      page.getByRole('heading', { name: 'Workshop Pick Queue', exact: true }),
    ).toBeVisible();

    const searchInput = page.getByPlaceholder('Search pick queue...');
    await searchInput.fill(seededOrder.orderNumber);

    await corePage.openRowDetails(seededOrder.orderNumber);

    await expect(page.getByRole('heading', { name: 'Pick Parts', exact: true })).toBeVisible();
    await expect(
      page
        .locator('[data-pick-drawer-header="true"]')
        .getByRole('button', { name: 'Confirm Pick', exact: true }),
    ).toBeVisible();
  });
});

test.describe('Workshop Pick Queue — Blueprint Validation (mocked)', () => {
  test('should prefill required quantities and restore defaults via Pick All', async ({ page }) => {
    const { mockedOrder } = await mockPickQueueBaseRoutes(page);

    await page.route(
      new RegExp(`.*/api/workshop/orders/${mockedOrder.id}/pick-parts(\\?.*)?$`),
      async (route) => {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: mockedOrder.id,
            stagingLocationId: 'loc-tote-001',
            transferGroupId: 'WO-PICK-MOCK-1',
            movedLines: [
              {
                workshopTaskLineItemId: 'line-1',
                movedQuantity: 2,
                allocations: [
                  {
                    sourceLocationId: 'loc-bin-001',
                    quantity: 2,
                    referenceId: 'WO-PICK-MOCK-1:line-1:1',
                  },
                ],
              },
            ],
          }),
        });
      },
    );

    await page.goto('/workshop/pick-list');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('cell', { name: mockedOrder.order_number }).first()).toBeVisible();
    await page.getByRole('cell', { name: mockedOrder.order_number }).first().click();

    const quantityInput = page.getByLabel('Quantity for Oil Filter (06J-115-403-Q)');
    await expect(quantityInput).toHaveValue('2');

    await quantityInput.fill('1');
    await page.getByRole('button', { name: 'Pick All', exact: true }).click();
    await expect(quantityInput).toHaveValue('2');

    await expect(
      page
        .locator('[data-pick-drawer-header="true"]')
        .getByRole('button', { name: 'Confirm Pick', exact: true }),
    ).toBeVisible();
  });

  test('should handle 409 conflict with refetch and submit normalized payload on retry', async ({ page }) => {
    const { mockedOrder } = await mockPickQueueBaseRoutes(page);

    let requestCount = 0;
    const requestBodies: Array<Record<string, unknown>> = [];

    await page.route(
      new RegExp(`.*/api/workshop/orders/${mockedOrder.id}/pick-parts(\\?.*)?$`),
      async (route) => {
        requestCount += 1;
        requestBodies.push(JSON.parse(route.request().postData() ?? '{}'));

        if (requestCount === 1) {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Conflict while picking parts' }),
          });
          return;
        }

        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: mockedOrder.id,
            stagingLocationId: 'loc-tote-001',
            transferGroupId: 'WO-PICK-MOCK-RETRY',
            movedLines: [
              {
                workshopTaskLineItemId: 'line-1',
                movedQuantity: 2,
                allocations: [
                  {
                    sourceLocationId: 'loc-bin-001',
                    quantity: 2,
                    referenceId: 'WO-PICK-MOCK-RETRY:line-1:1',
                  },
                ],
              },
            ],
          }),
        });
      },
    );

    await page.goto('/workshop/pick-list');
    await page.waitForLoadState('networkidle');

    await page.getByRole('cell', { name: mockedOrder.order_number }).first().click();

    await page.getByRole('dialog', { name: 'Pick Parts' }).locator('[role="combobox"]').click();
    await page.getByRole('option', { name: /TOTE-001 - Staging Tote 001/i }).click();

    const confirmPickButton = page
      .locator('[data-pick-drawer-header="true"]')
      .getByRole('button', { name: 'Confirm Pick', exact: true });

    await confirmPickButton.click();
    await expect(
      page.getByText('This order was updated by another user. Data was refreshed.'),
    ).toBeVisible();

    // Keep the user-entered values after conflict for correction/retry.
    await expect(page.getByLabel('Quantity for Oil Filter (06J-115-403-Q)')).toHaveValue('2');

    await confirmPickButton.click();
    await expect(page.getByText('Parts picked and staged successfully.')).toBeVisible();

    await expect(requestCount).toBe(2);
    expect(requestBodies[0]).toEqual({
      destinationLocationId: 'loc-tote-001',
      items: [{ workshopTaskLineItemId: 'line-1', quantity: 2 }],
    });
    expect(requestBodies[1]).toEqual({
      destinationLocationId: 'loc-tote-001',
      items: [{ workshopTaskLineItemId: 'line-1', quantity: 2 }],
    });
  });

  test('should disable confirm action while mutation is pending to prevent duplicate submits', async ({
    page,
  }) => {
    const { mockedOrder } = await mockPickQueueBaseRoutes(page);
    let requestCount = 0;

    await page.route(
      new RegExp(`.*/api/workshop/orders/${mockedOrder.id}/pick-parts(\\?.*)?$`),
      async (route) => {
        requestCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: mockedOrder.id,
            stagingLocationId: 'loc-tote-001',
            transferGroupId: 'WO-PICK-MOCK-PENDING',
            movedLines: [],
          }),
        });
      },
    );

    await page.goto('/workshop/pick-list');
    await page.waitForLoadState('networkidle');

    await page.getByRole('cell', { name: mockedOrder.order_number }).first().click();
    await page.getByRole('dialog', { name: 'Pick Parts' }).locator('[role="combobox"]').click();
    await page.getByRole('option', { name: /TOTE-001 - Staging Tote 001/i }).click();

    const confirmPickButton = page
      .locator('[data-pick-drawer-header="true"]')
      .getByRole('button', { name: 'Confirm Pick', exact: true });

    await confirmPickButton.click();
    await expect(confirmPickButton).toBeDisabled();

    await expect(page.getByText('Parts picked and staged successfully.')).toBeVisible();
    expect(requestCount).toBe(1);
  });
});
