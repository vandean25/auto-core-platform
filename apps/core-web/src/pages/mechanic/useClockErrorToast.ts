import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getErrorMessage, getErrorStatus } from '@/lib/error-utils'

export function useClockErrorToast(clockError: unknown) {
  const { t } = useTranslation('workshop')

  useEffect(() => {
    if (!clockError || getErrorStatus(clockError) === 403) return

    toast.error(getErrorMessage(clockError, t('mechanic.queue.clockLoadError')))
  }, [clockError, t])
}
