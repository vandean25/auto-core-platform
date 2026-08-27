#!/usr/bin/env node
/**
 * Regression guard for AUT-205: Mintlify must not auto-include app CSS/JS from the
 * monorepo root (e.g. apps/core-web/src/index.css), which breaks theme switching.
 */
import { chromium } from 'playwright';
import { assertMintignore } from './verify-mintignore.mjs';

const DEFAULT_URL = process.env.MINTLIFY_DOCS_URL ?? 'http://localhost:3333/settings/brands';

async function assertNoLeakedAssets(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch (error) {
    await browser.close();
    throw new Error(
      `Could not load docs preview at ${url}. Start Mintlify locally or set MINTLIFY_DOCS_URL.`,
      { cause: error },
    );
  }

  const leaked = await page.evaluate(() => ({
    customCssBlocks: document.querySelectorAll('[data-custom-css-index]').length,
    hasTailwindImport: document.documentElement.innerHTML.includes('@import "tailwindcss"'),
    hasEslintConfig: document.documentElement.innerHTML.includes('eslint.config'),
  }));

  await page.getByRole('button', { name: 'Change theme preference' }).click();
  await page.locator('[role="menuitem"]', { hasText: /^Dark/ }).click();
  await page.waitForTimeout(300);

  const theme = await page.evaluate(() => ({
    isDark: document.documentElement.className.includes('dark'),
    preference: localStorage.getItem('isDarkMode'),
  }));

  await browser.close();

  if (leaked.customCssBlocks > 0 || leaked.hasTailwindImport || leaked.hasEslintConfig) {
    throw new Error(
      `Docs page still includes app assets (customCss=${leaked.customCssBlocks}, tailwind=${leaked.hasTailwindImport}, eslint=${leaked.hasEslintConfig})`,
    );
  }

  if (pageErrors.some((message) => message.includes('import statement outside a module'))) {
    throw new Error(`Docs page still throws module import errors: ${pageErrors.join(' | ')}`);
  }

  if (!theme.isDark || theme.preference !== 'dark') {
    throw new Error(`Theme switcher did not apply dark mode (state=${JSON.stringify(theme)})`);
  }
}

assertMintignore();
await assertNoLeakedAssets(DEFAULT_URL);
console.log(`Mintlify docs verification passed for ${DEFAULT_URL}`);
