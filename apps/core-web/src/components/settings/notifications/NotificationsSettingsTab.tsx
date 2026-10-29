import { useTranslation } from 'react-i18next'

import { SettingsSectionHeading } from '@/components/settings/SettingsSectionHeading'
import { PushDeviceCard } from './PushDeviceCard'
import { PushPreferencesCard } from './PushPreferencesCard'
import { PushTestAndDevicesCard } from './PushTestAndDevicesCard'

/** Settings > Notifications: web push for the signed-in user (AUT-766, ADR-0033). Open to every role. */
export function NotificationsSettingsTab() {
  const { t } = useTranslation('settings')
  return (
    <div className="space-y-6">
      <SettingsSectionHeading title={t('notifications.title')} description={t('notifications.description')} />
      <PushDeviceCard />
      <PushPreferencesCard />
      <PushTestAndDevicesCard />
    </div>
  )
}
