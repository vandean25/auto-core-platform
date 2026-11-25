import type { LucideIcon } from "lucide-react"
import {
    Bell,
    Building2,
    Car,
    Clock,
    FileUp,
    Hammer,
    KeyRound,
    Landmark,
    Languages,
    Layers,
    MapPin,
    Percent,
    ScrollText,
    SlidersHorizontal,
    Tag,
    UserCheck,
    Users,
    Warehouse,
    Wrench,
} from "lucide-react"
import type settings from "../../../../locales/de/settings.json"

const SETTINGS_TABS = ["finance", "voice-translation", "revenue-groups", "brands", "legal-entities", "sites", "locations", "employees", "bays", "hours", "labor", "vehicle-data", "margin-rules", "data-import", "custom-fields", "team", "api-keys", "audit-logs", "notifications"] as const
export type SettingsTab = typeof SETTINGS_TABS[number]

const SETTINGS_TAB_SET: ReadonlySet<string> = new Set(SETTINGS_TABS)

export const ADMIN_ONLY_TABS: ReadonlySet<SettingsTab> = new Set(["legal-entities", "sites", "vehicle-data", "margin-rules", "data-import", "custom-fields", "team", "api-keys", "audit-logs"])

export function getVisibleTabs(canManage: boolean, customFieldsEnabled = false): readonly SettingsTab[] {
    return SETTINGS_TABS.filter((tab) => {
        if (!canManage && ADMIN_ONLY_TABS.has(tab)) return false
        if (tab === "custom-fields" && !customFieldsEnabled) return false
        return true
    })
}

export function isValidSettingsTab(value: string | null | undefined): value is SettingsTab {
    return Boolean(value && SETTINGS_TAB_SET.has(value))
}

export function getSettingsSectionPath(tab: SettingsTab): string {
    return `/settings/${tab}`
}

export function resolveLegacySettingsRedirect(search: string, hash = ""): string | null {
    const params = new URLSearchParams(search)
    if (!params.has("tab")) return null
    const rawTab = params.get("tab")
    if (!isValidSettingsTab(rawTab)) {
        return "/settings"
    }
    params.delete("tab")
    const nextSearch = params.toString()
    return `${getSettingsSectionPath(rawTab)}${nextSearch ? `?${nextSearch}` : ""}${hash}`
}

export type SettingsGroupId = "company" | "workshop" | "finance" | "system"

export type SettingsGroupDefinition = {
    id: SettingsGroupId
    labelKey: `groups.${keyof typeof settings.groups}`
    tabs: readonly SettingsTab[]
}

export const SETTINGS_GROUPS: readonly SettingsGroupDefinition[] = [
    {
        id: "company",
        labelKey: "groups.company",
        tabs: ["legal-entities", "sites", "brands", "employees", "team"],
    },
    {
        id: "workshop",
        labelKey: "groups.workshop",
        tabs: ["bays", "hours", "labor", "locations", "vehicle-data"],
    },
    {
        id: "finance",
        labelKey: "groups.finance",
        tabs: ["finance", "revenue-groups", "margin-rules"],
    },
    {
        id: "system",
        labelKey: "groups.system",
        tabs: ["voice-translation", "data-import", "api-keys", "audit-logs", "notifications", "custom-fields"],
    },
]

export type SettingsSectionMeta = {
    labelKey: `tabs.${keyof typeof settings.tabs}`
    descriptionKey: `descriptions.${keyof typeof settings.descriptions}`
    icon: LucideIcon
}

export const SETTINGS_SECTION_META: Record<SettingsTab, SettingsSectionMeta> = {
    "legal-entities": { labelKey: "tabs.legalEntities", descriptionKey: "descriptions.legalEntities", icon: Building2 },
    "sites": { labelKey: "tabs.sites", descriptionKey: "descriptions.sites", icon: MapPin },
    "brands": { labelKey: "tabs.brands", descriptionKey: "descriptions.brands", icon: Tag },
    "employees": { labelKey: "tabs.employees", descriptionKey: "descriptions.employees", icon: UserCheck },
    "team": { labelKey: "tabs.team", descriptionKey: "descriptions.team", icon: Users },
    "bays": { labelKey: "tabs.bays", descriptionKey: "descriptions.bays", icon: Wrench },
    "hours": { labelKey: "tabs.hours", descriptionKey: "descriptions.hours", icon: Clock },
    "labor": { labelKey: "tabs.labor", descriptionKey: "descriptions.labor", icon: Hammer },
    "locations": { labelKey: "tabs.locations", descriptionKey: "descriptions.locations", icon: Warehouse },
    "vehicle-data": { labelKey: "tabs.vehicleData", descriptionKey: "descriptions.vehicleData", icon: Car },
    "finance": { labelKey: "tabs.finance", descriptionKey: "descriptions.finance", icon: Landmark },
    "revenue-groups": { labelKey: "tabs.revenueGroups", descriptionKey: "descriptions.revenueGroups", icon: Layers },
    "margin-rules": { labelKey: "tabs.marginRules", descriptionKey: "descriptions.marginRules", icon: Percent },
    "voice-translation": { labelKey: "tabs.voiceTranslation", descriptionKey: "descriptions.voiceTranslation", icon: Languages },
    "data-import": { labelKey: "tabs.dataImport", descriptionKey: "descriptions.dataImport", icon: FileUp },
    "api-keys": { labelKey: "tabs.apiKeys", descriptionKey: "descriptions.apiKeys", icon: KeyRound },
    "audit-logs": { labelKey: "tabs.auditLogs", descriptionKey: "descriptions.auditLogs", icon: ScrollText },
    "notifications": { labelKey: "tabs.notifications", descriptionKey: "descriptions.notifications", icon: Bell },
    "custom-fields": { labelKey: "tabs.customFields", descriptionKey: "descriptions.customFields", icon: SlidersHorizontal },
}
