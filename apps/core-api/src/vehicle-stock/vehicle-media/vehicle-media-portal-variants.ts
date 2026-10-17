import type { UploadImageResizeLimits } from '../../common/media/image-processing.types.js';

export const DEFAULT_VEHICLE_MEDIA_MAIN_LIMITS: UploadImageResizeLimits = {
  maxWidth: 2048,
  maxHeight: 2048,
};

export const DEFAULT_VEHICLE_MEDIA_PORTAL_VARIANTS: Record<
  string,
  UploadImageResizeLimits
> = {
  portal_md: { maxWidth: 1600, maxHeight: 1600 },
  thumbnail: { maxWidth: 320, maxHeight: 320 },
};

export function resolveVehicleMediaPortalVariants(): Record<
  string,
  UploadImageResizeLimits
> {
  const raw = process.env.VEHICLE_MEDIA_PORTAL_VARIANTS_JSON?.trim();
  if (!raw) {
    return { ...DEFAULT_VEHICLE_MEDIA_PORTAL_VARIANTS };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, UploadImageResizeLimits>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_VEHICLE_MEDIA_PORTAL_VARIANTS };
    }
    const normalized: Record<string, UploadImageResizeLimits> = {};
    for (const [key, limits] of Object.entries(parsed)) {
      if (
        typeof limits?.maxWidth === 'number' &&
        limits.maxWidth > 0 &&
        typeof limits.maxHeight === 'number' &&
        limits.maxHeight > 0
      ) {
        normalized[key] = {
          maxWidth: Math.floor(limits.maxWidth),
          maxHeight: Math.floor(limits.maxHeight),
        };
      }
    }
    return Object.keys(normalized).length > 0
      ? normalized
      : { ...DEFAULT_VEHICLE_MEDIA_PORTAL_VARIANTS };
  } catch {
    return { ...DEFAULT_VEHICLE_MEDIA_PORTAL_VARIANTS };
  }
}
