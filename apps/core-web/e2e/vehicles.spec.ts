import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockCustomer, createMockListResponse, createMockVehicleListItem } from './utils/mock-factories';

/**
 * Blueprint Validation Suite — Vehicles Module
 */
test.describe('Blueprint: Vehicles Module', () => {
  test('list page renders and follows golden rules', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Vehicle');

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

    // Verify header and create button
    await corePage.verifyHeaderConsistency('Vehicles');

    // Verify data table exists
    await expect(corePage.dataTable).toBeVisible();

    // Verify row click navigation
    await corePage.openRowDetails('Honda Civic');
  });

  test('detail page header and customer info renders correctly', async ({ page }) => {
    const mockVehicle = {
      ...createMockVehicleListItem({ make: 'Ford', model: 'Focus', year: 2018, plate: 'FD-5678' }),
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
    await expect(page.getByText('Vehicle Info')).toBeVisible();

    // Verify Customer Link renders inside the Info card
    const customerLink = page.getByRole('link', { name: 'Jane Smith' });
    await expect(customerLink).toBeVisible();
    await expect(customerLink).toHaveAttribute('href', `/customers/${mockVehicle.customer.id}`);
  });

  test('create vehicle dialog opens and accepts input', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Vehicle');

    await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles'), async (route) => {
      // For POST requests, simulate success
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'new-veh-id' }),
        });
      }
      
      // For GET requests (list)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([])),
      });
    });

    await corePage.navigate('/vehicles');

    // Click Create button
    await corePage.createButton.click();
    
    // Verify Dialog opens
    const dialog = page.getByRole('dialog', { name: 'Add Vehicle' });
    await expect(dialog).toBeVisible();

    // Fill form
    await dialog.getByLabel('Make').fill('Tesla');
    await dialog.getByLabel('Model').fill('Model 3');
    await dialog.getByLabel('Year').fill('2023');
    
    // Submit
    const submitButton = dialog.getByRole('button', { name: 'Create Vehicle' });
    await submitButton.click();

    // Dialog should close after submit
    await expect(dialog).not.toBeVisible();
  });
});
