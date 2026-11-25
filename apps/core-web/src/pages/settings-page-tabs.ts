const SETTINGS_TABS = ["finance", "voice-translation", "revenue-groups", "brands", "legal-entities", "sites", "locations", "employees", "bays", "hours", "labor", "vehicle-data", "margin-rules", "data-import", "custom-fields", "team", "api-keys", "audit-logs", "notifications"] as const
export type SettingsTab = typeof SETTINGS_TABS[number]

const ADMIN_ONLY_TABS: ReadonlySet<SettingsTab> = new Set(["legal-entities", "sites", "vehicle-data", "margin-rules", "data-import", "custom-fields", "team", "api-keys", "audit-logs"])

export function getVisibleTabs(canManage: boolean, customFieldsEnabled = false): readonly SettingsTab[] {
    return SETTINGS_TABS.filter((tab) => {
        if (!canManage && ADMIN_ONLY_TABS.has(tab)) return false
        if (tab === "custom-fields" && !customFieldsEnabled) return false
        return true
    })
}
