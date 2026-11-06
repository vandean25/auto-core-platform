import { test, expect, type Page } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockListResponse, createMockVehicleStockRow } from './utils/mock-factories';
import { DE_VEHICLE_STOCK } from './helpers/de-vehicle-stock';
import { DE_COMMON } from './helpers/de-common';
import { mockCursorList, requestedBlocks } from './utils/cursor-list-mock';
import { pageOverflow } from './utils/phone-layout';

/**
 * Blueprint Validation Suite — Vehicle Stock Module
 */
test.describe('Blueprint: Vehicle Stock Module', () => {
  test('list page renders and follows golden rules', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_VEHICLE_STOCK.stockList.addVehicle);
    const stockRow = createMockVehicleStockRow();

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicle-stock'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([stockRow])),
      });
    });

    await corePage.navigate('/vehicle-stock');

    await corePage.verifyHeaderConsistency(DE_VEHICLE_STOCK.stockList.title);
    await expect(corePage.dataTable).toBeVisible();
    await corePage.openRowDetails('Volkswagen Golf');
    await expect(page).toHaveURL(new RegExp(`/vehicle-stock/${stockRow.id}`));
  });

  test('draft purchase rows open the purchase page and expose Delete', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_VEHICLE_STOCK.stockList.addVehicle);
    const draftRow = createMockVehicleStockRow({
      id: 'draft-purchase-123',
      make: 'Audi',
      model: 'A4',
      vin: 'WAUZZZ8K8DA000002',
      plate: null,
      stock_status: 'ON_ORDER',
      draft_purchase_id: 'draft-purchase-123',
    });
    const stockRow = createMockVehicleStockRow();

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicle-stock'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([draftRow, stockRow])),
      });
    });

    await corePage.navigate('/vehicle-stock');

    const draftTableRow = page.locator('[data-table-row="true"]').filter({ hasText: 'Audi A4' }).first();
    await draftTableRow.click({ button: 'right' });
    await expect(page.getByRole('button', { name: DE_VEHICLE_STOCK.shared.delete })).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    const deleteRequest = page.waitForRequest(
      (req) =>
        req.method() === 'DELETE' &&
        req.url().includes('/api/vehicle-purchases/draft-purchase-123'),
    );
    await page.route(
      AutoCorePage.apiRouteMatcher('/api/vehicle-purchases/draft-purchase-123'),
      async (route) => {
        if (route.request().method() === 'DELETE') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'draft-purchase-123' }) });
        }
        return route.fallback();
      },
    );
    await page.getByRole('button', { name: DE_VEHICLE_STOCK.shared.delete }).click();
    await deleteRequest;

    const stockTableRow = page.locator('[data-table-row="true"]').filter({ hasText: 'Volkswagen Golf' }).first();
    await stockTableRow.click({ button: 'right' });
    await expect(page.getByRole('button', { name: DE_VEHICLE_STOCK.shared.delete })).toHaveCount(0);

    await corePage.openRowDetails('Audi A4');
    await expect(page).toHaveURL(/\/vehicle-stock\/purchases\/draft-purchase-123/);
  });
});

/**
 * Infinite-scroll pilot (AUT-890, ADR-0035): dealer stock with a draft-free status scrolls in blocks of 50 (cap 2,000);
 * "all statuses" merges the draft purchases in and keeps its pages. Demo data only, every API response is mocked.
 */
test.describe('Vehicle stock — infinite list (AUT-890)', () => {
  const stockRows = Array.from({ length: 120 }, (_, index) => {
    const number = String(index).padStart(3, '0');
    return createMockVehicleStockRow({
      id: `stock-${number}`,
      make: `Marke${number}`,
      // Every third model wraps on a phone, so the cards get different heights.
      model: index % 3 === 0 ? `Sportback Quattro Competition Edition Limited ${number}` : `Modell${number}`,
      vin: `VIN${number}`,
      plate: `W-${number}`,
    });
  });
  const dataTable = DE_COMMON.dataTable;
  const scrollRegion = (page: Page) => page.getByRole('region', { name: dataTable.scrollRegion });
  const pageButtons = (page: Page) => page.getByRole('button', { name: dataTable.next, exact: true });

  // Scenario 1: the next block loads from scrolling alone; page buttons are only there for the "all statuses" offset list.
  test('WHEN the vehicle list is scrolled to the end of the first block THEN the next block loads without page buttons', async ({ page }) => {
    const requests = await mockCursorList(page, { path: '/api/vehicle-stock', rows: stockRows });
    await new AutoCorePage(page, DE_VEHICLE_STOCK.stockList.addVehicle).navigate('/vehicle-stock');

    // "All statuses" includes the draft purchases, which only the offset list can merge in: pages stay.
    await expect(page.getByText('Marke000')).toBeVisible();
    await expect(pageButtons(page)).toBeVisible();
    expect(requests.list[0].searchParams.get('pagination')).toBeNull();

    await page.getByRole('combobox', { name: DE_VEHICLE_STOCK.stockList.statusFilterAria }).click();
    await page.getByRole('option', { name: 'Auf Lager' }).click();

    await expect(pageButtons(page)).toHaveCount(0);
    await expect(page.getByTestId('data-table-count')).toHaveText('120 Treffer');
    const first = requests.list.find((url) => url.searchParams.get('pagination') === 'cursor');
    expect(Object.fromEntries(first?.searchParams ?? [])).toEqual({ pagination: 'cursor', limit: '50', stock_status: 'IN_STOCK' });

    // Scrolling to the end loads block 2 (rows 50-99), then block 3 (rows 100-119) and reaches the real end of the list.
    const region = scrollRegion(page);
    await expect(async () => {
      await region.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      expect(requests.list.some((url) => url.searchParams.get('cursor') === 'offset:50')).toBe(true);
    }).toPass();
    await expect(async () => {
      await region.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      await expect(page.getByText('Marke119')).toBeVisible({ timeout: 500 });
    }).toPass();
    expect([...requestedBlocks(requests)].sort()).toEqual([null, 'offset:100', 'offset:50'].sort());
    await expect(page.getByTestId('data-table-announcement')).toHaveText('Ende der Liste, 120 Zeilen geladen.');
    await expect(pageButtons(page)).toHaveCount(0);
  });

  // Scenario 5: at 375px the list is a card list that renders only the cards near the viewport, measured per card.
  test.describe('at 375px', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('WHEN the viewport is 375px THEN the cards virtualize with variable heights and stay at least 44px tappable', async ({ page }) => {
      const requests = await mockCursorList(page, { path: '/api/vehicle-stock', rows: stockRows });
      await new AutoCorePage(page, DE_VEHICLE_STOCK.stockList.addVehicle).navigate('/vehicle-stock?filter_stock_status=IN_STOCK');

      const cards = page.locator('li[data-table-row="true"]');
      await expect(cards.first()).toBeVisible();
      await expect(page.locator('table')).toHaveCount(0);

      // 50 rows are loaded; only the cards around the viewport are in the DOM.
      const rendered = await cards.count();
      expect(rendered).toBeGreaterThan(3);
      expect(rendered).toBeLessThan(50);

      const boxes = await cards.evaluateAll((nodes) =>
        nodes.map((node) => {
          const card = node.getBoundingClientRect();
          const tap = node.querySelector('[role="button"]')?.getBoundingClientRect();
          return { cardHeight: Math.round(card.height), tapHeight: tap?.height ?? 0, tapWidth: tap?.width ?? 0 };
        }),
      );
      expect(new Set(boxes.map((box) => box.cardHeight)).size).toBeGreaterThan(1);
      for (const box of boxes) {
        expect(box.tapHeight).toBeGreaterThanOrEqual(44);
        expect(box.tapWidth).toBeGreaterThanOrEqual(44);
      }
      expect(await pageOverflow(page)).toBe(0);

      // Scrolling the page loads the next block and still renders only a window of the cards.
      await expect(async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        expect(requests.list.some((url) => url.searchParams.get('cursor') === 'offset:50')).toBe(true);
      }).toPass();
      expect(await cards.count()).toBeLessThan(50);

      const loadMore = page.getByRole('button', { name: dataTable.infinite.loadMore });
      const loadMoreBox = await loadMore.boundingBox();
      expect(loadMoreBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    });
  });
});
