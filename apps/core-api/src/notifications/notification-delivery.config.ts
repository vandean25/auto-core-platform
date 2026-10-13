import { parseRecipientAllowlist } from './email/recipient-allowlist.js';
import type {
  LiveEmailProviderName,
  NotificationEmailMode,
} from './notification-decision.js';

export interface NotificationDeliveryConfig {
  mode: NotificationEmailMode;
  liveProvider: LiveEmailProviderName;
  allowlist: string[];
  fromAddress: string;
}

/**
 * Read from the environment on every attempt, so a flag change applies without a redeploy.
 * Anything unrecognised fails closed: mode off, Brevo, an empty allowlist.
 */
export function readNotificationDeliveryConfig(
  env: NodeJS.ProcessEnv = process.env,
): NotificationDeliveryConfig {
  const rawMode = env.NOTIFICATION_EMAIL_MODE?.trim();
  const mode: NotificationEmailMode =
    rawMode === 'fake' || rawMode === 'live' ? rawMode : 'off';
  const liveProvider: LiveEmailProviderName =
    env.NOTIFICATION_EMAIL_PROVIDER?.trim() === 'ses' ? 'ses' : 'brevo';
  return {
    mode,
    liveProvider,
    allowlist: parseRecipientAllowlist(
      env.NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST,
    ),
    fromAddress: env.NOTIFICATION_EMAIL_FROM_ADDRESS?.trim() ?? '',
  };
}

/**
 * An instance serves the sender only when NOTIFICATION_EMAIL_MODE is set. The PDF worker holds no NOTIFICATION_*
 * keys, so a wake-up that reaches it is refused, and Cloud Tasks reports it instead of the row being suppressed.
 */
export function isNotificationSender(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env.NOTIFICATION_EMAIL_MODE?.trim() ?? '') !== '';
}
