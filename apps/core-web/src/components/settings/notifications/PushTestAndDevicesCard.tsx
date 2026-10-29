import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { usePushDevices, useRevokePushDevice, useSendTestPush } from '@/api/push'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getStoredDeviceId } from '@/features/push/push-device'
import { getHttpErrorStatus } from '@/lib/error-utils'
import { formatDateTime } from '@/lib/format'

/** The test push to my own devices, and the list of my registered devices with removal. */
export function PushTestAndDevicesCard() {
  const { t } = useTranslation('settings')
  const devicesQuery = usePushDevices()
  const revoke = useRevokePushDevice()
  const sendTest = useSendTestPush()
  const devices = devicesQuery.data ?? []
  const currentDeviceId = getStoredDeviceId()

  const handleTest = async () => {
    try {
      await sendTest.mutateAsync()
      toast.success(t('notifications.test.sent'))
    } catch (error) {
      const status = getHttpErrorStatus(error)
      toast.error(
        status === 429
          ? t('notifications.test.limited')
          : status === 409
            ? t('notifications.test.noDevice')
            : t('notifications.test.failed'),
      )
    }
  }

  const handleRemove = async (id: string) => {
    try {
      await revoke.mutateAsync(id)
      toast.success(t('notifications.devices.removed'))
    } catch {
      toast.error(t('notifications.devices.removeFailed'))
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.test.title')}</CardTitle>
          <CardDescription>{t('notifications.test.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="min-h-11" disabled={devices.length === 0 || sendTest.isPending} onClick={handleTest}>
            {t('notifications.test.send')}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.devices.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <p className="text-sm text-slate-500">{t('notifications.devices.empty')}</p>
          ) : (
            <ul className="divide-y">
              {devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t(`notifications.devices.platform.${device.platform}`)}
                      {device.browser ? ` · ${device.browser}` : ''}
                      {device.id === currentDeviceId ? ` · ${t('notifications.devices.current')}` : ''}
                    </p>
                    <p className="text-sm text-slate-500">
                      {t('notifications.devices.lastSeen', { date: formatDateTime(device.lastSeenAt) })}
                      {device.installed ? ` · ${t('notifications.devices.installed')}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={revoke.isPending}
                    onClick={() => void handleRemove(device.id)}
                  >
                    {t('notifications.devices.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}
