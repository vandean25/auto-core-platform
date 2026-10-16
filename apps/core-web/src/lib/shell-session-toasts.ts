import { i18n } from '@/lib/i18n'

export function shellSwitchTenantFailedMessage(error: unknown): string {
  return error instanceof Error ? error.message : i18n.t('common:shell.switchTenantFailed')
}

export function shellSwitchSiteFailedMessage(error: unknown): string {
  return error instanceof Error ? error.message : i18n.t('common:shell.switchSiteFailed')
}
