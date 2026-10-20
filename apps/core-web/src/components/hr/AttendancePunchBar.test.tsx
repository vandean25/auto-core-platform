import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { components } from '@/api/generated/openapi'
import { StatusBadge } from '@/components/status/StatusBadge'
import { formatStatusLabel } from '@/lib/i18n/enum-labels'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import deHr from '../../../../../locales/de/hr.json'
import { registerGermanUiForTests } from '@/test/german-ui'
import { AttendancePunchBar } from './AttendancePunchBar'

registerGermanUiForTests()

type AttendanceState = components['schemas']['AttendanceState']

const actionLabels = [
  deHr.punchBar.clockIn,
  deHr.punchBar.pause,
  deHr.punchBar.doctor,
  deHr.punchBar.clockOut,
]

afterEach(() => {
  cleanup()
})

function renderPunchBar(state: AttendanceState, pending = false, size: 'default' | 'compact' = 'default') {
  const onPunch = vi.fn()

  const renderResult = render(
    <AttendancePunchBar
      state={state}
      pending={pending}
      size={size}
      onPunch={onPunch}
    />,
  )

  return { container: renderResult.container, onPunch }
}

function getActionButton(label: string) {
  return screen.getByRole('button', { name: label })
}

describe('AttendancePunchBar', () => {
  it('enables only Come to work while clocked out', () => {
    renderPunchBar('CLOCKED_OUT')

    expect(getActionButton(deHr.punchBar.clockIn)).toBeEnabled()
    actionLabels.slice(1).forEach((label) => {
      expect(getActionButton(label)).toBeDisabled()
    })
  })

  it('enables Pause, Doctor, and Go home while clocked in', () => {
    renderPunchBar('CLOCKED_IN', false)

    expect(getActionButton(deHr.punchBar.clockIn)).toBeDisabled()
    expect(getActionButton(deHr.punchBar.pause)).toBeEnabled()
    expect(getActionButton(deHr.punchBar.doctor)).toBeEnabled()
    expect(getActionButton(deHr.punchBar.clockOut)).toBeEnabled()
  })

  it('enables Come to work and Go home while paused', () => {
    renderPunchBar('PAUSED', false)

    expect(getActionButton(deHr.punchBar.clockIn)).toBeEnabled()
    expect(getActionButton(deHr.punchBar.pause)).toBeDisabled()
    expect(getActionButton(deHr.punchBar.doctor)).toBeDisabled()
    expect(getActionButton(deHr.punchBar.clockOut)).toBeEnabled()
  })

  it('enables Come to work and Go home while at the doctor', () => {
    renderPunchBar('AT_DOCTOR')

    expect(getActionButton(deHr.punchBar.clockIn)).toBeEnabled()
    expect(getActionButton(deHr.punchBar.clockOut)).toBeEnabled()
    expect(getActionButton(deHr.punchBar.pause)).toBeDisabled()
    expect(getActionButton(deHr.punchBar.doctor)).toBeDisabled()
  })

  it('disables every action while a punch is pending', () => {
    renderPunchBar('CLOCKED_IN', true)

    actionLabels.forEach((label) => {
      expect(getActionButton(label)).toBeDisabled()
    })
  })

  it('renders compact controls with the current state badge', () => {
    const { container } = renderPunchBar('CLOCKED_IN', false, 'compact')
    const stateBadge = screen.getByText(formatStatusLabel('CLOCKED_IN'))

    expect(stateBadge).toHaveClass(
      'border-success/30',
      'bg-success/10',
      'text-success',
      'px-2',
      'py-0.5',
    )
    expect(container.firstElementChild).toHaveClass('gap-1')
    expect(getActionButton(deHr.punchBar.clockIn)).toHaveClass('h-8')
  })

  it('passes the selected attendance event type to onPunch', () => {
    const { onPunch } = renderPunchBar('CLOCKED_IN')

    fireEvent.click(getActionButton(deHr.punchBar.doctor))

    expect(onPunch).toHaveBeenCalledWith('DOCTOR')
  })
})

describe('StatusBadge attendance mappings', () => {
  it.each([
    ['CLOCKED_IN', 'border-success/30', 'bg-success/10', 'text-success'],
    ['CLOCKED_OUT', 'border-border', 'bg-muted', 'text-muted-foreground'],
    ['AT_DOCTOR', 'border-info/30', 'bg-info/10', 'text-info'],
    ['BOOKED', 'border-success/30', 'bg-success/10', 'text-success'],
  ] as const)('uses the shared colors for %s', (status, borderClass, backgroundClass, textClass) => {
    render(<StatusBadge status={status} />)

    expect(screen.getByText(formatStatusLabel(status))).toHaveClass(
      borderClass,
      backgroundClass,
      textClass,
    )
  })
})

describe('shared shadcn primitives', () => {
  it('composes an alert with its title and description', () => {
    render(
      <Alert>
        <AlertTitle>Attendance unavailable</AlertTitle>
        <AlertDescription>Try again shortly.</AlertDescription>
      </Alert>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Attendance unavailableTry again shortly.')
  })

  it('renders a pulsing skeleton placeholder', () => {
    const { container } = render(<Skeleton className='h-4 w-20' />)

    expect(container.firstElementChild).toHaveClass('animate-pulse', 'h-4', 'w-20')
  })
})
