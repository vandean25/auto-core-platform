import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { expectNoPageScroll } from './utils/phone-layout'
import deSettings from '../../../locales/de/settings.json' with { type: 'json' }

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const list = { data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } }

async function mockCommonSettingsApi(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/finance/settings'), async (route) => {
    await route.fulfill(json({ lock_date: null, invoice_prefix: 'RE-', next_invoice_number: 1000 }))
  })
  await page.route(AutoCorePage.apiRouteMatcher('/api/finance/revenue-groups'), async (route) => {
    await route.fulfill(json([]))
  })
  await page.route(AutoCorePage.apiRouteMatcher('/api/brands'), async (route) => {
    await route.fulfill(json(list))
  })
  await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
    await route.fulfill(json([]))
  })
  await page.route(AutoCorePage.apiRouteMatcher('/api/sites'), async (route) => {
    await route.fulfill(json([]))
  })
  await page.route(AutoCorePage.apiRouteMatcher('/api/tenant-members'), async (route) => {
    await route.fulfill(json(list))
  })
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/settings'), async (route) => {
    await route.fulfill(json({ timezone: 'Europe/Vienna' }))
  })
  await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/resources'), async (route) => {
    await route.fulfill(json([]))
  })
}

test.describe('Settings compact texts on 375px mobile (AUT-843)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('data-import: no intro or consent paragraphs, template fields behind info icon at 375px', async ({ page }) => {
    await mockCommonSettingsApi(page)
    await page.route(AutoCorePage.apiRouteMatcher('/api/imports/entity-types'), async (route) => {
      await route.fulfill(json({
        data: [{ entity_type: 'CUSTOMER', wizard: true, required_fields: ['external_id'] }],
      }))
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/imports/sources'), async (route) => {
      await route.fulfill(json({
        data: [{ id: 'src-1', key: 'legacy_dms', label: 'Legacy DMS', is_default: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }],
      }))
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/imports/templates/CUSTOMER'), async (route) => {
      await route.fulfill(json({
        entity_type: 'CUSTOMER',
        fields: [{ key: 'external_id', label_de: 'Kunden-Nr', required: true }],
      }))
    })
    await page.route(AutoCorePage.apiRouteMatcher('/api/imports'), async (route) => {
      await route.fulfill(json(list))
    })

    await new AutoCorePage(page, '').navigate('/settings?tab=data-import')
    await expect(page.getByRole('heading', { level: 2, name: deSettings.dataImport.title })).toBeVisible()

    // Intro and consent alert must not be present
    await expect(page.getByText('Marketing-Einwilligungsspalten werden vom Importmodul ignoriert')).toBeHidden()
    await expect(page.getByText('Spalten zu Einwilligung, Marketing')).toBeHidden()
    await expect(page.getByText('Quellsysteme, die beim Import gewählt werden können')).toBeHidden()

    // Template fields info button is visible
    const templateFieldsBtn = page.getByRole('button', { name: deSettings.dataImport.source.templateFieldsInfo })
    await expect(templateFieldsBtn).toBeVisible()

    await expectNoPageScroll(page)
    await page.screenshot({ path: '../../docs/internal/assets/aut-843-settings-import-375.png', fullPage: true })
  })

  test('margin-rules: no explanatory paragraphs, evaluation rule behind info popover at 375px', async ({ page }) => {
    await mockCommonSettingsApi(page)
    await page.route(/\/api\/margin-rules(\/threshold)?(\?.*)?$/, (route) =>
      route.fulfill(json(route.request().url().includes('threshold') ? { thresholdPercent: 10 } : [])),
    )

    await new AutoCorePage(page, '').navigate('/settings?tab=margin-rules')
    await expect(page.getByRole('heading', { name: deSettings.marginRules.title })).toBeVisible()

    // Evaluation rule info button is visible
    const infoBtn = page.getByRole('button', { name: deSettings.marginRules.activeRules.infoAria })
    await expect(infoBtn).toBeVisible()

    // Click to open popover
    await infoBtn.click()
    await expect(page.getByText(deSettings.marginRules.activeRules.description)).toBeVisible()

    await expectNoPageScroll(page)
    await page.screenshot({ path: '../../docs/internal/assets/aut-843-settings-margin-rules-375.png', fullPage: true })
  })

  test('voice-translation: short status without 3-sentence credentials paragraph at 375px', async ({ page }) => {
    await mockCommonSettingsApi(page)
    await page.route(AutoCorePage.apiRouteMatcher('/api/voice-translation/settings'), async (route) => {
      await route.fulfill(json({
        targetLanguageCode: 'de',
        googleProjectId: '',
        googleLocation: 'global',
        hasGoogleCredential: false,
      }))
    })

    await new AutoCorePage(page, '').navigate('/settings?tab=voice-translation')
    await expect(page.getByText(deSettings.voiceTranslation.credentialNotConfigured)).toBeVisible()
    await expect(page.getByText(/Die Zugangsdaten werden verschlüsselt/)).toBeHidden()

    await expectNoPageScroll(page)
    await page.screenshot({ path: '../../docs/internal/assets/aut-843-settings-voice-375.png', fullPage: true })
  })
})
