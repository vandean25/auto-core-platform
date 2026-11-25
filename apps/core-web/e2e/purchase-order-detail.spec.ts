import { test, expect } from "@playwright/test";
import { DE_STATUS } from "./helpers/de-enums";
import { DE_FINANCE } from "./helpers/de-finance";
import { AutoCorePage } from "./pom/AutoCorePage";
import { expectNoPageScroll, PHONE_WIDTHS } from "./utils/phone-layout";
import {
  createMockPurchaseOrder,
  createMockVendor,
  createMockInventoryItem,
  createMockListResponse,
} from "./utils/mock-factories";

test('AUT-1037: mobile purchase-order cards show the number, vendor and status', async ({ page }, testInfo) => {
  const vendor = createMockVendor({ name: 'Nordteile' });
  const order = createMockPurchaseOrder({ order_number: 'PO-2026-7049', status: 'PARTIAL', vendor });
  await page.route(AutoCorePage.apiRouteMatcher('/api/purchase-orders'), (route) =>
    route.fulfill({ json: createMockListResponse([order]) }),
  );

  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/purchase-orders');
    const card = page.locator('li[data-table-row="true"]').filter({ hasText: order.order_number });
    const number = card.getByText(order.order_number, { exact: true });
    await expect(number).toBeInViewport({ ratio: 1 });
    await expect(card.getByText(vendor.name, { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(card.getByText(DE_STATUS.PARTIAL, { exact: true })).toBeInViewport({ ratio: 1 });
    await expectNoPageScroll(page);
    await testInfo.attach(`purchase-order-status-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
});

/**
 * Blueprint: Purchase Order Detail
 *
 * E2E tests for the Purchase Order detail view.
 * Ensures the page aligns with the UI/UX architecture:
 * - Proper header structure.
 * - Accurate line item mocking with quantity_available.
 * - Proper status transition modeling.
 */
test.describe("Blueprint: Purchase Order Detail", () => {
  const PO_ID = "po-blueprint-123";
  const VENDOR_ID = "vendor-mock-123";
  const MOCK_AVAILABLE_QUANTITY = 25;

  test("Purchase Order Detail - rendering and items", async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_FINANCE.purchaseOrders.list.create);

    const mockVendor = createMockVendor({
      id: VENDOR_ID,
      name: "Nordstern Ersatzteile GmbH",
    });
    const mockPO = createMockPurchaseOrder({
      id: PO_ID,
      order_number: "PO-2026-0001",
      status: "DRAFT",
      vendor_id: VENDOR_ID,
      vendor: mockVendor,
      items: [
        {
          id: "item-1",
          catalog_item_id: "cat-1",
          quantity: 10,
          quantity_received: 0,
          unit_cost: 15.0,
          catalog_item: {
            sku: "TEST-SKU-1",
            name: "Test Part",
          },
        },
      ],
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}`),
      async (route) => {
        if (route.request().method() === "PATCH") {
          const body = JSON.parse(route.request().postData() || "{}");
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ...mockPO, ...body }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(mockPO),
          });
        }
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher("/api/vendors"),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(createMockListResponse([mockVendor])),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher("/api/inventory"),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            createMockListResponse([
              createMockInventoryItem({
                quantity_available: MOCK_AVAILABLE_QUANTITY,
              }),
            ]),
          ),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(
        `/api/vendors/${VENDOR_ID}/unbilled-receipts`,
      ),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    await corePage.navigate(`/purchase-orders/${PO_ID}`);

    await expect(
      page.getByRole("heading", { name: "PO-2026-0001", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        DE_FINANCE.shared.vendorLabel.replace('{{name}}', 'Nordstern Ersatzteile GmbH'),
      ),
    ).toBeVisible();
    await expect(page.getByText(DE_STATUS.DRAFT, { exact: true })).toBeVisible();

    // exact: the row's delete action is named "Delete item TEST-SKU-1 Test Part" (AUT-471), so substring matches on either value also resolve to the actions cell.
    await expect(page.getByRole("cell", { name: "TEST-SKU-1", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Test Part", exact: true })).toBeVisible();
  });

  test("Purchase Order Detail - status workflow: Mark as Sent", async ({
    page,
  }) => {
    const corePage = new AutoCorePage(page, DE_FINANCE.purchaseOrders.list.create);
    const mockVendor = createMockVendor({
      id: VENDOR_ID,
      name: "Nordstern Ersatzteile GmbH",
    });
    let currentPO = createMockPurchaseOrder({
      id: PO_ID,
      order_number: "PO-2026-0001",
      status: "DRAFT",
      vendor_id: VENDOR_ID,
      vendor: mockVendor,
      items: [],
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}`),
      async (route) => {
        if (route.request().method() === "PATCH") {
          const body = JSON.parse(route.request().postData() || "{}");
          currentPO = { ...currentPO, ...body };
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentPO),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(currentPO),
          });
        }
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}/mark-as-sent`),
      async (route) => {
        currentPO = {
          ...currentPO,
          status: "SENT",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(currentPO),
        });
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher("/api/vendors"),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(createMockListResponse([mockVendor])),
        });
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher("/api/inventory"),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(createMockListResponse([])),
        });
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher(
        `/api/vendors/${VENDOR_ID}/unbilled-receipts`,
      ),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    await corePage.navigate(`/purchase-orders/${PO_ID}`);

    const sendButton = page.getByRole("button", {
      name: DE_FINANCE.actions.markAsSent,
    });
    await expect(sendButton).toBeVisible();
    await sendButton.click();
    await expect(page.getByText(DE_STATUS.SENT, { exact: true })).toBeVisible();
  });

  test.fixme("Purchase Order Detail - auto-save on field change", async ({
    page,
  }) => {
    const corePage = new AutoCorePage(page, DE_FINANCE.purchaseOrders.list.create);
    const mockVendor = createMockVendor({
      id: VENDOR_ID,
      name: "Nordstern Ersatzteile GmbH",
    });
    const mockPO = createMockPurchaseOrder({
      id: PO_ID,
      order_number: "PO-2026-0001",
      status: "DRAFT",
      vendor_id: VENDOR_ID,
      vendor: mockVendor,
      items: [],
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}`),
      async (route) => {
        if (route.request().method() === "PATCH") {
          const body = JSON.parse(route.request().postData() || "{}");
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ...mockPO, ...body }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(mockPO),
          });
        }
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher("/api/vendors"),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(createMockListResponse([mockVendor])),
        });
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher("/api/inventory"),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(createMockListResponse([])),
        });
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher(
        `/api/vendors/${VENDOR_ID}/unbilled-receipts`,
      ),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    await corePage.navigate(`/purchase-orders/${PO_ID}`);

    const notesInput = page.getByLabel(/Notes/i);
    await expect(notesInput).toBeVisible();
    const autoSavePromise = corePage.waitForAutoSave("/api/purchase-orders");
    await notesInput.fill("Updated notes");
    await autoSavePromise;
    await expect(notesInput).toHaveValue("Updated notes");
  });

  // AUT-659 scenario 5: the purchase order header (PageHeader migration) keeps the phone layout.
  test("WHEN the purchase order detail opens at 375px THEN there is no horizontal scroll and targets are at least 44px", async ({ page }) => {
    const mockVendor = createMockVendor({ id: VENDOR_ID, name: "Nordstern Ersatzteile GmbH" });
    const mockPO = createMockPurchaseOrder({
      id: PO_ID,
      order_number: "PO-2026-0002",
      status: "DRAFT",
      vendor_id: VENDOR_ID,
      vendor: mockVendor,
      items: [],
    });
    const json = (body: unknown) => async (route: import("@playwright/test").Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    };
    await page.route(AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}`), json(mockPO));
    await page.route(AutoCorePage.apiRouteMatcher("/api/vendors"), json(createMockListResponse([mockVendor])));
    await page.route(AutoCorePage.apiRouteMatcher("/api/inventory"), json(createMockListResponse([createMockInventoryItem()])));
    await page.route(AutoCorePage.apiRouteMatcher(`/api/vendors/${VENDOR_ID}/unbilled-receipts`), json([]));

    await page.setViewportSize({ width: 375, height: 844 });
    await page.goto(`/purchase-orders/${PO_ID}`);
    await expect(page.getByRole("heading", { name: "PO-2026-0002", exact: true })).toBeVisible();

    for (const name of [DE_FINANCE.actions.markAsSent, DE_FINANCE.actions.receiveGoods]) {
      const box = (await page.getByRole("button", { name }).first().boundingBox())!;
      expect(box.x + box.width, name).toBeLessThanOrEqual(375);
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    await expectNoPageScroll(page);
  });

  // AUT-964 scenario 4: PO receive updates confirmed quantities and shows a success toast.
  test("WHEN a remaining quantity is received on a SENT/PARTIAL purchase order THEN the confirmed quantities appear and a success toast is shown", async ({
    page,
  }) => {
    const corePage = new AutoCorePage(page, DE_FINANCE.purchaseOrders.list.create);
    const mockVendor = createMockVendor({
      id: VENDOR_ID,
      name: "Nordstern Ersatzteile GmbH",
    });
    let currentPO = createMockPurchaseOrder({
      id: PO_ID,
      order_number: "PO-2026-0003",
      status: "PARTIAL",
      vendor_id: VENDOR_ID,
      vendor: mockVendor,
      items: [
        {
          id: "item-1",
          catalog_item_id: "cat-1",
          quantity: 10,
          quantity_received: 4,
          unit_cost: 15.0,
          catalog_item: {
            sku: "TEST-SKU-1",
            name: "Test Part",
          },
        },
      ],
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(currentPO),
        });
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/purchase-orders/${PO_ID}/receive`),
      async (route) => {
        currentPO = {
          ...currentPO,
          status: "COMPLETED",
          items: [{ ...currentPO.items[0], quantity_received: 10 }],
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(currentPO),
        });
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher("/api/vendors"),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(createMockListResponse([mockVendor])),
        });
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher("/api/inventory"),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(createMockListResponse([])),
        });
      },
    );
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/vendors/${VENDOR_ID}/unbilled-receipts`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    await corePage.navigate(`/purchase-orders/${PO_ID}`);
    await expect(page.getByRole("heading", { name: "PO-2026-0003", exact: true })).toBeVisible();

    await page.getByRole("button", { name: DE_FINANCE.actions.receiveGoods }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("spinbutton").fill("6");
    await dialog.getByRole("button", { name: DE_FINANCE.actions.confirmReceipt }).click();

    await expect(page.getByText(DE_FINANCE.purchaseOrders.detail.toast.received)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(DE_STATUS.COMPLETED, { exact: true })).toBeVisible();
    const row = page.locator("tbody tr").first();
    await expect(row.locator("td").nth(3)).toHaveText("10");
    await expect(row.locator("td").nth(4)).toHaveText("0");
  });
});
