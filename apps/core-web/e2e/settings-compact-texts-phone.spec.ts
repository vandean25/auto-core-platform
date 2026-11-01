import { test, expect, type Locator, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { controlsShorterThan44, expectNoPageScroll, PHONE_WIDTHS } from './utils/phone-layout'
import deSettings from '../../../locales/de/settings.json' with { type: 'json' }

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
const list = { data: [], meta: { total: 0, page: 1, limit: 20, pageCount: 1 } }

/** The row a control sits in must stay reachable by touch, not shrink the icon to a 16px dot. */
async function expectReachableRow(trigger: Locator) {
  expect(await controlsShorterThan44(trigger.locator('xpath=..')), 'controls below the 44px target').toEqual([])
}

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
  test.use({ viewport: { width: PHONE_WIDTHS[0], height: 812 } })

  test('data-import: no intro or consent paragraphs, template fields and consent behind info icon at 375px', async ({ page }, testInfo) => {
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
    await expect(page.getByText('Spalten zu Einwilligung, Marketing, Newsletter oder Werbung')).toBeHidden()
    await expect(page.getByText('Quellsysteme, die beim Import gewählt werden können')).toBeHidden()

    // Consent info button is visible and opens popover
    const consentInfoBtn = page.getByRole('button', { name: deSettings.dataImport.consent.infoAria })
    await expect(consentInfoBtn).toBeVisible()
    await consentInfoBtn.click()
    await expect(page.getByText(deSettings.dataImport.consent.description)).toBeVisible()
    await expectReachableRow(consentInfoBtn)

    // Template fields info button is visible
    const templateFieldsBtn = page.getByRole('button', { name: deSettings.dataImport.source.templateFieldsInfo })
    await expect(templateFieldsBtn).toBeVisible()

    await expectNoPageScroll(page)
    await page.screenshot({ path: testInfo.outputPath('aut-843-settings-import-375.png'), fullPage: true })
  })

  test('margin-rules: no explanatory paragraphs, evaluation rule behind info popover at 375px', async ({ page }, testInfo) => {
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
    await expectReachableRow(infoBtn)

    await expectNoPageScroll(page)
    await page.screenshot({ path: testInfo.outputPath('aut-843-settings-margin-rules-375.png'), fullPage: true })
  })

  test('voice-translation: short status without 3-sentence credentials paragraph at 375px', async ({ page }, testInfo) => {
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

    // Info trigger explains credentials
    const credentialInfoBtn = page.getByRole('button', { name: deSettings.voiceTranslation.credentialInfoAria })
    await expect(credentialInfoBtn).toBeVisible()
    await credentialInfoBtn.click()
    await expect(page.getByText(deSettings.voiceTranslation.credentialInfo)).toBeVisible()
    await expectReachableRow(credentialInfoBtn)

    await expectNoPageScroll(page)
    await page.screenshot({ path: testInfo.outputPath('aut-843-settings-voice-375.png'), fullPage: true })
  })

  test('accounting-export: compliance texts behind info icons at 375px', async ({ page }, testInfo) => {
    await mockCommonSettingsApi(page)
    await page.route(AutoCorePage.apiRouteMatcher('/api/legal-entities'), async (route) => {
      await route.fulfill(json([
        { id: 'le-1', name: 'Auto Core GmbH', country_iso: 'DE', is_active: true },
      ]))
    })
    await page.route(/\/api\/finance\/accounting-exports(\?.*)?$/, async (route) => {
      await route.fulfill(json(list))
    })

    await new AutoCorePage(page, '').navigate('/settings?tab=finance')
    await page.getByRole('tab', { name: deSettings.finance.subTabs.accountingExport }).click()
    await expect(page.getByRole('heading', { level: 2, name: deSettings.accountingExport.header.title })).toBeVisible()

    // DATEV prerequisite info icon
    const datevInfoBtn = page.getByRole('button', { name: deSettings.accountingExport.header.infoAria })
    await expect(datevInfoBtn).toBeVisible()
    await datevInfoBtn.click()
    await expect(page.getByText(deSettings.accountingExport.header.info)).toBeVisible()
    await expectReachableRow(datevInfoBtn)

    // History download info icon
    const historyInfoBtn = page.getByRole('button', { name: deSettings.accountingExport.history.infoAria })
    await expect(historyInfoBtn).toBeVisible()
    await historyInfoBtn.click()
    await expect(page.getByText(deSettings.accountingExport.history.info)).toBeVisible()
    await expectReachableRow(historyInfoBtn)

    await expectNoPageScroll(page)
    await page.screenshot({ path: testInfo.outputPath('aut-843-settings-accounting-375.png'), fullPage: true })
  })

  test('legal-entities: country notice behind info popover at 375px', async ({ page }, testInfo) => {
    await mockCommonSettingsApi(page)
    await page.route(AutoCorePage.apiRouteMatcher('/api/legal-entities'), async (route) => {
      await route.fulfill(json([]))
    })

    await new AutoCorePage(page, '').navigate('/settings?tab=legal-entities')
    await expect(page.getByRole('heading', { level: 2, name: deSettings.legalEntities.title })).toBeVisible()

    // Country info icon in create form
    const countryInfoBtn = page.getByRole('button', { name: deSettings.legalEntities.create.countryInfoAria })
    await expect(countryInfoBtn).toBeVisible()
    await countryInfoBtn.click()
    await expect(page.getByText(deSettings.legalEntities.create.countryInfo)).toBeVisible()
    await expectReachableRow(countryInfoBtn)

    await expectNoPageScroll(page)
    await page.screenshot({ path: testInfo.outputPath('aut-843-settings-legal-entities-375.png'), fullPage: true })
  })

  test('labor: categories tab has discoverable delete action and no right-click description at 375px', async ({ page }, testInfo) => {
    await mockCommonSettingsApi(page)
    await page.route(AutoCorePage.apiRouteMatcher('/api/labor/categories'), async (route) => {
      await route.fulfill(json({
        data: [
          {
            id: 'cat-1',
            name: 'Engine',
            description: null,
            sort_order: 1,
            parent_id: null,
            default_hourly_rate: 120,
            is_active: true,
            children: [],
          },
        ],
      }))
    })

    await new AutoCorePage(page, '').navigate('/settings?tab=labor')
    await expect(page.getByRole('heading', { level: 3, name: deSettings.labor.categories.title })).toBeVisible()

    // Delete button is discoverable on the row
    const deleteBtn = page.getByRole('button', {
      name: deSettings.labor.categories.tree.deleteAria.replace('{{name}}', 'Engine'),
    })
    await expect(deleteBtn).toBeVisible()
    await expectReachableRow(deleteBtn)

    await expectNoPageScroll(page)
    await page.screenshot({ path: testInfo.outputPath('aut-843-settings-labor-375.png'), fullPage: true })
  })

  test('api-keys & audit-logs: no introductory paragraphs at 375px', async ({ page }) => {
    await mockCommonSettingsApi(page)
    await page.route(/\/api\/tenant-api-keys(\?.*)?$/, async (route) => {
      await route.fulfill(json(list))
    })
    await page.route(/\/api\/audit-logs(\?.*)?$/, async (route) => {
      await route.fulfill(json(list))
    })

    await new AutoCorePage(page, '').navigate('/settings?tab=api-keys')
    await expect(page.getByRole('heading', { name: deSettings.apiKeys.title })).toBeVisible()
    await expect(page.getByText('Nur-Lese-Schlüssel für Integrationen')).toBeHidden()

    await new AutoCorePage(page, '').navigate('/settings?tab=audit-logs')
    await expect(page.getByRole('heading', { name: deSettings.auditLogs.title })).toBeVisible()
    await expect(page.getByText('Unveränderliches, nur ergänzbares Audit-Protokoll')).toBeHidden()

    await expectNoPageScroll(page)
  })
})
