import { i18n } from '@/lib/i18n'

export function shellSwitchTenantFailedMessage(_error: unknown): string {
  return i18n.t('common:shell.switchTenantFailed')
}

export function shellSwitchSiteFailedMessage(_error: unknown): string {
  return i18n.t('common:shell.switchSiteFailed')
}

export function shellPushLinkSiteRefusedMessage(): string {
  return i18n.t('common:shell.pushLinkSiteRefused')
}
