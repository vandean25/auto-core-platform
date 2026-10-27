import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

import { useHrMeClock, usePunchClock } from '@/api/hr'
import { AttendancePunchBar } from '@/components/hr/AttendancePunchBar'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getErrorMessage } from '@/lib/error-utils'

type PhonePunchSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The time clock of the mechanic queue in a bottom sheet: the existing punch bar, no new clock logic. */
export function PhonePunchSheet({ open, onOpenChange }: PhonePunchSheetProps) {
  const { t } = useTranslation('nav')
  const { t: tWorkshop } = useTranslation('workshop')
  const { data: clock, error: clockError } = useHrMeClock()
  const { mutate: punch, isPending } = usePunchClock()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{t('phoneNav.punchTitle')}</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          {clock && !clockError ? (
            <AttendancePunchBar
              state={clock.state}
              pending={isPending}
              touchFriendly
              onPunch={(type) =>
                punch({ type }, { onError: (error) => toast.error(getErrorMessage(error, tWorkshop('mechanic.queue.punchError'))) })
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {clockError ? t('phoneNav.punchUnavailable') : t('phoneNav.punchLoading')}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
