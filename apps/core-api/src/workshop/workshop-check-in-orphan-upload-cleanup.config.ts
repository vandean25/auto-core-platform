export const WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_DEFAULT_TTL_HOURS = 24;
export const WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_PURGE_BATCH_SIZE = 20;

export type WorkshopCheckInOrphanUploadPurgeConfig = {
  enabled: boolean;
  ttlMs: number;
  batchSize: number;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function readWorkshopCheckInOrphanUploadPurgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkshopCheckInOrphanUploadPurgeConfig {
  const enabledRaw = env.WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_PURGE_ENABLED?.trim();
  const enabled =
    enabledRaw === undefined ||
    enabledRaw === '' ||
    enabledRaw.toLowerCase() === 'true';

  const ttlHours = parsePositiveInt(
    env.WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_TTL_HOURS,
    WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_DEFAULT_TTL_HOURS,
  );

  return {
    enabled,
    ttlMs: ttlHours * 60 * 60 * 1000,
    batchSize: WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_PURGE_BATCH_SIZE,
  };
}
