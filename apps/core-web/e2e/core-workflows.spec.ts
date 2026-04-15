import { test } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import { createMockInventoryItem, createMockCustomer, createMockVehicle } from './utils/mock-factories';

const modules = [
  { 
    name: 'Inventory', 
    path: '/inventory', 
    entity: 'Item', 
    seed: '06J-115-403-Q',
    mockFactory: (seed: string) => createMockInventoryItem({ sku: seed, name: 'Oil Filter' })
  },
  { 
    name: 'Vendors', 
    path: '/vendors', 
    entity: 'Vendor', 
    seed: 'Bosch Automotive',
    mockFactory: (seed: string) => ({ id: '1', name: seed, status: 'ACTIVE' })
  },
  { 
    name: 'Customers', 
    path: '/customers', 
    entity: 'Customer', 
    seed: 'John Doe',
    mockFactory: (seed: string) => createMockCustomer({ first_name: 'John', last_name: 'Doe' })
  },
];

test.describe('Core Management Workflows', () => {
  for (const module of modules) {
    test(`standard list-to-detail flow for ${module.name}`, async ({ page }) => {
      const corePage = new AutoCorePage(page, module.entity);
      
      // 1. Mock the specific API response using the factory and regex
      const apiRegex = new RegExp(`.*\/api${module.path}(\\?.*)?$`);
      await page.route(apiRegex, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [ module.mockFactory(module.seed) ],
            meta: { total: 1, page: 1, pageSize: 10, pageCount: 1 }
          }),
        });
      });

      // 2. Navigate to module
      await corePage.navigate(module.path);
      await page.waitForLoadState('networkidle');

      // 3. Verify Golden Rule: Header Consistency
      await corePage.verifyHeaderConsistency(module.name);

      // 4. Verify Golden Rule: Row Interaction opens Detail
      await corePage.openRowDetails(module.seed);
    });
  }
});
