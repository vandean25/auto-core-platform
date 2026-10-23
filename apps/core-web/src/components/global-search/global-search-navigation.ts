import { Settings } from 'lucide-react'
import { i18n } from '@/lib/i18n'
import { getVisibleNavGroups, type NavAccessContext } from '@/components/navigation/nav-config'
import { getVisibleTabs, type SettingsTab } from '@/pages/settings-page-tabs'
import { filterQuickActionSections, type QuickActionSection } from './global-search-quick-actions'
import { getGlobalSearchQuickActionSections } from './global-search-quick-actions-data'
import { parseSearchInput } from './global-search-types'
import type { WorkshopIntakePrefill } from './workshop-intake-prefill'
import type settings from '../../../../../locales/de/settings.json'

// The same tab labels the settings page shows.
const SETTINGS_TAB_LABEL_KEYS: Record<SettingsTab, `tabs.${keyof typeof settings.tabs}`> = {
  finance: 'tabs.finance',
  'voice-translation': 'tabs.voiceTranslation',
  'revenue-groups': 'tabs.revenueGroups',
  brands: 'tabs.brands',
  'legal-entities': 'tabs.legalEntities',
  sites: 'tabs.sites',
  locations: 'tabs.locations',
  employees: 'tabs.employees',
  bays: 'tabs.bays',
  hours: 'tabs.hours',
  labor: 'tabs.labor',
  'vehicle-data': 'tabs.vehicleData',
  'margin-rules': 'tabs.marginRules',
  'data-import': 'tabs.dataImport',
  team: 'tabs.team',
  'api-keys': 'tabs.apiKeys',
  'audit-logs': 'tabs.auditLogs',
}

/** Sidebar entries the user may see, with the sidebar's own role filter. */
export function getNavigationSection(context: NavAccessContext): QuickActionSection {
  return {
    heading: i18n.t('nav:globalSearch.quickActions.navigate'),
    items: getVisibleNavGroups(context).flatMap((group) =>
      group.items.map((item) => ({
        href: item.to,
        icon: item.icon,
        label: i18n.t(`nav:${item.labelKey}`),
        description: i18n.t(`nav:${group.labelKey}`),
      })),
    ),
  }
}

/** One deep link per settings tab the role may open. Tabs the sidebar already links are left out. */
export function getSettingsSection(context: NavAccessContext, navigation: QuickActionSection): QuickActionSection {
  // Same rule as the settings page: only owners and admins manage the admin-only tabs.
  const canManage = context.activeRole === 'ADMIN' || context.activeRole === 'OWNER'
  const linked = new Set(navigation.items.map((item) => item.href))

  return {
    heading: i18n.t('nav:modules.settings'),
    items: getVisibleTabs(canManage)
      .map((tab) => ({
        href: `/settings?tab=${tab}`,
        icon: Settings,
        label: i18n.t(`settings:${SETTINGS_TAB_LABEL_KEYS[tab]}`),
        description: i18n.t('nav:modules.settings'),
      }))
      .filter((item) => !linked.has(item.href)),
  }
}

/**
 * Everything the palette offers besides search results, narrowed to the query. Settings tabs only
 * show once the user types, and a prefix filter (`k:`, `fz:` ...) asks for entities only.
 */
export function getPaletteSections(
  context: NavAccessContext | null,
  query: string,
  intakePrefill?: WorkshopIntakePrefill | null,
): QuickActionSection[] {
  if (!context || parseSearchInput(query).types) return []

  const navigation = getNavigationSection(context)
  const settings = query ? [getSettingsSection(context, navigation)] : []
  return filterQuickActionSections(
    [navigation, ...settings, ...getGlobalSearchQuickActionSections(intakePrefill)],
    query,
  )
}
