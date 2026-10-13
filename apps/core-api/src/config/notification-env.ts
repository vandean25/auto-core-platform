import { z } from 'zod';
import { isPlainEmailAddress } from '../notifications/email/email-address.js';
import {
  findInvalidAllowlistEntries,
  parseRecipientAllowlist,
} from '../notifications/email/recipient-allowlist.js';

/** Notification sender variables (AUT-356). Sending stays off until NOTIFICATION_EMAIL_MODE enables it. */
export const NOTIFICATION_ENV_KEYS = [
  'CLOUD_TASKS_NOTIFICATION_QUEUE',
  'CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL',
  'NOTIFICATION_EMAIL_MODE',
  'NOTIFICATION_EMAIL_PROVIDER',
  'NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST',
  'NOTIFICATION_EMAIL_FROM_ADDRESS',
] as const;

/** The Cloud Tasks settings the wake-up path needs. They are PDF-queue keys, checked here for a live production deploy. */
export type NotificationEnvKey =
  | (typeof NOTIFICATION_ENV_KEYS)[number]
  | 'CLOUD_TASKS_LOCATION'
  | 'CLOUD_TASKS_INVOKER_SA'
  | 'CLOUD_TASKS_WORKER_SECRET'
  | 'CLOUD_TASKS_ENABLED';

const optionalTrimmedString = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

/** Merged into the env schema. A blank value counts as unset, like every other optional key. */
export const notificationEnvShape = {
  CLOUD_TASKS_NOTIFICATION_QUEUE: optionalTrimmedString,
  CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL: optionalTrimmedString,
  NOTIFICATION_EMAIL_MODE: optionalTrimmedString,
  NOTIFICATION_EMAIL_PROVIDER: optionalTrimmedString,
  NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST: optionalTrimmedString,
  NOTIFICATION_EMAIL_FROM_ADDRESS: optionalTrimmedString,
};

const NOTIFICATION_EMAIL_MODES: readonly string[] = ['off', 'fake', 'live'];
const NOTIFICATION_EMAIL_PROVIDERS: readonly string[] = ['brevo', 'ses'];

export interface NotificationEnvInput {
  NODE_ENV: string;
  /** The PDF queue and its target. Notifications must never share either one. */
  CLOUD_TASKS_QUEUE?: string;
  CLOUD_TASKS_TARGET_BASE_URL?: string;
  CLOUD_TASKS_NOTIFICATION_QUEUE?: string;
  CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL?: string;
  NOTIFICATION_EMAIL_MODE?: string;
  NOTIFICATION_EMAIL_PROVIDER?: string;
  NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST?: string;
  NOTIFICATION_EMAIL_FROM_ADDRESS?: string;
  CLOUD_TASKS_LOCATION?: string;
  CLOUD_TASKS_INVOKER_SA?: string;
  CLOUD_TASKS_WORKER_SECRET?: string;
  CLOUD_TASKS_ENABLED?: string;
}

export interface NotificationEnvIssue {
  key: NotificationEnvKey;
  /** `invalid`: the value is wrong. `required`: a value that sending needs is unset. */
  kind: 'invalid' | 'required';
}

/** Fails closed: a bad value stops boot, and `fake` never runs in production. */
export function notificationEnvIssues(
  env: NotificationEnvInput,
): NotificationEnvIssue[] {
  const issues: NotificationEnvIssue[] = [];
  const mode = env.NOTIFICATION_EMAIL_MODE;
  const provider = env.NOTIFICATION_EMAIL_PROVIDER;
  const sender = env.NOTIFICATION_EMAIL_FROM_ADDRESS;

  if (mode !== undefined && !NOTIFICATION_EMAIL_MODES.includes(mode)) {
    issues.push({ key: 'NOTIFICATION_EMAIL_MODE', kind: 'invalid' });
  }
  if (mode === 'fake' && env.NODE_ENV === 'production') {
    issues.push({ key: 'NOTIFICATION_EMAIL_MODE', kind: 'invalid' });
  }
  if (
    provider !== undefined &&
    !NOTIFICATION_EMAIL_PROVIDERS.includes(provider)
  ) {
    issues.push({ key: 'NOTIFICATION_EMAIL_PROVIDER', kind: 'invalid' });
  }
  const allowlist = parseRecipientAllowlist(
    env.NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST,
  );
  if (findInvalidAllowlistEntries(allowlist).length > 0) {
    issues.push({
      key: 'NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST',
      kind: 'invalid',
    });
  }
  if (sender !== undefined && !isPlainEmailAddress(sender)) {
    issues.push({ key: 'NOTIFICATION_EMAIL_FROM_ADDRESS', kind: 'invalid' });
  }
  const notificationOrigin = originOf(
    env.CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL,
  );
  if (
    notificationOrigin === null ||
    (notificationOrigin !== undefined &&
      notificationOrigin === originOf(env.CLOUD_TASKS_TARGET_BASE_URL))
  ) {
    // Two targets on one origin are one Cloud Run service. The PDF service holds no notification settings,
    // so a wake-up sent there would be suppressed or lost.
    issues.push({
      key: 'CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL',
      kind: 'invalid',
    });
  }
  if (
    env.CLOUD_TASKS_NOTIFICATION_QUEUE !== undefined &&
    env.CLOUD_TASKS_NOTIFICATION_QUEUE === env.CLOUD_TASKS_QUEUE
  ) {
    issues.push({ key: 'CLOUD_TASKS_NOTIFICATION_QUEUE', kind: 'invalid' });
  }
  const sendingEnabled = mode === 'fake' || mode === 'live';
  if (env.NODE_ENV !== 'test' && sendingEnabled && !sender) {
    issues.push({ key: 'NOTIFICATION_EMAIL_FROM_ADDRESS', kind: 'required' });
  }
  if (env.NODE_ENV === 'production' && mode === 'live') {
    // Without the wake-up path no row is woken, so every notice waits for the sweep. Refuse that at boot.
    if (!env.CLOUD_TASKS_NOTIFICATION_QUEUE) {
      issues.push({ key: 'CLOUD_TASKS_NOTIFICATION_QUEUE', kind: 'required' });
    }
    if (!env.CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL) {
      issues.push({
        key: 'CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL',
        kind: 'required',
      });
    }
    // The wake-up path also needs these, and isEnabled() refuses CLOUD_TASKS_ENABLED=false.
    if (!env.CLOUD_TASKS_LOCATION) {
      issues.push({ key: 'CLOUD_TASKS_LOCATION', kind: 'required' });
    }
    if (!env.CLOUD_TASKS_INVOKER_SA) {
      issues.push({ key: 'CLOUD_TASKS_INVOKER_SA', kind: 'required' });
    }
    if (!env.CLOUD_TASKS_WORKER_SECRET) {
      issues.push({ key: 'CLOUD_TASKS_WORKER_SECRET', kind: 'required' });
    }
    if (env.CLOUD_TASKS_ENABLED === 'false') {
      issues.push({ key: 'CLOUD_TASKS_ENABLED', kind: 'invalid' });
    }
  }
  return issues;
}

/** The origin (scheme, host, port) of a target URL. `null` when the value is not an http(s) URL. */
function originOf(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
