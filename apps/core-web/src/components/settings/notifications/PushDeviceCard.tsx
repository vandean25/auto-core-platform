import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { usePushDevices } from '@/api/push'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PushPermissionError } from '@/features/push/push-device'
import { usePushThisDevice } from '@/features/push/use-push-this-device'

/** Push on this browser: the enable button is the only place that asks the browser for the permission. */
export function PushDeviceCard() {
  const { t } = useTranslation('settings')
  const { support, permission, deviceId, busy, enable, disable } = usePushThisDevice()
  const devicesQuery = usePushDevices(support === 'ready')
  const active = Boolean(deviceId) && Boolean(devicesQuery.data?.some((device) => device.id === deviceId))

  const handleEnable = async () => {
    try {
      await enable()
      toast.success(t('notifications.device.enabled'))
    } catch (error) {
      // A refusal in the browser prompt is not an error: the denied hint below explains it.
      if (!(error instanceof PushPermissionError)) toast.error(t('notifications.device.enableFailed'))
    }
  }

  const handleDisable = async () => {
    try {
      await disable()
      toast.success(t('notifications.device.disabled'))
    } catch {
      toast.error(t('notifications.device.disableFailed'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('notifications.device.title')}</CardTitle>
        <CardDescription>{t(statusKey(support, permission, active))}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {support === 'ready' && permission !== 'denied' ? (
          <Button
            variant={active ? 'outline' : 'default'}
            className="min-h-11"
            disabled={busy}
            onClick={active ? handleDisable : handleEnable}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {active ? t('notifications.device.disable') : t('notifications.device.enable')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function statusKey(
  support: ReturnType<typeof usePushThisDevice>['support'],
  permission: ReturnType<typeof usePushThisDevice>['permission'],
  active: boolean,
) {
  if (support === 'off') return 'notifications.device.off'
  if (support === 'install-required') return 'notifications.device.installRequired'
  if (support === 'unsupported') return 'notifications.device.unsupported'
  if (permission === 'denied') return 'notifications.device.denied'
  return active ? 'notifications.device.active' : 'notifications.device.inactive'
}
