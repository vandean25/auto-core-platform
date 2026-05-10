import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockInventoryItem, createMockListResponse } from './utils/mock-factories';

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
    const corePage = new AutoCorePage(page, 'Item');
    await corePage.navigate('/inventory');

    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
    await expect(page.getByRole('cell', { name: SEED_SKU }).first()).toBeVisible();

    // Use the POM row-click helper — validates the Golden Rule data attribute too
    await corePage.openRowDetails(SEED_SKU);
  });

  test('should allow searching for parts by SKU', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Item');
    await corePage.navigate('/inventory');

    const searchInput = page.getByPlaceholder('Search parts...');
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
    await expect(page.getByPlaceholder('Search parts...')).toBeVisible({ timeout: 20_000 });
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

    const corePage = new AutoCorePage(page, 'Item');
    await corePage.navigate('/inventory');

    // Golden Rule 2: rows carry the data-table-row attribute
    const row = page.locator('[data-table-row="true"]').filter({ hasText: 'MOCK-SKU-001' });
    await expect(row).toBeVisible();
  });
});
