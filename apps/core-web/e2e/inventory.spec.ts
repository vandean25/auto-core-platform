import { test, expect, type Page } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { DE_INVENTORY } from './helpers/de-inventory';
import { DE_COMMON } from './helpers/de-common';
import { mockCursorList, requestedBlocks } from './utils/cursor-list-mock';
import { createMockInventoryItem, createMockListResponse } from './utils/mock-factories';
import { pageOverflow } from './utils/phone-layout';

const RUN_SEEDED_SMOKE_TESTS = process.env.E2E_LIVE_BACKEND === 'true';

/**
 * Inventory — Smoke Tests (seed-based)
 *
 * These tests rely on the live database seed being present.  They are intentionally
 * lightweight: they verify the page loads and the known seed SKU is visible.
 * They do NOT validate Golden Rules — see the Blueprint suite in core-workflows.spec.ts.
 *
 * Run these against a fully seeded environment to catch regressions in the
 * real data flow.
 */
test.describe('Inventory — Smoke Tests (seed-based)', () => {
  test.skip(
    !RUN_SEEDED_SMOKE_TESTS,
    'Seed-based smoke tests require E2E_LIVE_BACKEND=true and a seeded backend.',
  );

  const SEED_SKU = '06J-115-403-Q';

  test('should display inventory list and open item details sheet', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Artikel');
    await corePage.navigate('/inventory');

    await expect(page.getByRole('heading', { name: DE_INVENTORY.partsList.title })).toBeVisible();
    await expect(page.getByRole('cell', { name: SEED_SKU }).first()).toBeVisible();

    // Use the POM row-click helper — validates the Golden Rule data attribute too
    await corePage.openRowDetails(SEED_SKU);
  });

  test('should allow searching for parts by SKU', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Artikel');
    await corePage.navigate('/inventory');

    const searchInput = page.getByPlaceholder(DE_INVENTORY.partsList.searchPlaceholder);
    await searchInput.fill(SEED_SKU);

    await expect(page.getByRole('cell', { name: SEED_SKU }).first()).toBeVisible();
  });
});

/**
 * Inventory — Blueprint Validation (mocked, deterministic)
 *
 * These tests mock the API so they run reliably in any environment.
 * They validate Golden Rules and resilience behaviours.
 */
test.describe('Inventory — Blueprint Validation (mocked)', () => {
  test('should not crash when the Brands API returns malformed data', async ({ page }) => {
    // Mock first, then navigate (network isolation)
    // Mock /api/inventory so this test does NOT depend on the real backend
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      });
    });
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    // Mock /api/brands with deliberately malformed data — the resilience target
    await page.route(AutoCorePage.apiRouteMatcher('/api/brands'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: 'this-should-be-an-array-but-is-a-string' }),
      });
    });

    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');

    // The page MUST NOT crash or go blank
    await expect(page.getByPlaceholder(DE_INVENTORY.partsList.searchPlaceholder)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('should render mocked inventory items using data-table-row attributes', async ({
    page,
  }) => {
    const item = createMockInventoryItem({ sku: 'MOCK-SKU-001', name: 'Mock Oil Filter' });

    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([item])),
      });
    });
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    const corePage = new AutoCorePage(page, 'Artikel');
    await corePage.navigate('/inventory');

    // Golden Rule 2: rows carry the data-table-row attribute
    const row = page.locator('[data-table-row="true"]').filter({ hasText: 'MOCK-SKU-001' });
    await expect(row).toBeVisible();
  });
});

/**
 * Infinite-scroll pilot (AUT-890, ADR-0035): the parts list scrolls in blocks of 50 on the cursor sorts (sku, name,
 * price), shows a capped match count and stops at 2,000 loaded rows. Demo data only, every API response is mocked.
 */
test.describe('Inventory — infinite list (AUT-890)', () => {
  const items = (length: number) =>
    Array.from({ length }, (_, index) => {
      const number = String(index).padStart(4, '0');
      return createMockInventoryItem({ id: `item-${number}`, sku: `SKU-${number}`, name: `Bremsscheibe ${number}` });
    });

  async function openParts(page: Page, path: string, options: Partial<Parameters<typeof mockCursorList>[1]> = {}) {
    const requests = await mockCursorList(page, { path: '/api/inventory', rows: items(120), ...options });
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await new AutoCorePage(page, 'Artikel').navigate(path);
    await expect(page.getByRole('heading', { name: DE_INVENTORY.partsList.title })).toBeVisible();
    return requests;
  }

  test('AUT-946: WHEN the count is visible before page one THEN parts rows are not lasting skeleton placeholders', async ({
    page,
  }) => {
    const rows = items(9);
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/capped-count'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 9, isCapped: false }),
      });
    });
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory'), async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('pagination') !== 'cursor') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockListResponse(rows)),
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: rows,
          meta: { nextCursor: null, hasNextPage: false },
        }),
      });
    });
    await new AutoCorePage(page, 'Artikel').navigate('/inventory?sortField=sku&sortDirection=asc');
    await expect(page.getByTestId('data-table-count')).toHaveText('9 Treffer');
    await expect(page.locator('tbody .animate-pulse')).toHaveCount(0, { timeout: 350 });
    await expect(page.getByText('SKU-0000')).toBeVisible({ timeout: 5_000 });
  });

  // Scenario 2: the count is capped at 1,000 and says so; it follows the search, not the sort.
  test('WHEN a parts search matches more than 1,000 items THEN the counter shows "1.000+"', async ({ page }) => {
    const requests = await openParts(page, '/inventory?search=bremse', { count: { count: 1000, isCapped: true } });

    await expect(page.getByTestId('data-table-count')).toHaveText('1.000+ Treffer');
    expect(Object.fromEntries(requests.count[0].searchParams)).toEqual({ search: 'bremse' });
    expect(requests.list[0].searchParams.get('search')).toBe('bremse');
  });

  // Scenario 3: an old page link must not open "page 3" of a list that has no pages.
  test('WHEN an old ?page=3 link is opened THEN the list starts at the top with search, filter and sort kept', async ({ page }) => {
    const requests = await openParts(page, '/inventory?page=3&search=bremse&sortField=name&sortDirection=desc');

    await expect(page.getByText('SKU-0000')).toBeVisible();
    expect(Object.fromEntries(requests.list[0].searchParams)).toEqual({
      pagination: 'cursor',
      limit: '50',
      search: 'bremse',
      sortField: 'name',
      sortDirection: 'desc',
    });
    await expect(page).toHaveURL((url) => {
      const { searchParams } = url;
      return !searchParams.has('page') && searchParams.get('search') === 'bremse' && searchParams.get('sortField') === 'name' && searchParams.get('sortDirection') === 'desc';
    });
    const region = page.getByRole('region', { name: DE_COMMON.dataTable.scrollRegion });
    expect(await region.evaluate((element) => element.scrollTop)).toBe(0);
  });

  // The 2,000-row stop: 40 blocks load, then loading ends with "Filter verfeinern" although the API has more.
  test('WHEN 2,000 rows are loaded THEN no further block is requested and the list asks to refine the filter', async ({ page }) => {
    const requests = await openParts(page, '/inventory', { rows: items(2100), count: { count: 1000, isCapped: true } });
    const loadMore = page.getByRole('button', { name: DE_COMMON.dataTable.infinite.loadMore });

    for (let block = 1; block < 40; block += 1) {
      await expect(loadMore).toBeEnabled();
      await loadMore.click();
      await expect.poll(() => requestedBlocks(requests).size).toBe(block + 1);
    }

    await expect(page.getByText(/Es werden höchstens 2\.000 Zeilen geladen/)).toBeVisible();
    await expect(loadMore).toHaveCount(0);
    const blocks = requestedBlocks(requests);
    expect(blocks.size).toBe(40);
    expect(blocks.has('offset:1950')).toBe(true);
    expect(blocks.has('offset:2000')).toBe(false);
  });

  // Pilot check "Bedienung": empty, error-with-retry and keyboard-only loading, on top of the loaded state above.
  test('WHEN the search matches nothing THEN the table shows the empty state and a count of 0', async ({ page }) => {
    await openParts(page, '/inventory?search=nichts', { rows: [] });

    await expect(page.getByText(DE_COMMON.dataTable.noResults)).toBeVisible();
    await expect(page.getByTestId('data-table-count')).toHaveText('0 Treffer');
  });

  test('WHEN the first block fails THEN the table shows the error with a retry that loads the rows', async ({ page }) => {
    const requests = await mockCursorList(page, { path: '/api/inventory', rows: items(120) });
    requests.failList = true;
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await new AutoCorePage(page, 'Artikel').navigate('/inventory');

    const retry = page.getByRole('button', { name: DE_COMMON.dataTable.loading.retry });
    await expect(page.getByText(DE_COMMON.dataTable.loading.loadFailed)).toBeVisible();
    await expect(page.getByText('SKU-0000')).toHaveCount(0);

    requests.failList = false;
    await retry.click();
    await expect(page.getByText('SKU-0000')).toBeVisible();
  });

  test('WHEN a keyboard user activates "Weitere laden" THEN the next block loads without a pointer', async ({ page }) => {
    const requests = await openParts(page, '/inventory');
    await expect(page.getByText('SKU-0000')).toBeVisible();

    await page.getByRole('button', { name: DE_COMMON.dataTable.infinite.loadMore }).focus();
    await page.keyboard.press('Enter');

    await expect.poll(() => requestedBlocks(requests).has('offset:50')).toBe(true);
  });

  // ADR-0035 §5: a failing count never blocks the rows.
  test('WHEN only the count request fails THEN the rows stay and "Anzahl nicht verfügbar" offers a retry', async ({ page }) => {
    await openParts(page, '/inventory', { failCount: true });

    await expect(page.getByText('SKU-0000')).toBeVisible();
    await expect(page.getByText(DE_COMMON.dataTable.infinite.countUnavailable)).toBeVisible();
    await expect(page.getByRole('button', { name: DE_COMMON.dataTable.loading.retry })).toBeVisible();
  });
});

/**
 * Multi-select on the parts list (AUT-886, ADR-0035 §8). Demo data only, every API response is mocked. The mock serves
 * the list and its count, so these specs prove the selection UI, not server authorization (see the unit and backend specs).
 */
test.describe('Inventory — multi-select (AUT-886)', () => {
  const items = Array.from({ length: 120 }, (_, index) => {
    const number = String(index).padStart(4, '0');
    return createMockInventoryItem({ id: `item-${number}`, sku: `SKU-${number}`, name: `Bremsscheibe ${number}` });
  });
  const selectRow = DE_COMMON.dataTable.selectRow;
  const selectedCount = (count: number) => `${count} ausgewählt`;

  async function openParts(page: Page) {
    await mockCursorList(page, { path: '/api/inventory', rows: items });
    await page.route(AutoCorePage.apiRouteMatcher('/api/inventory/locations'), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await new AutoCorePage(page, 'Artikel').navigate('/inventory');
    await expect(page.getByRole('heading', { name: DE_INVENTORY.partsList.title })).toBeVisible();
  }

  test('WHEN a row is clicked and another shift-clicked THEN all rows in between are selected', async ({ page }) => {
    await openParts(page);
    const row = (sku: string) => page.locator('tr[data-table-row="true"]').filter({ hasText: sku });

    await row('SKU-0001').getByRole('checkbox', { name: selectRow }).click();
    await row('SKU-0004').getByRole('checkbox', { name: selectRow }).click({ modifiers: ['Shift'] });

    const toolbar = page.getByRole('toolbar', { name: DE_COMMON.dataTable.actionBar.label });
    await expect(toolbar).toContainText(selectedCount(4));
    for (const sku of ['SKU-0001', 'SKU-0002', 'SKU-0003', 'SKU-0004']) {
      await expect(row(sku)).toHaveAttribute('data-state', 'selected');
    }
    await expect(row('SKU-0005')).not.toHaveAttribute('data-state', 'selected');
    // "Select all loaded" names the loaded rows (one block of 50), never the whole result.
    await expect(toolbar.getByRole('button', { name: 'Alle geladenen auswählen (50)' })).toBeVisible();
  });

  test.describe('at 375px', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('WHEN the viewport is 375px THEN rows are selectable through a visible 44px control without long-press', async ({ page }) => {
      await openParts(page);

      const cards = page.locator('li[data-table-row="true"]');
      await expect(cards.first()).toBeVisible();
      const control = cards.first().locator('label').filter({ has: page.getByRole('checkbox', { name: selectRow }) });
      const box = await control.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

      await control.click();
      const toolbar = page.getByRole('toolbar', { name: DE_COMMON.dataTable.actionBar.label });
      await expect(toolbar).toContainText(selectedCount(1));

      const selectAll = toolbar.getByRole('button', { name: 'Alle geladenen auswählen (50)' });
      expect((await selectAll.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect((await toolbar.getByRole('button', { name: DE_COMMON.dataTable.actionBar.clear }).boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(44);
      await selectAll.click();
      await expect(toolbar).toContainText(selectedCount(50));
      expect(await pageOverflow(page)).toBe(0);
    });
  });
});
