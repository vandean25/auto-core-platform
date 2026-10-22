import { expectNoCriticalA11yViolations } from "./utils/a11y";
import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockCustomer, createMockListResponse, createMockVehicleListItem } from './utils/mock-factories';
import { DE_VEHICLES, deVehicleListRowAria } from './helpers/de-vehicles';
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

    await page.goto(`/vehicles/${mockVehicle.id}`);
    await page.waitForLoadState('networkidle');

    // Verify Header
    await expect(page.getByRole('heading', { name: '2018 Ford Focus' })).toBeVisible();
    await expect(page.getByText('FD-5678').first()).toBeVisible();

    // Verify Vehicle Info Card
    await expect(page.getByText(DE_VEHICLES.detail.vehicleInfo)).toBeVisible();
    await expect(
      page.getByText('Registration & emissions / Zulassung & Emissionen'),
    ).toBeVisible();
    await expect(page.getByText('142').first()).toBeVisible();

    // Verify Customer Link renders inside the Info card
    const customerLink = page.getByRole('link', { name: 'Jane Smith' });
    await expect(customerLink).toBeVisible();
    await expect(customerLink).toHaveAttribute('href', `/customers/${mockVehicle.customer.id}`);
    await expectNoCriticalA11yViolations(page);
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
      dialog.getByText('Registration & emissions / Zulassung & Emissionen'),
    ).toBeVisible();

    await dialog.getByLabel('First registration date / Erstzulassung').fill('2023-06-01');
    await dialog.getByLabel('CO₂ WLTP (g/km) / CO₂ WLTP (g/km)').fill('142');

    await dialog.getByRole('button', { name: DE_VEHICLES.dialog.create }).click();
    await expect(dialog).not.toBeVisible();

    expect(postBody?.first_registration_date).toBe('2023-06-01');
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

    await expect(dialog.getByLabel('First registration date / Erstzulassung')).toHaveValue(
      '2021-04-12',
    );
    await expect(dialog.getByLabel('CO₂ WLTP (g/km) / CO₂ WLTP (g/km)')).toHaveValue('118');
    await expect(dialog.getByLabel('Type approval no. (Typenschein) / Typenschein-Nr.')).toHaveValue(
      'TS-PW-1',
    );
  });
});
