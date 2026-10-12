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
