import { Bookmark, Pencil, Trash2, Settings } from 'lucide-react'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { savedViewPath, type SavedView } from '@/features/saved-views/SavedViewsProvider'
import type { PaletteContextActionSection } from './global-search-context-actions'
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
  notifications: 'tabs.notifications',
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

/** The saved views whose list the role can reach through the sidebar, with that list's name. */
function reachableSavedViews(savedViews: readonly SavedView[], navigation: QuickActionSection) {
  const lists = new Map(navigation.items.map((item) => [savedViewPath(item.href), item.label]))
  return savedViews.flatMap((view) => {
    const list = lists.get(savedViewPath(view.href))
    return list ? [{ view, list }] : []
  })
}

/**
 * "Open view …" for the user's saved views. A view whose list the role cannot reach through the sidebar is left out,
 * and the entry opens the saved href itself, so Cmd/Ctrl+Enter opens it in a new tab like any other entry.
 */
export function getSavedViewsSection(savedViews: readonly SavedView[], navigation: QuickActionSection): QuickActionSection {
  return {
    heading: i18n.t('nav:globalSearch.savedViews.heading'),
    items: reachableSavedViews(savedViews, navigation).map(({ view, list }) => ({
      href: view.href,
      icon: Bookmark,
      label: i18n.t('nav:globalSearch.savedViews.open', { name: view.name }),
      description: list,
    })),
  }
}

export type SavedViewPaletteRun = (action: 'rename' | 'remove', view: SavedView) => void

/**
 * "Rename view …" and "Remove view …" for the same views and with the same gating as the open entries. They run the
 * registry actions (`run`), so removing asks the same confirmation as the toolbar menu. Only offered once the user types.
 */
export function getSavedViewManageSection(
  context: NavAccessContext | null,
  query: string,
  savedViews: readonly SavedView[],
  run: SavedViewPaletteRun,
): PaletteContextActionSection | null {
  if (!query || !canOfferPaletteSections(context, query)) return null

  const lower = query.toLowerCase()
  const items = reachableSavedViews(savedViews, getNavigationSection(context)).flatMap(({ view, list }) => {
    // Registry child segments are alphanumeric, so the view id loses its hyphens.
    const suffix = view.id.replace(/[^a-zA-Z0-9]/g, '')
    return [
      {
        id: `${ENTITY_ACTION_IDS.savedViewRename}.${suffix}`,
        label: i18n.t('nav:globalSearch.savedViews.rename', { name: view.name }),
        icon: Pencil,
        description: list,
        onSelect: () => run('rename', view),
      },
      {
        id: `${ENTITY_ACTION_IDS.savedViewDelete}.${suffix}`,
        label: i18n.t('nav:globalSearch.savedViews.remove', { name: view.name }),
        icon: Trash2,
        description: list,
        destructive: true,
        onSelect: () => run('remove', view),
      },
    ].filter((item) => [item.label, item.description].some((text) => text.toLowerCase().includes(lower)))
  })
  return items.length > 0 ? { heading: i18n.t('nav:globalSearch.savedViews.manageHeading'), items } : null
}

/** Mechanics (TECH) cannot open any admin-shell page, and a prefix filter (`k:`, `fz:` ...) asks for entities only. */
function canOfferPaletteSections(context: NavAccessContext | null, query: string): context is NavAccessContext {
  return Boolean(context) && context?.activeRole !== 'TECH' && !parseSearchInput(query).types
}

/**
 * Everything the palette offers besides search results, narrowed to the query. Settings tabs only
 * show once the user types, and a prefix filter (`k:`, `fz:` ...) asks for entities only.
 */
export function getPaletteSections(
  context: NavAccessContext | null,
  query: string,
  intakePrefill?: WorkshopIntakePrefill | null,
  savedViews: readonly SavedView[] = [],
): QuickActionSection[] {
  if (!canOfferPaletteSections(context, query)) return []

  const navigation = getNavigationSection(context)
  const settings = query ? [getSettingsSection(context, navigation)] : []
  // Saved views show once the user types, so an empty palette stays short.
  const savedViewsSection = getSavedViewsSection(query ? savedViews : [], navigation)
  return filterQuickActionSections(
    [navigation, ...(savedViewsSection.items.length > 0 ? [savedViewsSection] : []), ...settings, ...getGlobalSearchQuickActionSections(intakePrefill, context.activeRole ?? undefined)],
    query,
  )
}
