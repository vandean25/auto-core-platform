import { expect, test, type Page } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';

/**
 * AUT-663: the Cmd+K palette answers from one GET /api/search. The API is mocked; the session is the
 * e2e ADMIN (user e2e-test-user, tenant e2e-tenant-id).
 */

const PLACEHOLDER = 'Teile, Kunden, Fahrzeuge, Aufträge…';

const SEARCH_RESPONSE = {
  groups: [
    {
      type: 'customer',
      results: [
        { type: 'customer', id: 'c0000000-0000-4000-8000-000000000001', title: 'Erika Musterfrau', subtitle: 'erika@example.at', href: '/customers/c0000000-0000-4000-8000-000000000001', score: 1 },
      ],
    },
    {
      type: 'vehicle',
      results: [
        { type: 'vehicle', id: 'e0000000-0000-4000-8000-000000000002', title: 'W-MUS1', subtitle: '2021 VW Golf', href: '/vehicles/e0000000-0000-4000-8000-000000000002', score: 0.8 },
      ],
    },
    { type: 'stock_vehicle', results: [], error: 'unavailable' },
    {
      type: 'workshop_order',
      results: [
        { type: 'workshop_order', id: 'f0000000-0000-4000-8000-000000000003', title: 'WO-2026-0042', subtitle: 'Musterfrau', href: '/workshop/orders/f0000000-0000-4000-8000-000000000003', score: 0.5, siteId: 'a0000000-0000-4000-8000-000000000009' },
      ],
    },
    {
      type: 'invoice',
      results: [
        { type: 'invoice', id: 'b0000000-0000-4000-8000-000000000004', title: 'RE-2026-0012', subtitle: 'Musterfrau', href: '/sales/invoices/b0000000-0000-4000-8000-000000000004', score: 0.5, siteId: 'a0000000-0000-4000-8000-000000000009' },
      ],
    },
  ],
};

const CASES = [
  { name: 'customer', result: 'Erika Musterfrau', url: /\/customers\/c0000000-0000-4000-8000-000000000001$/ },
  { name: 'vehicle', result: 'W-MUS1', url: /\/vehicles\/e0000000-0000-4000-8000-000000000002$/ },
  { name: 'workshop order', result: 'WO-2026-0042', url: /\/workshop\/orders\/f0000000-0000-4000-8000-000000000003/ },
  { name: 'invoice', result: 'RE-2026-0012', url: /\/sales\/invoices\/b0000000-0000-4000-8000-000000000004/ },
];

async function mockSearch(page: Page, requests: URL[] = []) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(AutoCorePage.apiRouteMatcher('/api/search'), (route) => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_RESPONSE) });
  });
}

async function openPalette(page: Page) {
  // The shortcut listener is attached with the app shell, so wait for the sidebar first.
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByPlaceholder(PLACEHOLDER);
  await expect(input).toBeVisible();
  return input;
}

test.describe('AUT-663: global search palette', () => {
  for (const { name, result, url } of CASES) {
    test(`finds and opens a ${name}`, async ({ page }) => {
      const requests: URL[] = [];
      await mockSearch(page, requests);
      await page.goto('/dashboard');

      const input = await openPalette(page);
      await input.fill('muster');
      await page.getByRole('option', { name: new RegExp(result) }).click();

      await expect(page).toHaveURL(url);
      expect(requests).toHaveLength(1);
      expect(requests[0].searchParams.get('q')).toBe('muster');
    });
  }

  test('keeps the other groups when one group is unavailable and badges other-site hits', async ({ page }) => {
    await mockSearch(page);
    await page.goto('/dashboard');

    const input = await openPalette(page);
    await input.fill('muster');

    await expect(page.getByText('Diese Ergebnisse sind vorübergehend nicht verfügbar.')).toBeVisible();
    await expect(page.getByRole('option', { name: /Erika Musterfrau/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /WO-2026-0042.*Anderer Standort/ })).toBeVisible();
  });

  test('sends a prefix as the types filter', async ({ page }) => {
    const requests: URL[] = [];
    await mockSearch(page, requests);
    await page.goto('/dashboard');

    const input = await openPalette(page);
    await input.fill('r:RE-2026');

    await expect(page.getByRole('option', { name: /RE-2026-0012/ })).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('q')).toBe('RE-2026');
    expect(requests[0].searchParams.get('types')).toBe('invoice');
  });

  test('lists a recently opened item after a reload', async ({ page }) => {
    await mockSearch(page);
    await page.goto('/dashboard');

    const input = await openPalette(page);
    await input.fill('muster');
    await page.getByRole('option', { name: /Erika Musterfrau/ }).click();
    await expect(page).toHaveURL(/\/customers\//);

    await page.reload();
    await openPalette(page);

    await expect(page.getByText('Zuletzt geöffnet')).toBeVisible();
    await expect(page.getByRole('option', { name: /Erika Musterfrau/ })).toBeVisible();
  });
});
