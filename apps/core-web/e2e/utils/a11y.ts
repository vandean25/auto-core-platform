import { Page, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function expectNoCriticalA11yViolations(page: Page) {
  // Always attach violations report to the test, and in this phase 1 we don't fail the test
  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

  await test.info().attach('accessibility-scan-results', {
    body: JSON.stringify(accessibilityScanResults, null, 2),
    contentType: 'application/json'
  });

  // Phase 1: We report only. Do not assert here for now.
}
