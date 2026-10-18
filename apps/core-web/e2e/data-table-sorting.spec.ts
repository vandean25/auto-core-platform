import { expect, test, type Page, type Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AutoCorePage } from './pom/AutoCorePage';
import { DE_COMMON } from './helpers/de-common';
import { DE_INVENTORY } from './helpers/de-inventory';
import { DE_WORKSHOP } from './helpers/de-workshop';
import {
  createMockInventoryItem,
  createMockListResponse,
  createMockWorkshopOrder,
} from './utils/mock-factories';

/**
 * DataTable column picker and click-to-sort (AUT-476).
 *
 * Demo data only: every list response is mocked so the spec is deterministic without a backend.
 */

async function mockInventory(page: Page) {
  const items = [
    createMockInventoryItem({ id: 'item-1', sku: 'AAA-100', name: 'Brake pad', price: 45 }),
    createMockInventoryItem({ id: 'item-2', sku: 'ZZZ-900', name: 'Air filter', price: 12 }),
  ];
  await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
  await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockListResponse(items)),
    });
  });
}

async function mockWorkshopOrders(page: Page) {
  const orders = [
    createMockWorkshopOrder({ id: 'ws-1', order_number: 'WO-2026-0001' }),
    createMockWorkshopOrder({ id: 'ws-2', order_number: 'WO-2026-0002' }),
  ];
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/orders'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockListResponse(orders)),
    });
  });
}

function sortRequest(path: string, sortField: string, sortDirection: 'asc' | 'desc') {
  return (request: Request) => {
    const url = new URL(request.url());
    return (
      url.pathname === path &&
      url.searchParams.get('sortField') === sortField &&
      url.searchParams.get('sortDirection') === sortDirection
    );
  };
}

async function expectNoAxeViolations(page: Page, selectors: string[]) {
  let builder = new AxeBuilder({ page });
  for (const selector of selectors) {
    builder = builder.include(selector);
  }
  const { violations } = await builder.analyze();
  expect(
    violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

test.describe('Inventory — DataTable column picker and sorting', () => {
  test('lists readable column labels and Show all brings back a hidden column', async ({ page }) => {
    await mockInventory(page);
    const corePage = new AutoCorePage(page, 'Artikel');
    await corePage.navigate('/inventory');
    await expect(corePage.dataTable).toBeVisible();

    await page.getByRole('button', { name: DE_COMMON.dataTable.columns, exact: true }).click();
    await expect(
      page.getByRole('menuitemcheckbox', { name: DE_INVENTORY.partsList.columns.part }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitemcheckbox', { name: DE_INVENTORY.partsList.columns.storageLocation }),
    ).toBeVisible();
    await expectNoAxeViolations(page, ['[role="menu"]']);

    await page.getByRole('menuitemcheckbox', { name: DE_INVENTORY.partsList.columns.storageLocation }).click();
    await page.getByRole('menuitem', { name: DE_COMMON.dataTable.showAll }).click();
    await page.keyboard.press('Escape');

    await expect(
      page.getByRole('columnheader', { name: DE_INVENTORY.partsList.columns.storageLocation }),
    ).toBeVisible();
    await expectNoAxeViolations(page, ['table']);
  });

  test('one click sorts ascending, the next descending, and the third clears', async ({ page }) => {
    await mockInventory(page);
    const corePage = new AutoCorePage(page, 'Artikel');
    await corePage.navigate('/inventory');
    await expect(corePage.dataTable).toBeVisible();

    const partLabel = DE_INVENTORY.partsList.columns.part;
    const header = page.getByRole('columnheader', { name: new RegExp(`^${partLabel}`) });
    const sortButton = page.getByRole('button', { name: partLabel, exact: true });
    await expect(header).toHaveAttribute('aria-sort', 'none');

    let sortedRequest = page.waitForRequest(sortRequest('/api/inventory', 'sku', 'asc'));
    await sortButton.click();
    await sortedRequest;
    await expect(header).toHaveAttribute('aria-sort', 'ascending');

    sortedRequest = page.waitForRequest(sortRequest('/api/inventory', 'sku', 'desc'));
    await sortButton.click();
    await sortedRequest;
    await expect(header).toHaveAttribute('aria-sort', 'descending');

    await sortButton.click();
    await expect(header).toHaveAttribute('aria-sort', 'none');
  });

  test('the Columns picker stays on screen at narrow, tablet and desktop widths', async ({ page }) => {
    await mockInventory(page);
    const corePage = new AutoCorePage(page, 'Artikel');
    await corePage.navigate('/inventory');

    const trigger = page.getByRole('button', { name: DE_COMMON.dataTable.columns, exact: true });
    for (const width of [640, 768, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(trigger).toBeVisible();
      const box = await trigger.boundingBox();
      expect(box, `Columns trigger has a box at ${width}px`).not.toBeNull();
      expect(box!.x + box!.width, `Columns trigger fits at ${width}px`).toBeLessThanOrEqual(width);
    }
  });
});

test.describe('Workshop orders — DataTable click-to-sort', () => {
  test('sorting by Order No. updates aria-sort and the request, and is axe clean', async ({ page }) => {
    await mockWorkshopOrders(page);
    const corePage = new AutoCorePage(page, DE_WORKSHOP.orders.list.newOrder);
    await corePage.navigate('/workshop/orders');
    await expect(corePage.dataTable).toBeVisible();

    const orderNoLabel = DE_WORKSHOP.orders.list.orderNo;
    const header = page.getByRole('columnheader', { name: new RegExp(`^${orderNoLabel}`) });
    const sortButton = page.getByRole('button', { name: orderNoLabel, exact: true });
    await expect(header).toHaveAttribute('aria-sort', 'none');

    let sortedRequest = page.waitForRequest(sortRequest('/api/workshop/orders', 'orderNo', 'asc'));
    await sortButton.click();
    await sortedRequest;
    await expect(header).toHaveAttribute('aria-sort', 'ascending');

    sortedRequest = page.waitForRequest(sortRequest('/api/workshop/orders', 'orderNo', 'desc'));
    await sortButton.click();
    await sortedRequest;
    await expect(header).toHaveAttribute('aria-sort', 'descending');

    await expectNoAxeViolations(page, ['table']);
  });
});
