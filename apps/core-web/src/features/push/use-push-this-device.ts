import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { pushKeys } from '@/api/push'
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  getNotificationPermission,
  getPushSupport,
  getStoredDeviceId,
} from './push-device'

/** State and actions of push on this browser. The permission prompt only ever runs inside `enable`, from a click. */
export function usePushThisDevice() {
  const queryClient = useQueryClient()
  const support = React.useMemo(() => getPushSupport(), [])
  const [permission, setPermission] = React.useState(getNotificationPermission)
  const [deviceId, setDeviceId] = React.useState(getStoredDeviceId)
  const [busy, setBusy] = React.useState(false)

  const run = React.useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true)
      try {
        await action()
      } finally {
        setPermission(getNotificationPermission())
        setDeviceId(getStoredDeviceId())
        setBusy(false)
        await queryClient.invalidateQueries({ queryKey: pushKeys.devices() })
      }
    },
    [queryClient],
  )

  const enable = React.useCallback(() => run(async () => void (await enablePushOnThisDevice())), [run])
  const disable = React.useCallback(() => run(disablePushOnThisDevice), [run])

  return { support, permission, deviceId, busy, enable, disable }
}
