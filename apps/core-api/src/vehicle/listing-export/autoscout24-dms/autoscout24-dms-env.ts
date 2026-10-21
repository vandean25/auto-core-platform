export const DEFAULT_AUTOSCOUT24_DMS_HTTP_TIMEOUT_MS = 15_000;

export function isVehicleListingAs24PushEnvEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.VEHICLE_LISTING_AS24_PUSH_ENABLED?.trim().toLowerCase() === 'true';
}

export function readAutoscout24DmsHttpTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.AUTOSCOUT24_DMS_HTTP_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_AUTOSCOUT24_DMS_HTTP_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_AUTOSCOUT24_DMS_HTTP_TIMEOUT_MS;
}

export function readAutoscout24DmsBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const trimmed = env.AUTOSCOUT24_DMS_API_BASE_URL?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, '');
}

export function readAutoscout24DmsCredentialsSecretRef(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const trimmed = env.AUTOSCOUT24_DMS_API_CREDENTIALS_SECRET_REF?.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function isAutoscout24DmsHttpConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    Boolean(readAutoscout24DmsBaseUrl(env)) &&
    Boolean(readAutoscout24DmsCredentialsSecretRef(env))
  );
}

export function useAutoscout24DmsFakeAdapterInProcess(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === 'test') {
    return true;
  }
  return env.AUTOSCOUT24_DMS_USE_FAKE_ADAPTER?.trim().toLowerCase() === 'true';
}
