import { expect, test, type Page } from '@playwright/test';
import { DE_SHELL } from './helpers/de-shell';

/**
 * AUT-656: the grouped sidebar. On a 1366x768 laptop every entry is reachable in the scroll area, icon
 * mode keeps each entry named with its label in a tooltip, the mobile sheet opens from the header and
 * closes after a navigation, and the collapse and group state survive a reload. The e2e session is an
 * ADMIN with the agent flag on, so the navigation lists 27 entries.
 */

const LAPTOP = { width: 1366, height: 768 };
const MOBILE = { width: 390, height: 844 };
const ADMIN_ENTRY_COUNT = 27;
const GROUP_LABELS = ['Übersicht', 'Verkauf', 'Werkstatt', 'Fahrzeuge', 'Lager & Einkauf', 'Finanzen', 'Verwaltung'];

function mainNavigation(page: Page) {
  return page.getByRole('navigation', { name: DE_SHELL.mainNavigation });
}

function sidebarTrigger(page: Page) {
  return page.locator('[data-sidebar="trigger"]');
}

function iconModeSidebar(page: Page) {
  return page.locator('[data-collapsible="icon"]');
}

test.describe('AUT-656: grouped sidebar', () => {
  test('every entry is reachable in the scroll area at 1366x768', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/dashboard');

    for (const label of GROUP_LABELS) {
      await expect(mainNavigation(page).getByRole('button', { name: label })).toBeVisible();
    }

    const links = mainNavigation(page).getByRole('link');
    await expect(links).toHaveCount(ADMIN_ENTRY_COUNT);
    for (let index = 0; index < ADMIN_ENTRY_COUNT; index += 1) {
      await links.nth(index).scrollIntoViewIfNeeded();
      await expect(links.nth(index)).toBeInViewport();
    }
  });

  test('icon mode keeps every entry reachable in the scroll area at 1366x768', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('acp:sidebar-collapsed', 'true'));
    await page.setViewportSize(LAPTOP);
    await page.goto('/dashboard');

    // A programmatic scroll also moves overflow:hidden containers, so the scroll container is asserted too.
    await expect(page.locator('[data-sidebar="content"]')).toHaveCSS('overflow-y', 'auto');
    const links = mainNavigation(page).getByRole('link');
    await expect(links).toHaveCount(ADMIN_ENTRY_COUNT);
    for (let index = 0; index < ADMIN_ENTRY_COUNT; index += 1) {
      await links.nth(index).scrollIntoViewIfNeeded();
      await expect(links.nth(index)).toBeInViewport();
    }
  });

  test('icon mode keeps every entry named and shows its label in a tooltip', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('acp:sidebar-collapsed', 'true'));
    await page.setViewportSize(LAPTOP);
    await page.goto('/dashboard');

    await expect(iconModeSidebar(page)).toHaveCount(1);
    const customers = mainNavigation(page).getByRole('link', { name: DE_SHELL.modules.customers, exact: true });
    await expect(customers).toBeVisible();

    await customers.hover();

    await expect(page.getByRole('tooltip')).toHaveText(DE_SHELL.modules.customers);
  });

  test('the collapsed sidebar and the group state survive a reload', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/dashboard');

    await sidebarTrigger(page).click();
    await expect(iconModeSidebar(page)).toHaveCount(1);
    await page.reload();
    await expect(iconModeSidebar(page)).toHaveCount(1);

    await sidebarTrigger(page).click();
    await expect(iconModeSidebar(page)).toHaveCount(0);
    await mainNavigation(page).getByRole('button', { name: 'Verkauf' }).click();
    await expect(mainNavigation(page).getByRole('button', { name: 'Verkauf' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await page.reload();
    await expect(mainNavigation(page).getByRole('button', { name: 'Verkauf' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('Ctrl+B toggles the sidebar on a laptop', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/dashboard');
    await expect(mainNavigation(page)).toBeVisible();

    await page.keyboard.press('Control+b');

    await expect(iconModeSidebar(page)).toHaveCount(1);
  });

  test('on a 390px phone the sheet closes from its header close button', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/dashboard');

    await sidebarTrigger(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('on a 390px phone the sidebar opens as a sheet and closes after a navigation', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/dashboard');

    await expect(mainNavigation(page)).toBeHidden();
    await sidebarTrigger(page).click();

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('link', { name: DE_SHELL.modules.customers, exact: true }).click();

    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
