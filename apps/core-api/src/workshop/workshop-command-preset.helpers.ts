export type WorkshopCommandPresetSiteRow = {
  preset_key: string;
  site_id: string | null;
};

/** Site row wins over tenant-wide (`site_id` null) for the same `preset_key`. */
export function pickWorkshopCommandPresetForSite<
  T extends WorkshopCommandPresetSiteRow,
>(presets: readonly T[], siteId: string): Map<string, T> {
  const byKey = new Map<string, T>();
  for (const preset of presets) {
    const existing = byKey.get(preset.preset_key);
    if (!existing) {
      byKey.set(preset.preset_key, preset);
      continue;
    }
    if (preset.site_id === siteId) {
      byKey.set(preset.preset_key, preset);
    }
  }
  return byKey;
}
