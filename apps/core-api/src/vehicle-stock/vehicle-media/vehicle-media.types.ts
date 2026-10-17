export type VehicleMediaVariantMeta = {
  storage_key: string;
  width: number;
  height: number;
  content_type: string;
};

export type VehicleMediaVariantMap = Record<string, VehicleMediaVariantMeta>;

export function collectVehicleMediaObjectKeys(media: {
  processed_storage_key: string;
  variant_storage_keys: unknown;
}): string[] {
  const keys = [media.processed_storage_key];
  const variants = media.variant_storage_keys;
  if (variants && typeof variants === 'object' && !Array.isArray(variants)) {
    for (const entry of Object.values(variants as VehicleMediaVariantMap)) {
      if (entry?.storage_key) {
        keys.push(entry.storage_key);
      }
    }
  }
  return keys;
}
