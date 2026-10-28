import { NotificationEventType } from '@prisma/client';

/** A push older than this at send time is suppressed (STALE); it is also the FCM time to live (ADR-0033 §2). */
export const PUSH_STALE_MS = 60 * 60 * 1000;
export const PUSH_TTL_SECONDS = PUSH_STALE_MS / 1000;

/** A user may send this many test pushes per hour (`POST /v1/me/push/test`). */
export const PUSH_TEST_LIMIT_PER_HOUR = 5;
export const PUSH_TEST_WINDOW_MS = 60 * 60 * 1000;

/** The active devices one user keeps; the oldest are revoked beyond this when a new one registers. */
export const PUSH_MAX_ACTIVE_DEVICES_PER_USER = 10;

/** Cleanup (ADR-0033 §4): a device not seen for this long is revoked, and a revoked row is deleted after the second. */
export const PUSH_DEVICE_IDLE_MS = 60 * 24 * 60 * 60 * 1000;
export const PUSH_REVOKED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The events a user can switch on in the notification settings (v1 list, ADR-0033 §3). */
export const PUSH_USER_EVENT_TYPES = [
  NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
  NotificationEventType.WORKSHOP_TASK_WAITING_CUSTOMER,
  NotificationEventType.WORKSHOP_ORDER_READY,
] as const;

export type PushUserEventType = (typeof PUSH_USER_EVENT_TYPES)[number];

/** The kill switch. Anything but the exact string `true` means off, so a typo fails closed. */
export function isPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUSH_ENABLED?.trim() === 'true';
}
