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

export type NotificationEnvKey = (typeof NOTIFICATION_ENV_KEYS)[number];

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
}

export interface NotificationEnvIssue {
  key: NotificationEnvKey;
  /** `invalid`: the value is wrong. `required`: sending is on but no sender address is set. */
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
  if (
    sameTarget(
      env.CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL,
      env.CLOUD_TASKS_TARGET_BASE_URL,
    )
  ) {
    // A wake-up sent to the PDF worker would be suppressed there: it holds no notification settings.
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
  return issues;
}

function sameTarget(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) {
    return false;
  }
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}
