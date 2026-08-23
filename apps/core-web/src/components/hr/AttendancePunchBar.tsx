import type { LucideIcon } from 'lucide-react'
import { LogIn, LogOut, Pause, Stethoscope } from 'lucide-react'

import type { components } from '@/api/generated/openapi'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AttendanceState = components['schemas']['AttendanceState']
type AttendanceEventType = components['schemas']['AttendanceEventType']

type AttendancePunchAction = {
  type: AttendanceEventType
  label: string
  Icon: LucideIcon
  enabledStates: readonly AttendanceState[]
}

export type AttendancePunchBarProps = {
  state: components['schemas']['AttendanceState']
  pending?: boolean
  disabled?: boolean
  statusLabel?: string
  size?: 'default' | 'compact'
  onPunch: (type: components['schemas']['AttendanceEventType']) => void
}

const attendanceActions: readonly AttendancePunchAction[] = [
  {
    type: 'CLOCK_IN',
    label: 'Come to work',
    Icon: LogIn,
    enabledStates: ['CLOCKED_OUT', 'PAUSED', 'AT_DOCTOR'],
  },
  {
    type: 'PAUSE',
    label: 'Pause',
    Icon: Pause,
    enabledStates: ['CLOCKED_IN'],
  },
  {
    type: 'DOCTOR',
    label: 'Doctor',
    Icon: Stethoscope,
    enabledStates: ['CLOCKED_IN'],
  },
  {
    type: 'CLOCK_OUT',
    label: 'Go home',
    Icon: LogOut,
    enabledStates: ['CLOCKED_IN', 'PAUSED', 'AT_DOCTOR'],
  },
]

function isActionEnabled(
  action: AttendancePunchAction,
  state: AttendanceState,
  pending: boolean,
): boolean {
  return !pending && action.enabledStates.includes(state)
}

export function AttendancePunchBar({
  state,
  pending = false,
  disabled = false,
  statusLabel,
  size = 'default',
  onPunch,
}: AttendancePunchBarProps) {
  const isCompact = size === 'compact'

  return (
    <div className={cn('flex items-center gap-2', isCompact && 'gap-1')}>
      <StatusBadge
        status={state}
        label={statusLabel}
        className={cn(isCompact && 'px-2 py-0.5 text-[11px]')}
      />
      {attendanceActions.map((action) => {
        const { type, label, Icon } = action

        return (
          <Button
            key={type}
            type="button"
            variant="outline"
            size={isCompact ? 'sm' : 'default'}
            disabled={!isActionEnabled(action, state, pending || disabled)}
            onClick={() => onPunch(type)}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Button>
        )
      })}
    </div>
  )
}
