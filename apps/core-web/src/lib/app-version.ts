export const APP_VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000

export type VersionJsonPayload = {
  version: string
}

/** Normalize build-time and remote version strings; empty means local/dev. */
export function normalizeAppVersion(value: string | undefined | null): string {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? 'dev' : trimmed
}

export function isAppVersionCheckEnabled(bundledVersion: string): boolean {
  return normalizeAppVersion(bundledVersion) !== 'dev'
}

export function hasNewAppVersion(bundledVersion: string, remoteVersion: string): boolean {
  const bundled = normalizeAppVersion(bundledVersion)
  if (!isAppVersionCheckEnabled(bundled)) {
    return false
  }
  const remote = normalizeAppVersion(remoteVersion)
  if (remote === 'dev') {
    return false
  }
  return bundled !== remote
}
