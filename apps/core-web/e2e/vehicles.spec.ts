import { expectNoCriticalA11yViolations } from "./utils/a11y";
import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockCustomer, createMockListResponse, createMockVehicleListItem } from './utils/mock-factories';
import { mockCursorList, requestedBlocks } from './utils/cursor-list-mock';
import { DE_COMMON } from './helpers/de-common';
import { DE_VEHICLES, deVehicleListRowAria } from './helpers/de-vehicles';
import { pageOverflow } from './utils/phone-layout';
import { expectListPeekForRecord, openListPeekInFull } from './helpers/peek-list';

/**
 * Blueprint Validation Suite — Vehicles Module
 */
test.describe('Blueprint: Vehicles Module', () => {
  test('row link on the vehicle list keeps a 24px minimum hit area', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_VEHICLES.list.addVehicle);

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createMockListResponse([
            createMockVehicleListItem({ make: 'Honda', model: 'Civic', plate: 'HD-1234' }),
          ])
        ),
      });
    });

    await corePage.navigate('/vehicles');
    await expect(corePage.dataTable).toBeVisible();

    const rowLink = page.getByRole('link', { name: deVehicleListRowAria('Honda Civic') });
    const box = await rowLink.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  });

  test('row link on the Gewährleistung list keeps a 24px minimum hit area', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_VEHICLES.list.addVehicle);

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicle-stock/gewaehrleistung-due'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'gewaehrleistung-hit-area-1',
              vehicle: { id: 'vehicle-gew-1', make: 'Skoda', model: 'Octavia', year: 2020, plate: 'GW-2020-OCT' },
              customer: { first_name: 'Maria', last_name: 'Gruber', company_name: null },
              handed_over_at: '2026-01-10T00:00:00.000Z',
              gewaehrleistung_ends_on: '2027-01-10T00:00:00.000Z',
              presumption_ends_on: '2026-07-10T00:00:00.000Z',
            },
          ],
          meta: { total: 1, page: 1, limit: 25, pageCount: 1 },
        }),
      });
    });

    await corePage.navigate('/vehicles/gewaehrleistung-due');
    await expect(page.getByRole('heading', { name: DE_VEHICLES.gewaehrleistungDue.title })).toBeVisible();

    const rowLink = page.getByRole('link', { name: deVehicleListRowAria('GW-2020-OCT · 2020') });
    const box = await rowLink.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  });

  test('list page renders and follows golden rules', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_VEHICLES.list.addVehicle);
    const listVehicle = createMockVehicleListItem({ make: 'Honda', model: 'Civic', plate: 'HD-1234' });

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([listVehicle])),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicles/${listVehicle.id}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...listVehicle,
          sales_orders: [],
          workshop_orders: [],
          invoices: [],
          customer: null,
        }),
      });
    });

    await corePage.navigate('/vehicles');

    // Verify header and create button
    await corePage.verifyHeaderConsistency(DE_VEHICLES.list.title);

    // Verify data table exists
    await expect(corePage.dataTable).toBeVisible();

    await expectNoCriticalA11yViolations(page);
    const row = page.locator('[data-table-row="true"]').filter({ hasText: 'Honda Civic' }).first();
    await row.locator('[data-column-id="plate"]').click();
    await expectListPeekForRecord(page, listVehicle.id, 'Honda Civic');
    await openListPeekInFull(page);
    await expect(page).toHaveURL(new RegExp(`/vehicles/${listVehicle.id}$`));
  });

  test('detail page header and customer info renders correctly', async ({ page }) => {
    const mockVehicle = {
      ...createMockVehicleListItem({ make: 'Ford', model: 'Focus', year: 2018, plate: 'FD-5678' }),
      co2_wltp_g_km: 142,
      first_registration_date: '2020-05-01',
      sales_orders: [],
      workshop_orders: [],
      invoices: [],
      customer: createMockCustomer({ first_name: 'Jane', last_name: 'Smith' }),
    };

    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicles/${mockVehicle.id}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockVehicle),
      });
    });

    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicles/${mockVehicle.id}/parties`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], suggested_bill_to: null }),
      });
    });

    await page.goto(`/vehicles/${mockVehicle.id}`);
    await page.waitForLoadState('networkidle');

    // Verify Header
    await expect(page.getByRole('heading', { name: '2018 Ford Focus' })).toBeVisible();
    await expect(page.getByText('FD-5678').first()).toBeVisible();

    // Verify Vehicle Info Card
    await expect(page.getByText(DE_VEHICLES.detail.vehicleInfo)).toBeVisible();
    await expect(
      page.getByText('Zulassung & Emissionen'),
    ).toBeVisible();
    await expect(page.getByText('142').first()).toBeVisible();

    // Verify Customer Link renders inside the Info card (the parties card links the same customer as a fallback)
    const customerLink = page.getByTestId('vehicle-customer-link');
    await expect(customerLink).toBeVisible();
    await expect(customerLink).toHaveAttribute('href', `/customers/${mockVehicle.customer.id}`);
    await expectNoCriticalA11yViolations(page);
  });

  test('parties card lists the OWNER returned by the parties endpoint', async ({ page }) => {
    const mockVehicle = {
      ...createMockVehicleListItem({ make: 'Ford', model: 'Focus', year: 2018, plate: 'FD-5678' }),
      co2_wltp_g_km: 142,
      first_registration_date: '2020-05-01',
      sales_orders: [],
      workshop_orders: [],
      invoices: [],
      customer: createMockCustomer({ first_name: 'Jane', last_name: 'Smith' }),
    };

    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicles/${mockVehicle.id}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockVehicle),
      });
    });
    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicles/${mockVehicle.id}/parties`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'party-owner-1',
              vehicle_id: mockVehicle.id,
              customer_id: mockVehicle.customer.id,
              role: 'OWNER',
              valid_from: '2026-01-01',
              valid_to: null,
              source: 'MANUAL',
              notes: null,
              is_active: true,
              customer: { id: mockVehicle.customer.id, type: 'PRIVATE', company_name: null, first_name: 'Jane', last_name: 'Smith' },
              createdAt: '2026-01-01T08:00:00.000Z',
              updatedAt: '2026-01-01T08:00:00.000Z',
            },
          ],
          suggested_bill_to: null,
        }),
      });
    });

    await page.goto(`/vehicles/${mockVehicle.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Beteiligte', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Halter' })).toBeVisible();
  });

  test('create vehicle dialog sends regulatory fields in POST body', async ({ page }) => {
    const corePage = new AutoCorePage(page, DE_VEHICLES.list.addVehicle);
    let postBody: Record<string, unknown> | undefined;

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles'), async (route) => {
      if (route.request().method() === 'POST') {
        postBody = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'new-veh-id' }),
        });
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      });
    });

    await corePage.navigate('/vehicles');
    await corePage.createButton.click();

    const dialog = page.getByRole('dialog', { name: DE_VEHICLES.dialog.addTitle });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(DE_VEHICLES.dialog.make).fill('Tesla');
    await dialog.getByLabel(DE_VEHICLES.dialog.model).fill('Model 3');
    await dialog.getByLabel(DE_VEHICLES.dialog.year).fill('2023');
    await expect(
      dialog.getByText('Zulassung & Emissionen'),
    ).toBeVisible();

    await dialog.getByLabel('Erstzulassung', { exact: true }).fill('01.06.2023');
    await dialog.getByLabel('CO₂ WLTP (g/km)').fill('142');

    await dialog.getByRole('button', { name: DE_VEHICLES.dialog.create }).click();
    await expect(dialog).not.toBeVisible();

    // The dialog closes at once and the list shows a pending row; the POST follows, so wait for it.
    await expect.poll(() => postBody?.first_registration_date).toBe('2023-06-01');
    expect(postBody?.co2_wltp_g_km).toBe(142);
  });

  test('edit vehicle dialog prefills regulatory values', async ({ page }) => {
    const mockVehicle = {
      ...createMockVehicleListItem({ make: 'VW', model: 'Golf', year: 2021 }),
      first_registration_date: '2021-04-12T00:00:00.000Z',
      co2_wltp_g_km: 118,
      co2_nedc_g_km: 110,
      typenschein_no: 'TS-PW-1',
      nova_class: 'STANDARD',
      emission_class: 'Euro 6d',
      sales_orders: [],
      workshop_orders: [],
      invoices: [],
      customer: null,
    };

    await page.route(AutoCorePage.apiRouteMatcher(`/api/vehicles/${mockVehicle.id}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockVehicle),
      });
    });

    await page.goto(`/vehicles/${mockVehicle.id}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: DE_VEHICLES.detail.editVehicle }).click();
    const dialog = page.getByRole('dialog', { name: DE_VEHICLES.dialog.editTitle });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByLabel('Erstzulassung', { exact: true })).toHaveValue(
      '12.04.2021',
    );
    await expect(dialog.getByLabel('CO₂ WLTP (g/km)')).toHaveValue('118');
    await expect(dialog.getByLabel('Typenschein-Nr.')).toHaveValue(
      'TS-PW-1',
    );
  });

  test.describe('at 375px', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    // Scenario 6 (AUT-957): default sort scrolls in blocks of 50 without page buttons; regression = page buttons or
    // second block never loads on a phone.
    test('infinite next block', async ({ page }, testInfo) => {
      const vehicles = Array.from({ length: 60 }, (_, index) =>
        createMockVehicleListItem({
          id: `vehicle-infinite-${index}`,
          make: 'Skoda',
          model: `Octavia-${String(1000 + index)}`,
          plate: `W-${1000 + index}`,
        }),
      );
      const requests = await mockCursorList(page, { path: '/api/vehicles', rows: vehicles });

      await new AutoCorePage(page, DE_VEHICLES.list.addVehicle).navigate('/vehicles');
      await expect(page.locator('li[data-table-row="true"]').first()).toBeVisible();
      await expect(page.getByTestId('data-table-count')).toHaveText('60 Treffer');
      expect(Object.fromEntries(requests.list[0].searchParams)).toEqual({ pagination: 'cursor', limit: '50' });
      await expect(page.getByRole('combobox', { name: DE_COMMON.dataTable.rowsPerPageAria })).toHaveCount(0);

      const loadMore = page.getByRole('button', { name: DE_COMMON.dataTable.infinite.loadMore });
      await expect(loadMore).toBeVisible();
      expect((await loadMore.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await pageOverflow(page)).toBe(0);

      await expect(async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        expect(requestedBlocks(requests).has('offset:50')).toBe(true);
      }).toPass();
      await expect(page.getByText('Skoda Octavia-1059')).toBeAttached();
      await testInfo.attach('customer-vehicles-infinite-next-block-375', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
  });
});
