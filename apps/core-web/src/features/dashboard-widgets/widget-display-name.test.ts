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

describe('resolveDashboardWidgetDisplayName (AUT-970)', () => {
  it('resolves legacy English list/total/donut titles to German in DE locale', () => {
    expect(
      resolveDashboardWidgetDisplayName(vehiclesWidget('Vehicles List', 'list'), DASHBOARD_WIDGET_SOURCE_VEHICLES, tCommon),
    ).toBe(
      tCommon('dashboard.builtInWidgetTitle.list', {
        sourceLabel: tCommon(DASHBOARD_WIDGET_SOURCE_VEHICLES.labelKey),
      }),
    )
    expect(
      resolveDashboardWidgetDisplayName(vehiclesWidget('Vehicles Total', 'metric'), DASHBOARD_WIDGET_SOURCE_VEHICLES, tCommon),
    ).toBe(
      tCommon('dashboard.builtInWidgetTitle.metricCount', {
        sourceLabel: tCommon(DASHBOARD_WIDGET_SOURCE_VEHICLES.labelKey),
      }),
    )
    expect(
      resolveDashboardWidgetDisplayName(vehiclesWidget('Vehicles Donut', 'donut'), DASHBOARD_WIDGET_SOURCE_VEHICLES, tCommon),
    ).toBe(
      tCommon('dashboard.builtInWidgetTitle.donut', {
        sourceLabel: tCommon(DASHBOARD_WIDGET_SOURCE_VEHICLES.labelKey),
      }),
    )
  })

  it('keeps user-customised widget titles unchanged', () => {
    const custom = 'Meine BMW-Übersicht'
    expect(
      resolveDashboardWidgetDisplayName(vehiclesWidget(custom, 'list'), DASHBOARD_WIDGET_SOURCE_VEHICLES, tCommon),
    ).toBe(custom)
  })

  it('resolves legacy English titles to English in EN locale', async () => {
    await changeUiLanguage('en')
  const tEn = i18n.getFixedT('en', 'common') as TFunction<'common'>
    const sourceLabel = enCommon.dashboard.sources.vehicles
    expect(resolveDashboardWidgetDisplayName(vehiclesWidget('Vehicles List', 'list'), DASHBOARD_WIDGET_SOURCE_VEHICLES, tEn)).toBe(
      enCommon.dashboard.builtInWidgetTitle.list.replace('{{sourceLabel}}', sourceLabel),
    )
    expect(resolveDashboardWidgetDisplayName(vehiclesWidget('Vehicles Total', 'metric'), DASHBOARD_WIDGET_SOURCE_VEHICLES, tEn)).toBe(
      enCommon.dashboard.builtInWidgetTitle.metricCount.replace('{{sourceLabel}}', sourceLabel),
    )
    expect(resolveDashboardWidgetDisplayName(vehiclesWidget('Vehicles Donut', 'donut'), DASHBOARD_WIDGET_SOURCE_VEHICLES, tEn)).toBe(
      enCommon.dashboard.builtInWidgetTitle.donut.replace('{{sourceLabel}}', sourceLabel),
    )
    await changeUiLanguage('de')
  })

  it('resolves stored German built-in titles when the UI locale changes', async () => {
    const deLabel = deCommon.dashboard.sources.vehicles
    const stored = `${deLabel} Liste`
    await changeUiLanguage('en')
    const tEn = i18n.getFixedT('en', 'common') as TFunction<'common'>
    expect(resolveDashboardWidgetDisplayName(vehiclesWidget(stored, 'list', { sourceLabel: deLabel }), DASHBOARD_WIDGET_SOURCE_VEHICLES, tEn)).toBe(
      enCommon.dashboard.builtInWidgetTitle.list.replace('{{sourceLabel}}', enCommon.dashboard.sources.vehicles),
    )
    await changeUiLanguage('de')
  })

  it('resolves legacy "Vehicles Widget" using the widget display type', () => {
    expect(
      resolveDashboardWidgetDisplayName(vehiclesWidget('Vehicles Widget', 'list'), DASHBOARD_WIDGET_SOURCE_VEHICLES, tCommon),
    ).toBe(
      tCommon('dashboard.builtInWidgetTitle.list', {
        sourceLabel: tCommon(DASHBOARD_WIDGET_SOURCE_VEHICLES.labelKey),
      }),
    )
  })
})
