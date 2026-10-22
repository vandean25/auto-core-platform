import { AttendancePunchBar } from '@/components/hr/AttendancePunchBar'
import type { HrClockResponse } from '@/api/hr'
import type { PunchClockPayload } from '@/api/hr'
import { getErrorStatus } from '@/lib/error-utils'

type MechanicQueuePunchProps = {
  clockResponse: HrClockResponse | undefined
  clockError: unknown
  isPunchPending: boolean
  onPunch: (type: PunchClockPayload['type']) => void
}

export function MechanicQueuePunch({
  clockResponse,
  clockError,
  isPunchPending,
  onPunch,
}: MechanicQueuePunchProps) {
  if (!clockResponse || getErrorStatus(clockError) === 403) return null

  return (
    <AttendancePunchBar
      state={clockResponse.state}
      pending={isPunchPending}
      size="compact"
      touchFriendly
      onPunch={onPunch}
    />
  )
}
