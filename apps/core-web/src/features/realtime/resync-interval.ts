/**
 * A reconnect and a tab that becomes visible in the same moment catch up once, not twice. Also the throttle of the
 * lifecycle scope-context handshake. No imports, so Playwright specs can read it too.
 */
export const REALTIME_RESYNC_MIN_INTERVAL_MS = 10_000
