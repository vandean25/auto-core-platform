const SETTINGS_TABS = ["finance", "voice-translation", "revenue-groups", "brands", "legal-entities", "sites", "locations", "employees", "bays", "hours", "labor", "vehicle-data", "margin-rules", "data-import", "team", "api-keys", "audit-logs"] as const
export type SettingsTab = typeof SETTINGS_TABS[number]

const ADMIN_ONLY_TABS: ReadonlySet<SettingsTab> = new Set(["legal-entities", "sites", "vehicle-data", "margin-rules", "data-import", "team", "api-keys"])

export function getVisibleTabs(canManage: boolean): readonly SettingsTab[] {
    return canManage ? SETTINGS_TABS : SETTINGS_TABS.filter(tab => !ADMIN_ONLY_TABS.has(tab))
}
