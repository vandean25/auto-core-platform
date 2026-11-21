import { test, expect, type Page } from '@playwright/test';
import { UI_LANGUAGE_STORAGE_KEY } from '../src/lib/i18n/constants';
import { AutoCorePage } from './pom/AutoCorePage';
import { DE_COMMON } from './helpers/de-common';
import { DE_SALES } from './helpers/de-sales';
import { e2eCappedCountBody, e2eCursorPageBody, mockCursorList, requestedBlocks } from './utils/cursor-list-mock';
import { contentClippedByAncestor, pageOverflow } from './utils/phone-layout';

/**
 * Invoice list wave (AUT-891, ADR-0035): the number and date sorts scroll in blocks of 50 (cap 2,000); customer,
 * status and total keep the unpaged list with pages. Demo data only, every API response is mocked.
 */
test.describe('Invoice list — infinite mode (AUT-891)', () => {
  const invoiceRows = Array.from({ length: 120 }, (_, index) => {
    const number = String(index + 1).padStart(4, '0');
    return {
      id: `inv-${number}`,
      invoice_number: `RE-2026-${number}`,
      status: 'FINALIZED',
      customer_id: 'cust-1',
      // Every third customer wraps on a phone, so the cards get different heights.
      customer: {
        id: 'cust-1',
        type: 'COMPANY',
        company_name: index % 3 === 0 ? `Mustermann Handels- und Dienstleistungsgesellschaft ${number}` : `Firma ${number}`,
        first_name: 'Max',
        last_name: 'Mustermann',
      },
      date: '2026-03-01T10:00:00.000Z',
      due_date: '2026-03-15T10:00:00.000Z',
      total_net: '100.00',
      total_tax: '20.00',
      total_gross: '120.00',
      items: [],
    };
  });
  const dataTable = DE_COMMON.dataTable;
  const scrollRegion = (page: Page) => page.getByRole('region', { name: dataTable.scrollRegion });
  const pageButtons = (page: Page) => page.getByRole('button', { name: dataTable.next, exact: true });
  const openList = (page: Page, query: string) =>
    new AutoCorePage(page, DE_SALES.invoices.list.newInvoice).navigate(`/sales/invoices${query}`);

  // Scenario 1: blocks continue in number order by following the cursor, without page buttons or offset requests.
  test('WHEN invoices are sorted by number and scrolled to the end THEN every block loads in order without page buttons', async ({ page }) => {
    const requests = await mockCursorList(page, { path: '/api/sales/invoices', rows: invoiceRows, unpaged: 'array' });
    await openList(page, '?sortField=invoice_number&sortDirection=asc');

    await expect(page.getByText('RE-2026-0001')).toBeVisible();
    await expect(pageButtons(page)).toHaveCount(0);
    await expect(page.getByTestId('data-table-count')).toHaveText('120 Treffer');
    const first = requests.list.find((url) => url.searchParams.get('pagination') === 'cursor');
    expect(Object.fromEntries(first?.searchParams ?? [])).toEqual({
      pagination: 'cursor',
      limit: '50',
      sortField: 'invoice_number',
      sortDirection: 'asc',
    });

    const region = scrollRegion(page);
    await expect(async () => {
      await region.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      await expect(page.getByText('RE-2026-0120')).toBeVisible({ timeout: 500 });
    }).toPass();
    expect([...requestedBlocks(requests)].sort()).toEqual([null, 'offset:100', 'offset:50'].sort());
    await expect(page.getByTestId('data-table-announcement')).toHaveText('Ende der Liste, 120 Zeilen geladen.');
    expect(requests.list.every((url) => !url.searchParams.has('page'))).toBe(true);
  });

  test('WHEN the list opens without a sort in the URL THEN it asks for the newest invoices first as a cursor list', async ({ page }) => {
    const requests = await mockCursorList(page, { path: '/api/sales/invoices', rows: invoiceRows, unpaged: 'array' });
    await openList(page, '');

    await expect(page.getByText('RE-2026-0001')).toBeVisible();
    const first = requests.list.find((url) => url.searchParams.get('pagination') === 'cursor');
    expect(first?.searchParams.get('sortField')).toBe('date');
    expect(first?.searchParams.get('sortDirection')).toBe('desc');
  });

  // Scenario 4 of the pilot checks: a sort the cursor API does not approve keeps the paged list working.
  test('WHEN the sort is customer THEN the unpaged list keeps its page buttons and sends no cursor request', async ({ page }) => {
    const requests = await mockCursorList(page, { path: '/api/sales/invoices', rows: invoiceRows, unpaged: 'array' });
    await openList(page, '?sortField=customer&sortDirection=asc');

    await expect(pageButtons(page)).toBeVisible();
    expect(requests.list.length).toBeGreaterThan(0);
    expect(requests.list.every((url) => url.searchParams.get('pagination') === null)).toBe(true);
    expect(requests.count).toHaveLength(0);
  });

  test('AUT-946: WHEN the count is visible before page one THEN invoice rows are not lasting skeleton placeholders', async ({
    page,
  }) => {
    const rows = invoiceRows.slice(0, 9);
    await page.route(AutoCorePage.apiRouteMatcher('/api/sales/invoices/capped-count'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(e2eCappedCountBody(9)),
      });
    });
    await page.route(AutoCorePage.apiRouteMatcher('/api/sales/invoices'), async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('pagination') !== 'cursor') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(e2eCursorPageBody(rows)),
      });
    });
    await openList(page, '?sortField=invoice_number&sortDirection=asc');
    await expect(page.getByTestId('data-table-count')).toHaveText('9 Treffer');
    await expect(page.locator('tbody .animate-pulse')).toHaveCount(0, { timeout: 350 });
    await expect(page.getByText('RE-2026-0001')).toBeVisible({ timeout: 5_000 });
  });

  test.describe('at 375px', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('keeps the complete product draft number readable at 375px without UUID fragments', async ({ page }) => {
      const invoiceId = '600ad785-64af-43ce-9fbd-9ce37b2c0c41';
      await mockCursorList(page, {
        path: '/api/sales/invoices',
        rows: [{ ...invoiceRows[0], id: invoiceId, status: 'DRAFT', invoice_number: null, draft_number: 'RE-D-1042' }],
        unpaged: 'array',
      });
      await openList(page, '');

      const number = page.getByText('RE-D-1042', { exact: true });
      await expect(number).toBeVisible();
      expect(await contentClippedByAncestor(page.locator('li[data-table-row="true"]'))).toEqual([]);
      expect(await number.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await pageOverflow(page)).toBe(0);
      await expect(page.locator('li[data-table-row="true"]')).not.toContainText('600ad785');
    });

    test('WHEN the viewport is 375px THEN the invoice cards virtualize with variable heights and stay at least 44px tappable', async ({ page }) => {
      const requests = await mockCursorList(page, { path: '/api/sales/invoices', rows: invoiceRows, unpaged: 'array' });
      await openList(page, '?sortField=invoice_number&sortDirection=asc');

      await expect(page.getByTestId('data-table-count')).toBeVisible();
      await expect(page.locator('tbody .animate-pulse, li .animate-pulse')).toHaveCount(0, { timeout: 350 });

      const cards = page.locator('li[data-table-row="true"]');
      await expect(cards.first()).toBeVisible();
      await expect(page.locator('table')).toHaveCount(0);
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

      // Measure while block 2 is still pending: once the scroll below has also loaded the last block, the button is gone.
      const loadMore = page.getByRole('button', { name: dataTable.infinite.loadMore });
      await expect(loadMore).toBeVisible();
      expect((await loadMore.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      await expect(async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        expect(requests.list.some((url) => url.searchParams.get('cursor') === 'offset:50')).toBe(true);
      }).toPass();
    });
  });

  async function expectFramedCardsWithRightInset(page: Page, expectedStatusText: string) {
    const list = page.locator('ul[data-table-list="true"]');
    await expect(list).toBeVisible();
    const cards = page.locator('li[data-table-row="true"]');
    await expect(cards.first()).toBeVisible();

    const frame = await list.evaluate((ul) => {
      const style = getComputedStyle(ul);
      const rect = ul.getBoundingClientRect();
      return {
        borderRightWidth: parseFloat(style.borderRightWidth),
        borderLeftWidth: parseFloat(style.borderLeftWidth),
        borderTopWidth: parseFloat(style.borderTopWidth),
        borderBottomWidth: parseFloat(style.borderBottomWidth),
        right: rect.right,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(frame.borderRightWidth).toBeGreaterThanOrEqual(1);
    expect(frame.borderLeftWidth).toBeGreaterThanOrEqual(1);
    expect(frame.borderTopWidth).toBeGreaterThanOrEqual(1);
    expect(frame.borderBottomWidth).toBeGreaterThanOrEqual(1);
    expect(frame.right).toBeLessThanOrEqual(frame.viewportWidth);

    const cardMetrics = await cards.evaluateAll((nodes, statusText) =>
      nodes.map((node) => {
        const cardRect = node.getBoundingClientRect();
        const badge = [...node.querySelectorAll('span')].find((el) => el.textContent?.trim() === statusText);
        const amount = [...node.querySelectorAll('div')].find((el) => el.children.length === 0 && el.textContent?.includes('120'));
        return {
          cardRight: cardRect.right,
          badgeRight: badge?.getBoundingClientRect().right ?? null,
          amountRight: amount?.getBoundingClientRect().right ?? null,
        };
      }),
    expectedStatusText);

    expect(cardMetrics.length).toBeGreaterThan(0);
    for (const metric of cardMetrics) {
      expect(metric.cardRight).toBeLessThanOrEqual(frame.right - frame.borderRightWidth + 0.5);
      expect(metric.badgeRight).not.toBeNull();
      expect(metric.amountRight).not.toBeNull();
      expect(metric.cardRight - metric.badgeRight!).toBeGreaterThanOrEqual(12);
      expect(metric.cardRight - metric.amountRight!).toBeGreaterThanOrEqual(12);
    }

    expect(await contentClippedByAncestor(list)).toEqual([]);
    expect(await pageOverflow(page)).toBe(0);
  }

  test('AUT-947 scenario 1: WHEN an ADMIN opens /sales/invoices at 375px in DE THEN each card right border is visible and status badge and amounts are inset', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockCursorList(page, { path: '/api/sales/invoices', rows: invoiceRows.slice(0, 10), unpaged: 'array' });
    await openList(page, '');

    await expectFramedCardsWithRightInset(page, 'Abgeschlossen');
  });

  test('AUT-947 scenario 2: WHEN the same list is opened at 390px THEN the same inset and complete frame hold', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCursorList(page, { path: '/api/sales/invoices', rows: invoiceRows.slice(0, 10), unpaged: 'array' });
    await openList(page, '');

    await expectFramedCardsWithRightInset(page, 'Abgeschlossen');
  });

  test('AUT-947 scenario 3: WHEN the list is opened at 375px in EN THEN badge and amount typography still fits inside the card frame with no overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript((storageKey) => {
      window.localStorage.setItem(storageKey, 'en');
    }, UI_LANGUAGE_STORAGE_KEY);
    await mockCursorList(page, { path: '/api/sales/invoices', rows: invoiceRows.slice(0, 10), unpaged: 'array' });
    await openList(page, '');

    await expectFramedCardsWithRightInset(page, 'Finalized');
  });

  test('AUT-947 scenario 4: WHEN the list is opened at desktop ~1400 THEN table layout matches pre-fix desktop behaviour', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await mockCursorList(page, { path: '/api/sales/invoices', rows: invoiceRows.slice(0, 10), unpaged: 'array' });
    await openList(page, '');

    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('ul[data-table-list="true"]')).toHaveCount(0);
    await expect(page.getByText('RE-2026-0001')).toBeVisible();
    await expect(page.getByText('Abgeschlossen').first()).toBeVisible();
    expect(await pageOverflow(page)).toBe(0);
  });
});
