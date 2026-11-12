import { describe, expect, it } from 'vitest'

import { registerGermanUiForTests } from '@/test/german-ui'
import { changeUiLanguage, i18n } from '@/lib/i18n'
import type { TFunction } from 'i18next'
import deCommon from '../../../../../locales/de/common.json' with { type: 'json' }
import enCommon from '../../../../../locales/en/common.json' with { type: 'json' }
import { DASHBOARD_WIDGET_SOURCE_VEHICLES } from './sources'
import type { DashboardWidget } from './types'
import { resolveDashboardWidgetDisplayName } from './widget-display-name'

registerGermanUiForTests()

type BuiltInTitleKey = keyof typeof deCommon.dashboard.builtInWidgetTitle

function vehiclesWidget(
  name: string,
  displayType: DashboardWidget['displayType'],
  overrides: Partial<DashboardWidget> = {},
): DashboardWidget {
  return {
    id: 'w1',
    name,
    sourceKey: 'vehicles',
    sourceLabel: 'Vehicles',
    href: '/vehicles',
    displayType,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const tCommon = i18n.getFixedT('de', 'common') as TFunction<'common'>
const vehicleSourceLabelDe = () => tCommon(DASHBOARD_WIDGET_SOURCE_VEHICLES.labelKey)

const legacyEnglishVehicleTitles: Array<{
  storedName: string
  displayType: DashboardWidget['displayType']
  titleKey: BuiltInTitleKey
  metricCalculation?: DashboardWidget['metricCalculation']
}> = [
  { storedName: 'Vehicles List', displayType: 'list', titleKey: 'list' },
  { storedName: 'Vehicles Total', displayType: 'metric', titleKey: 'metricCount', metricCalculation: 'count' },
  { storedName: 'Vehicles Donut', displayType: 'donut', titleKey: 'donut' },
]

describe('resolveDashboardWidgetDisplayName (AUT-970)', () => {
  it.each(legacyEnglishVehicleTitles)(
    'resolves legacy English title "$storedName" to German',
    ({ storedName, displayType, titleKey, metricCalculation }) => {
      const expected = tCommon(`dashboard.builtInWidgetTitle.${titleKey}`, { sourceLabel: vehicleSourceLabelDe() })
      expect(
        resolveDashboardWidgetDisplayName(
          vehiclesWidget(storedName, displayType, { metricCalculation }),
          DASHBOARD_WIDGET_SOURCE_VEHICLES,
          tCommon,
        ),
      ).toBe(expected)
    },
  )

  it('keeps user-customised widget titles unchanged', () => {
    const custom = 'Meine BMW-Übersicht'
    expect(
      resolveDashboardWidgetDisplayName(vehiclesWidget(custom, 'list'), DASHBOARD_WIDGET_SOURCE_VEHICLES, tCommon),
    ).toBe(custom)
  })

  it.each(legacyEnglishVehicleTitles)(
    'resolves legacy English title "$storedName" to English',
    async ({ storedName, displayType, titleKey, metricCalculation }) => {
      await changeUiLanguage('en')
      const tEn = i18n.getFixedT('en', 'common') as TFunction<'common'>
      const sourceLabel = enCommon.dashboard.sources.vehicles
      const expected = enCommon.dashboard.builtInWidgetTitle[titleKey].replace('{{sourceLabel}}', sourceLabel)
      expect(
        resolveDashboardWidgetDisplayName(
          vehiclesWidget(storedName, displayType, { metricCalculation }),
          DASHBOARD_WIDGET_SOURCE_VEHICLES,
          tEn,
        ),
      ).toBe(expected)
      await changeUiLanguage('de')
    },
  )

  it('resolves stored German list title when the UI locale changes', async () => {
    const deLabel = deCommon.dashboard.sources.vehicles
    const stored = `${deLabel} Liste`
    await changeUiLanguage('en')
    const tEn = i18n.getFixedT('en', 'common') as TFunction<'common'>
    expect(resolveDashboardWidgetDisplayName(vehiclesWidget(stored, 'list', { sourceLabel: deLabel }), DASHBOARD_WIDGET_SOURCE_VEHICLES, tEn)).toBe(
      enCommon.dashboard.builtInWidgetTitle.list.replace('{{sourceLabel}}', enCommon.dashboard.sources.vehicles),
    )
    await changeUiLanguage('de')
  })

  it('resolves stored German metricCount title when the UI locale changes', async () => {
    const deLabel = deCommon.dashboard.sources.vehicles
    const stored = `${deLabel} Gesamt`
    await changeUiLanguage('en')
    const tEn = i18n.getFixedT('en', 'common') as TFunction<'common'>
    expect(
      resolveDashboardWidgetDisplayName(
        vehiclesWidget(stored, 'metric', { sourceLabel: deLabel, metricCalculation: 'count' }),
        DASHBOARD_WIDGET_SOURCE_VEHICLES,
        tEn,
      ),
    ).toBe(enCommon.dashboard.builtInWidgetTitle.metricCount.replace('{{sourceLabel}}', enCommon.dashboard.sources.vehicles))
    await changeUiLanguage('de')
  })

  it('resolves legacy "Vehicles Widget" using the widget display type', () => {
    expect(
      resolveDashboardWidgetDisplayName(vehiclesWidget('Vehicles Widget', 'list'), DASHBOARD_WIDGET_SOURCE_VEHICLES, tCommon),
    ).toBe(
      tCommon('dashboard.builtInWidgetTitle.list', {
        sourceLabel: vehicleSourceLabelDe(),
      }),
    )
  })
})
